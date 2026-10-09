import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RotaAssistant from "./RotaAssistant";
import { AUTH } from "./protocol";

const mocks = vi.hoisted(() => ({
  state: { address: "wallet-1", accountId: "account-1" },
  getKey: vi.fn(),
  seal: vi.fn(),
  network: "mainnet",
}));
vi.mock("@orderly.network/hooks", () => ({
  useAccount: () => ({ state: mocks.state }),
  useKeyStore: () => ({ getOrderlyKey: mocks.getKey }),
  useConfig: (name: string) =>
    name === "brokerId" ? "rota_dex" : mocks.network,
}));
vi.mock("./credentials", () => ({ sealTradingKey: mocks.seal }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let post: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  window.__RUNTIME_CONFIG__ = {};
  mocks.state = { address: "wallet-1", accountId: "account-1" };
  mocks.network = "mainnet";
  mocks.getKey.mockReturnValue({ secretKey: "secret" });
  mocks.seal.mockResolvedValue("encrypted");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete window.__RUNTIME_CONFIG__;
});
async function render() {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <RotaAssistant />
      </MemoryRouter>,
    ),
  );
}
function button(label: string) {
  const found = Array.from(host.querySelectorAll("button")).find(
    (node) =>
      node.getAttribute("aria-label") === label || node.textContent === label,
  );
  expect(found).toBeDefined();
  return found!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function open() {
  await click("Open ROTA AI");
  const frame = host.querySelector("iframe")!;
  act(() => frame.dispatchEvent(new Event("load")));
  post = vi.spyOn(frame.contentWindow!, "postMessage");
  return frame;
}
async function message(
  data: unknown,
  options: { origin?: string; source?: Window } = {},
) {
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin: options.origin || "https://iamstarchild.com",
        source: options.source || host.querySelector("iframe")!.contentWindow,
      }),
    ),
  );
}
const pubkey = {
  type: AUTH.PUBKEY,
  pubKey: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----",
  nonce: "nonce-1",
};
describe("ROTA AI account authorization", () => {
  it("loads lazily and retains the chat across close/reopen", async () => {
    expect(host.querySelector("iframe")).toBeNull();
    const frame = await open();
    expect(frame.src).toContain("hideLogo=1");
    await click("Close ROTA AI");
    expect(host.querySelector("section")!.hidden).toBe(true);
    expect(document.activeElement).toBe(button("Open ROTA AI"));
    await click("Open ROTA AI");
    expect(host.querySelector("iframe")).toBe(frame);
  });
  it("requires consent and sends only sealed credentials for the ROTA account", async () => {
    await open();
    await message(pubkey);
    expect(mocks.seal).not.toHaveBeenCalled();
    await message({ type: AUTH.TRIGGER, actionId: "chat-action" });
    expect(host.textContent).toContain("existing permissions");
    expect(post).not.toHaveBeenCalled();
    await click("Allow AI trading");
    expect(post).toHaveBeenCalledWith(
      { type: AUTH.REQUEST, scope: "trade-only", actionId: "chat-action" },
      "https://iamstarchild.com",
    );
    await message({ ...pubkey, actionId: "wrong-action" });
    expect(mocks.seal).not.toHaveBeenCalled();
    await message(pubkey);
    expect(mocks.getKey).toHaveBeenCalledWith("wallet-1");
    expect(post).toHaveBeenCalledWith(
      {
        type: AUTH.RESULT,
        nonce: "nonce-1",
        ciphertext: "encrypted",
        accountId: "account-1",
        brokerId: "rota_dex",
        networkId: "mainnet",
        actionId: "chat-action",
      },
      "https://iamstarchild.com",
    );
    expect(JSON.stringify(post.mock.calls)).not.toContain("secret");
    await message(pubkey);
    expect(mocks.seal).toHaveBeenCalledTimes(1);
  });
  it("ignores messages from another origin or another window", async () => {
    await open();
    await message({ type: AUTH.TRIGGER }, { origin: "https://other.example" });
    await message({ type: AUTH.TRIGGER }, { source: window });
    await message({ type: "starchild_close_panel" }, { source: window });
    expect(host.querySelector("section")!.hidden).toBe(false);
    expect(host.querySelector(".rota-ai-consent")).toBeNull();
    expect(mocks.getKey).not.toHaveBeenCalled();
  });
  it("cancels without reading the key", async () => {
    await open();
    await click("Connect AI trading");
    await click("Cancel");
    await message(pubkey);
    expect(mocks.getKey).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: AUTH.ERROR }),
      "https://iamstarchild.com",
    );
  });
  it("drops an in-flight encrypted result when the panel closes", async () => {
    let resolve!: (value: string) => void;
    mocks.seal.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    await open();
    await click("Connect AI trading");
    await click("Allow AI trading");
    await message(pubkey);
    await click("Close ROTA AI");
    await act(async () => resolve("late-ciphertext"));
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: AUTH.RESULT }),
      expect.any(String),
    );
  });
  it.each(["wallet", "account", "network"])(
    "discards the embedded session when the %s changes",
    async (field) => {
      const frame = await open();
      if (field === "wallet") mocks.state.address = "wallet-2";
      if (field === "account") mocks.state.accountId = "account-2";
      if (field === "network") mocks.network = "testnet";
      await render();
      expect(host.querySelector("iframe")).toBeNull();
      expect(frame.isConnected).toBe(false);
    },
  );
  it("times out and ignores a late public key", async () => {
    await open();
    vi.useFakeTimers();
    await click("Connect AI trading");
    await click("Allow AI trading");
    act(() => vi.advanceTimersByTime(30001));
    await message(pubkey);
    expect(host.textContent).toContain("timed out");
    expect(mocks.getKey).not.toHaveBeenCalled();
  });
  it("keeps research available when authorization is disabled", async () => {
    window.__RUNTIME_CONFIG__ = { VITE_ROTA_AI_TRADING_AUTHORIZATION: "false" };
    await render();
    await open();
    await message({ type: AUTH.TRIGGER });
    expect(button("Connect AI trading").disabled).toBe(true);
    expect(mocks.getKey).not.toHaveBeenCalled();
    expect(host.querySelector("iframe")).not.toBeNull();
  });
});
