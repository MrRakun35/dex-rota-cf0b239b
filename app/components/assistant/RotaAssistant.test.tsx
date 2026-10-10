import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RotaAIIndex from "@/pages/rota-ai/Index";
import RotaAssistant from "./RotaAssistant";
import { openAssistant } from "./shortcuts";

const mocks = vi.hoisted(() => ({
  state: { address: "wallet-1", accountId: "account-1" },
  network: "mainnet",
  request: vi.fn(),
}));
vi.mock("@orderly.network/hooks", () => ({
  useAccount: () => ({ state: mocks.state, account: {} }),
  useConfig: () => mocks.network,
}));
vi.mock("@/services/agent", () => ({ agentRequest: mocks.request }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const settings = {
  provider: "starter",
  model: "openrouter/free",
  has_key: false,
  share_account_data: false,
  max_order_notional: 100,
  notes: "",
};
let authenticated = false;
beforeEach(async () => {
  authenticated = false;
  window.__RUNTIME_CONFIG__ = {};
  sessionStorage.clear();
  localStorage.clear();
  mocks.state = { address: "wallet-1", accountId: "account-1" };
  mocks.network = "mainnet";
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/capabilities")
      return {
        starter_ready: true,
        starter_model: "openrouter/free",
        daily_messages: 20,
        dry_run: true,
        tools: [],
      };
    if (path === "/sessions")
      return { authorization_token: "guest-session", scope: "guest" };
    if (path === "/settings")
      return {
        settings,
        authenticated,
        read_authorized: authenticated,
        trading_authorized: authenticated,
      };
    if (["/history", "/tasks", "/reports", "/audit"].includes(path)) return [];
    if (path === "/chat")
      return {
        message: { role: "assistant", content: "Native ROTA response" },
        model: "free-model",
        remaining: 19,
        traces: [],
        proposals: [],
      };
    return {};
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
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
  const result = Array.from(host.querySelectorAll("button")).find(
    (node) =>
      node.getAttribute("aria-label") === label || node.textContent === label,
  );
  expect(result).toBeDefined();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function type(selector: string, value: string) {
  const input = host.querySelector(selector) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const prototype =
    input.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send() {
  await type('textarea[aria-label="Message ROTA AI"]', "Analyze BTC");
  await click("Send message");
}

describe("Native ROTA agent", () => {
  it("starts on the free model without an iframe or remote key exchange", async () => {
    await click("Open ROTA AI");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toContain("20 free messages / day");
    await send();
    expect(host.textContent).toContain("Native ROTA response");
    expect(mocks.request).toHaveBeenCalledWith(
      "/chat",
      "guest-session",
      "POST",
      { message: "Analyze BTC" },
      expect.any(AbortSignal),
    );
  });
  it("opens a guide example as an editable draft without sending or confirming", async () => {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <RotaAssistant />
          <RotaAIIndex />
        </MemoryRouter>,
      ),
    );
    const example = Array.from(host.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Try in chat"),
    )!;
    await act(async () => example.click());
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Message ROTA AI"]',
      )?.value,
    ).toContain("market_query");
    expect(
      mocks.request.mock.calls.some(
        (call) => call[0] === "/chat" || String(call[0]).includes("/confirm"),
      ),
    ).toBe(false);
    const shortcuts = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Tool shortcuts"]',
    )!;
    await act(async () => {
      shortcuts.value = "guard";
      shortcuts.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Message ROTA AI"]',
      )?.value,
    ).toContain("guard_state");
  });
  it("offers Claude and explicitly probes only the saved model connection", async () => {
    authenticated = true;
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args: unknown[]) =>
      args[0] === "/model/test"
        ? { ok: true, model: "claude-selected" }
        : original(...args),
    );
    await act(async () => openAssistant({ tab: "settings" }));
    expect(host.querySelector('option[value="anthropic"]')?.textContent).toBe(
      "Anthropic Claude",
    );
    expect(
      mocks.request.mock.calls.some((call) => call[0] === "/model/test"),
    ).toBe(false);
    await click("Test model connection");
    expect(mocks.request).toHaveBeenCalledWith(
      "/model/test",
      "guest-session",
      "POST",
      {},
      expect.any(AbortSignal),
    );
    expect(host.textContent).toContain("Connection verified · claude-selected");
    const link = Array.from(host.querySelectorAll("a")).find((node) =>
      node.textContent?.includes("Open ROTA Portfolio"),
    );
    expect(link?.getAttribute("href")).toBe("/portfolio/notifications");
  });
  it("never confirms a model-created proposal until the user clicks", async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/capabilities")
        return {
          starter_ready: true,
          dry_run: true,
          daily_messages: 20,
          tools: [],
        };
      if (path === "/sessions") return { authorization_token: "session" };
      if (path === "/settings")
        return {
          settings,
          authenticated: true,
          read_authorized: true,
          trading_authorized: true,
        };
      if (path === "/chat")
        return {
          message: { role: "assistant", content: "Order proposed" },
          model: "free",
          remaining: 19,
          traces: [],
          proposals: [
            {
              id: "p1",
              kind: "plan_order",
              args: { symbol: "PERP_BTC_USDC", order_quantity: 0.001 },
              dry_run: true,
              expires_at: new Date(Date.now() + 60000).toISOString(),
            },
          ],
        };
      return [];
    });
    await click("Open ROTA AI");
    await send();
    expect(
      mocks.request.mock.calls.some((call) =>
        String(call[0]).includes("/confirm"),
      ),
    ).toBe(false);
    await click("Confirm simulation");
    expect(mocks.request).toHaveBeenCalledWith(
      "/proposals/p1/confirm",
      "session",
      "POST",
      { confirmed: true },
      expect.any(AbortSignal),
    );
  });
  it("rejects expired action cards in the UI", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args: unknown[]) =>
      args[0] === "/chat"
        ? {
            message: { role: "assistant", content: "Expired" },
            traces: [],
            proposals: [
              {
                id: "p",
                kind: "plan_order",
                args: {},
                dry_run: true,
                expires_at: new Date(0).toISOString(),
              },
            ],
            remaining: 0,
          }
        : original(...args),
    );
    await click("Open ROTA AI");
    await send();
    expect(button("Expired").disabled).toBe(true);
  });
  it("clears account conversation on wallet or network change", async () => {
    await click("Open ROTA AI");
    await send();
    expect(host.textContent).toContain("Native ROTA response");
    mocks.state = { address: "wallet-2", accountId: "account-2" };
    await render();
    await click("Open ROTA AI");
    expect(host.textContent).not.toContain("Native ROTA response");
    expect(
      sessionStorage.getItem("rota-native-ai:wallet-2:account-2:mainnet"),
    ).toBe("guest-session");
  });
  it("does not save provider keys in browser storage and clears them when closed", async () => {
    authenticated = true;
    await click("Open ROTA AI");
    await click("Settings");
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "openai";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await type('input[type="password"]', "sk-test-do-not-store");
    expect(JSON.stringify(sessionStorage)).not.toContain("sk-test");
    expect(localStorage.length).toBe(0);
    await click("Close ROTA AI");
    await click("Open ROTA AI");
    const secret = host.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement | null;
    expect(secret?.value || "").toBe("");
  });
  it("creates persistent read-only tasks from explicit form submission", async () => {
    authenticated = true;
    await click("Open ROTA AI");
    await click("Tasks");
    await click("Create background task");
    expect(mocks.request).toHaveBeenCalledWith(
      "/tasks",
      "guest-session",
      "POST",
      expect.objectContaining({
        kind: "daily_report",
        timezone: "Europe/Istanbul",
        notify: false,
      }),
      expect.any(AbortSignal),
    );
  });
  it("renders provider and tool text as inert text", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args: unknown[]) =>
      args[0] === "/chat"
        ? {
            message: {
              role: "assistant",
              content: '<img src=x onerror="alert(1)">',
            },
            traces: [{ name: "tool", data: "<script>bad</script>" }],
            proposals: [],
            remaining: 1,
          }
        : original(...args),
    );
    await click("Open ROTA AI");
    await send();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
  });
  it("does not invent a reply when the model is unavailable", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === "/chat") throw new Error("Free capacity reached");
      return original(...args);
    });
    await click("Open ROTA AI");
    await send();
    expect(host.textContent).toContain("Free capacity reached");
    expect(host.textContent).not.toContain("Native ROTA response");
  });
  it("honors the assistant disable switch", async () => {
    window.__RUNTIME_CONFIG__ = { VITE_ROTA_AI_ENABLED: "false" };
    await render();
    expect(host.querySelector("button")).toBeNull();
  });
});
