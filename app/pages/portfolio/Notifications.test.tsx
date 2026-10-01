import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Notifications from "./Notifications";

const mocks = vi.hoisted(() => ({
  account: {
    address: "0x1111111111111111111111111111111111111111",
    accountId: "account-1",
    chainId: 1,
    walletAdapter: { generateAddOrderlyKeyMessage: vi.fn() },
  },
  request: vi.fn(),
  createIntent: vi.fn(),
  confirmIntent: vi.fn(),
}));
vi.mock("@orderly.network/hooks", () => ({
  useAccount: () => ({ account: mocks.account }),
}));
vi.mock("@/services/notifications", async (original) => ({
  ...(await original<typeof import("@/services/notifications")>()),
  notificationRequest: mocks.request,
  createNotificationCredentialIntent: mocks.createIntent,
  confirmNotificationCredentialIntent: mocks.confirmIntent,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const verified = {
  verified: true,
  bot_username: "rota_test_bot",
  events: ["position_opened"],
};
beforeEach(() => {
  mocks.request.mockReset();
  mocks.createIntent.mockReset();
  mocks.confirmIntent.mockReset();
  mocks.account.walletAdapter.generateAddOrderlyKeyMessage.mockReset();
  mocks.createIntent.mockResolvedValue({
    id: "intent-read",
    scope: "read",
    public_key: "ed25519:notification-key",
    broker_id: "rota_dex",
    timestamp: 123,
  });
  mocks.confirmIntent.mockResolvedValue({
    wallet: mocks.account.address,
    authorization_token: "notification-session",
    expires_in: 86400,
  });
  mocks.account.walletAdapter.generateAddOrderlyKeyMessage.mockResolvedValue({
    signatured: "0xsigned",
  });
  mocks.account.address = "0x1111111111111111111111111111111111111111";
  localStorage.clear();
  localStorage.setItem(
    `rota-notifications-session:${mocks.account.address}:${mocks.account.accountId}`,
    "session",
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(<Notifications />));
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe("Portfolio Telegram notifications", () => {
  it("requests only read access without reusing or overwriting the copy-trade session", async () => {
    localStorage.clear();
    const tradingKey = `rota-copytrade-session:${mocks.account.address}`;
    localStorage.setItem(tradingKey, "trading-session");
    mocks.request.mockResolvedValue({ verified: false, events: [] });
    await render();
    expect(mocks.request).not.toHaveBeenCalled();
    await click("Load notification settings");
    expect(mocks.createIntent).toHaveBeenCalledWith({
      wallet: mocks.account.address,
      account_id: "account-1",
      chain_id: 1,
    });
    expect(
      mocks.account.walletAdapter.generateAddOrderlyKeyMessage,
    ).toHaveBeenCalledWith(expect.objectContaining({ scope: "read" }));
    expect(mocks.confirmIntent).toHaveBeenCalledWith(
      mocks.account.address,
      "intent-read",
      "0xsigned",
    );
    expect(localStorage.getItem(tradingKey)).toBe("trading-session");
    expect(
      localStorage.getItem(
        `rota-notifications-session:${mocks.account.address}:account-1`,
      ),
    ).toBe("notification-session");
    expect(mocks.request).toHaveBeenCalledWith(
      mocks.account.address,
      "notification-session",
    );
  });
  it("refuses to sign a notification key with trading permissions", async () => {
    localStorage.clear();
    mocks.createIntent.mockResolvedValue({ scope: "read,trading" });
    await render();
    await click("Load notification settings");
    expect(
      mocks.account.walletAdapter.generateAddOrderlyKeyMessage,
    ).not.toHaveBeenCalled();
    expect(mocks.confirmIntent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("require a read-only API key");
  });
  it("shows notification choices only after a verified connection", async () => {
    mocks.request.mockResolvedValue({ verified: false, events: [] });
    await render();
    expect(container.textContent).toContain("Bot token");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      0,
    );
  });
  it("loads persisted preferences and saves the user's selection", async () => {
    mocks.request.mockResolvedValue(verified);
    await render();
    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(inputs).toHaveLength(10);
    expect(inputs[0].checked).toBe(true);
    expect(inputs[4].checked).toBe(false);
    await act(async () => inputs[4].click());
    mocks.request.mockResolvedValue({
      ...verified,
      events: ["position_opened", "take_profit"],
    });
    await click("Save preferences");
    expect(mocks.request).toHaveBeenLastCalledWith(
      mocks.account.address,
      "session",
      "",
      "PUT",
      { events: ["position_opened", "take_profit"] },
    );
    expect(container.textContent).toContain("Notification preferences saved.");
  });
  it("disconnects and hides the preferences", async () => {
    mocks.request.mockResolvedValue(verified);
    await render();
    mocks.request.mockResolvedValue(undefined);
    await click("Disconnect");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      0,
    );
    expect(container.textContent).toContain("Telegram disconnected.");
  });
  it("keeps preferences hidden when verification fails", async () => {
    mocks.request.mockResolvedValue({ verified: false, events: [] });
    await render();
    const input = container.querySelector<HTMLInputElement>(
      "#telegram-bot-token",
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "123456789:valid-test-token");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.request.mockResolvedValue({
      telegram_url: "https://t.me/test_bot?start=challenge",
    });
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(container.textContent).toContain("Verify connection");
    mocks.request.mockRejectedValue(new Error("Press Start first"));
    await click("Verify connection");
    expect(container.textContent).toContain("Press Start first");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      0,
    );
  });
});
