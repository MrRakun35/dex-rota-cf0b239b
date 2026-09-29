import { describe, expect, it } from "vitest";
import type { PlatformPosition } from "@/services/market-intelligence";
import { summarizePositionExposure } from "./position-exposure";

const position = (
  side: "LONG" | "SHORT",
  notional: string,
  broker_id: string,
): PlatformPosition => ({
  address: "0x1234",
  account_id: `${broker_id}-${side}`,
  broker_id,
  symbol: "PERP_BTC_USDC",
  side,
  position_qty: side === "LONG" ? "1" : "-1",
  notional,
  average_open_price: "100",
  mark_price: "100",
  est_liq_price: null,
  unrealized_pnl: null,
  leverage: 10,
  margin_mode: "CROSS",
  opened_at: null,
});

describe("summarizePositionExposure", () => {
  it("matches Orderly Dashboard by excluding the internal orderly broker", () => {
    const result = summarizePositionExposure([
      position("LONG", "200", "woofi_pro"),
      position("SHORT", "100", "logx"),
      position("SHORT", "500", "orderly"),
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.longNotional).toBe(200);
    expect(result.shortNotional).toBe(100);
    expect(result.longShare).toBeCloseTo(66.6667, 3);
  });

  it("uses absolute notionals and ignores malformed values", () => {
    const result = summarizePositionExposure([
      position("LONG", "-75", "broker-a"),
      position("SHORT", "invalid", "broker-b"),
    ]);

    expect(result.longNotional).toBe(75);
    expect(result.shortNotional).toBe(0);
    expect(result.longShare).toBe(100);
  });
});
