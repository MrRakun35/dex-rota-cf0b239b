import { describe, expect, it } from "vitest";
import type { TradingBot } from "../../services/bots";
import { dcaLiveLevels } from "./dca-live-levels";

const bot = (progress: Record<string, unknown>, direction = "LONG") =>
  ({
    id: "abcdef",
    wallet: "wallet",
    account_id: "account",
    next_run_at: "",
    created_at: "",
    updated_at: "",
    kind: "DCA",
    status: "active",
    symbol: "PERP_ETH_USDC",
    config: {
      direction,
      leverage: 1,
      base_order_margin: 100,
      dca_order_margin: 100,
      max_dca_orders: 3,
      price_step_percent: 1,
      price_deviation_multiplier: 1,
      order_size_multiplier: 1,
      stop_loss_percent: 5,
      start_price: 100,
    },
    progress,
  }) as TradingBot;

describe("running DCA chart levels", () => {
  it("shows start limit and unsubmitted levels without inventing a current SL", () => {
    const levels = dcaLiveLevels(
      bot({
        dca: { base_price: 0, dca_orders: 0 },
        working_orders: [{ Purpose: "dca_base", Price: 100, Quantity: 1 }],
        lots: [],
      }),
    );
    expect(levels.find((l) => l.label.includes("Start limit"))?.price).toBe(
      100,
    );
    expect(
      levels
        .filter((l) => l.label.includes("not submitted"))
        .map((l) => l.price),
    ).toEqual([99, 98, 97]);
    expect(levels.some((l) => l.label.includes("SL current"))).toBe(false);
    expect(levels.some((l) => l.label.includes("SL projected"))).toBe(true);
  });
  it("excludes the pending partial level from future lines and uses actual average for SL", () => {
    const levels = dcaLiveLevels(
      bot({
        dca: { base_price: 100, dca_orders: 1 },
        lots: [
          { Price: 100, Quantity: 1 },
          { Price: 99, Quantity: 0.5 },
        ],
        working_orders: [
          {
            Purpose: "dca_entry",
            Level: 1,
            Price: 99,
            Quantity: 1,
            Accounted: 0.5,
          },
          { Purpose: "dca_take_profit", Price: 101, Quantity: 1.5 },
        ],
      }),
    );
    expect(
      levels
        .filter((l) => l.label.includes("not submitted"))
        .map((l) => l.price),
    ).toEqual([98, 97]);
    expect(levels.find((l) => l.label.includes("Next DCA"))?.quantity).toBe(
      0.5,
    );
    expect(
      levels.find((l) => l.label.includes("SL current"))?.price,
    ).toBeCloseTo((149.5 / 1.5) * 0.95);
    expect(
      levels.find((l) => l.label.includes("entire position"))?.quantity,
    ).toBe(1.5);
  });
  it("mirrors short levels and removes projections while closing or stopped", () => {
    const progress = {
      dca: { base_price: 100, dca_orders: 1 },
      lots: [{ Price: 100, Quantity: 1 }],
      working_orders: [],
    };
    const short = bot(progress, "SHORT");
    expect(
      dcaLiveLevels(short)
        .filter((l) => l.label.includes("not submitted"))
        .map((l) => l.price),
    ).toEqual([102, 103]);
    expect(
      dcaLiveLevels(short).find((l) => l.label.includes("SL current"))?.price,
    ).toBe(105);
    expect(
      dcaLiveLevels(
        bot({
          ...progress,
          dca: { ...progress.dca, closing: "dca_take_profit" },
        }),
      ).some((l) => l.label.includes("not submitted")),
    ).toBe(false);
    expect(dcaLiveLevels({ ...short, status: "completed" })).toEqual([]);
  });
});
