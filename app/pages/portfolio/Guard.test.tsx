import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GuardAPIError, GuardState } from "@/services/guard";
import Guard from "./Guard";

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
vi.mock("@/services/guard", async (original) => ({
  ...(await original<typeof import("@/services/guard")>()),
  guardRequest: mocks.request,
}));
vi.mock("@/services/copy-trade", () => ({
  createCredentialIntent: mocks.createIntent,
  confirmCredentialIntent: mocks.confirmIntent,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function state(overrides: Partial<GuardState> = {}): GuardState {
  return {
    wallet: mocks.account.address,
    account_id: mocks.account.accountId,
    policy: {
      enabled: true,
      max_loss_24h: 100,
      max_notional: 5000,
      min_liquidation_distance_percent: 5,
    },
    snapshot: {
      pnl_24h: 0,
      notional: 500,
      open_positions: 1,
      min_liquidation_distance_percent: 10,
      liquidation_data_complete: true,
      updated_at: new Date().toISOString(),
    },
    triggered_at: null,
    cleanup_pending: false,
    updated_at: new Date().toISOString(),
    events: [],
    ...overrides,
  };
}
beforeEach(() => {
  mocks.account.address = "0x1111111111111111111111111111111111111111";
  mocks.account.accountId = "account-1";
  mocks.request.mockReset();
  mocks.createIntent.mockReset();
  mocks.confirmIntent.mockReset();
  mocks.account.walletAdapter.generateAddOrderlyKeyMessage.mockReset();
  mocks.request.mockResolvedValue(state());
  mocks.createIntent.mockResolvedValue({
    id: "intent",
    scope: "read,trading",
    public_key: "ed25519:key",
    broker_id: "rota_dex",
    timestamp: 123,
  });
  mocks.account.walletAdapter.generateAddOrderlyKeyMessage.mockResolvedValue({
    signatured: "0xsigned",
  });
  mocks.confirmIntent.mockResolvedValue({ authorization_token: "new-session" });
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(<Guard />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe("Rota Guard", () => {
  it("shows persisted rules separately from draft changes and deactivates the saved policy", async () => {
    localStorage.setItem(
      `rota-copytrade-session:${mocks.account.address}`,
      "existing",
    );
    const saved = state({
      events: [{ type: "settings_updated", at: "2026-10-09T12:00:00Z" }],
    });
    mocks.request.mockResolvedValue(saved);
    await render();
    const summary = container.querySelector(
      '[aria-label="Last saved Guard rules"]',
    )!;
    expect(summary.textContent).toContain("Active");
    expect(summary.textContent).toContain("100 USDC");
    expect(summary.textContent).toContain("5%");
    expect(summary.querySelector("time")?.dateTime).toBe(
      "2026-10-09T12:00:00Z",
    );
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    expect(summary.textContent).toContain("Active");
    expect(summary.textContent).toContain("Enabled");
    const disabled = state({ policy: { ...saved.policy, enabled: false } });
    mocks.request.mockResolvedValue(disabled);
    await click("Deactivate");
    expect(mocks.request).toHaveBeenCalledWith(
      mocks.account.address,
      "account-1",
      "existing",
      "",
      "PUT",
      { ...saved.policy, enabled: false },
    );
    expect(summary.textContent).toContain("Inactive");
    expect(summary.textContent).toContain("100 USDC");
    expect(summary.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
  });
  it("keeps saved rules enabled when deactivation fails", async () => {
    localStorage.setItem(
      `rota-copytrade-session:${mocks.account.address}`,
      "existing",
    );
    await render();
    mocks.request.mockImplementation(
      async (_wallet, _account, _token, _path, method) => {
        if (method === "PUT") throw new Error("Unable to deactivate");
        return state();
      },
    );
    await click("Deactivate");
    const summary = container.querySelector(
      '[aria-label="Last saved Guard rules"]',
    )!;
    expect(summary.textContent).toContain("Enabled");
    expect(summary.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    );
  });
  it("shows unavailable monitoring and disabled individual rules without claiming active protection", async () => {
    localStorage.setItem(
      `rota-copytrade-session:${mocks.account.address}`,
      "existing",
    );
    const saved = state();
    mocks.request.mockResolvedValue(
      state({ policy: { ...saved.policy, max_notional: 0 }, snapshot: null }),
    );
    await render();
    const summary = container.querySelector(
      '[aria-label="Last saved Guard rules"]',
    )!;
    expect(summary.textContent).toContain("Monitoring unavailable");
    expect(summary.textContent).toContain("Rule disabled");
    expect(summary.textContent).not.toContain("Active");
  });
  it("authorizes a trading key without withdrawal scope and binds requests to the current account", async () => {
    await render();
    await click("Connect Guard");
    expect(
      mocks.account.walletAdapter.generateAddOrderlyKeyMessage,
    ).toHaveBeenCalledWith(expect.objectContaining({ scope: "read,trading" }));
    expect(mocks.request).toHaveBeenCalledWith(
      mocks.account.address,
      "account-1",
      "new-session",
      "",
      "GET",
      undefined,
    );
    expect(container.textContent).toContain("Existing positions remain open");
  });
  it("reuses trading authorization, and disables reset until cleanup completes", async () => {
    localStorage.setItem(
      `rota-copytrade-session:${mocks.account.address}`,
      "existing",
    );
    mocks.request.mockResolvedValue(
      state({
        triggered_at: new Date().toISOString(),
        reason: "loss_24h",
        cleanup_pending: true,
      }),
    );
    await render();
    expect(mocks.createIntent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("24-hour loss threshold reached");
    const reset = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Check account and reset Guard",
    );
    expect(reset?.disabled).toBe(true);
    expect(container.textContent).toContain("Positions remain open");
  });
  it("keeps emergency stop distinct from position closing", async () => {
    localStorage.setItem(
      `rota-copytrade-session:${mocks.account.address}`,
      "existing",
    );
    await render();
    await click("Stop automation");
    expect(mocks.request).toHaveBeenCalledWith(
      mocks.account.address,
      "account-1",
      "existing",
      "/emergency-stop",
      "POST",
      undefined,
    );
    expect(container.textContent).toContain("Existing positions remain open");
  });
  it("clears an expired session without requesting wallet signatures in the background", async () => {
    localStorage.setItem(
      `rota-copytrade-session:${mocks.account.address}`,
      "expired",
    );
    mocks.request.mockRejectedValue(new GuardAPIError("expired", 401));
    await render();
    expect(
      localStorage.getItem(`rota-copytrade-session:${mocks.account.address}`),
    ).toBeNull();
    expect(mocks.createIntent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Connect Guard");
  });
  it("does not apply an old account response after the account changes", async () => {
    let resolve!: (value: GuardState) => void;
    const oldState = state({ reason: "old-account-data" });
    localStorage.setItem(
      `rota-copytrade-session:${mocks.account.address}`,
      "existing",
    );
    mocks.request.mockImplementationOnce(
      () =>
        new Promise<GuardState>((r) => {
          resolve = r;
        }),
    );
    await render();
    mocks.account.accountId = "account-2";
    mocks.request.mockResolvedValue(state());
    await render();
    await act(async () => resolve(oldState));
    expect(container.textContent).not.toContain("old-account-data");
    expect(
      mocks.request.mock.calls.every(
        (call) => call[1] === "account-1" || call[1] === "account-2",
      ),
    ).toBe(true);
  });
});
