import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DCALiveLevels } from "./DCALiveLevels";

const mocks = vi.hoisted(() => ({ listBots: vi.fn(), getChart: vi.fn() }));
vi.mock("@orderly.network/hooks", () => ({
  useAccount: () => ({ account: { address: "wallet" } }),
}));
vi.mock("../../services/bots", () => ({
  listBots: mocks.listBots,
  BotAPIError: class extends Error {
    status = 401;
  },
}));
vi.mock("../../utils/trading-chart", () => ({
  getActiveTradingChart: mocks.getChart,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("DCA live chart lifecycle", () => {
  it("draws running levels independently of the Bots tab and cleans up on market change", async () => {
    localStorage.setItem("rota-copytrade-session:wallet", "session");
    const line: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of [
      "setPrice",
      "setText",
      "setQuantity",
      "setEditable",
      "setCancellable",
      "setExtendLeft",
      "setLineStyle",
      "setLineColor",
      "setBodyBorderColor",
      "setBodyTextColor",
      "setBodyBackgroundColor",
      "setQuantityBackgroundColor",
      "setQuantityBorderColor",
      "setQuantityTextColor",
      "setTooltip",
      "remove",
    ])
      line[name] = vi.fn().mockReturnValue(line);
    const chart = {
      symbol: () => "PERP_ETH_USDC",
      createOrderLine: vi.fn().mockReturnValue(line),
    };
    mocks.getChart.mockReturnValue(chart);
    mocks.listBots.mockResolvedValue({
      data: [
        {
          id: "abcdef",
          kind: "DCA",
          status: "active",
          symbol: "PERP_ETH_USDC",
          config: { direction: "LONG", stop_loss_percent: 5 },
          progress: {
            dca: { base_price: 100, dca_orders: 0 },
            lots: [{ Price: 100, Quantity: 1 }],
            working_orders: [
              { Purpose: "dca_take_profit", Price: 101, Quantity: 1 },
            ],
          },
        },
      ],
    });
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      await act(async () => {
        root.render(<DCALiveLevels symbol="PERP_ETH_USDC" />);
      });
      expect(mocks.listBots).toHaveBeenCalledWith("wallet", "session");
      expect(
        line.setText.mock.calls.some(([text]) =>
          String(text).includes("SL current position"),
        ),
      ).toBe(true);
      expect(
        line.setText.mock.calls.some(([text]) =>
          String(text).includes("TP limit"),
        ),
      ).toBe(true);
      await act(async () => {
        root.render(<DCALiveLevels symbol="PERP_BTC_USDC" />);
      });
      expect(line.remove).toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });
});
