import { describe, expect, it } from "vitest";
import type { PlatformPosition } from "@/services/market-intelligence";
import { calculatePositionUnrealizedPnL } from "./position-pnl";

const position = (overrides: Partial<PlatformPosition>): PlatformPosition => ({
  address: "0x1234",
  account_id: "account",
  symbol: "PERP_BTC_USDC",
  side: "LONG",
  position_qty: "1",
  notional: "100",
  average_open_price: "100",
  mark_price: "110",
  est_liq_price: null,
  unrealized_pnl: null,
  leverage: 10,
  margin_mode: "CROSS",
  opened_at: null,
  ...overrides,
});

describe("calculatePositionUnrealizedPnL", () => {
  it("returns a profit when a long position trades above entry", () => {
    expect(
      calculatePositionUnrealizedPnL(
        position({
          position_qty: "2",
          average_open_price: "100",
          mark_price: "110",
        }),
      ),
    ).toBe(20);
  });

  it("returns a loss when a long position trades below entry", () => {
    expect(
      calculatePositionUnrealizedPnL(
        position({
          position_qty: "2",
          average_open_price: "110",
          mark_price: "100",
        }),
      ),
    ).toBe(-20);
  });

  it("returns a loss when a short position trades above entry", () => {
    expect(
      calculatePositionUnrealizedPnL(
        position({
          side: "SHORT",
          position_qty: "-2",
          average_open_price: "100",
          mark_price: "110",
          unrealized_pnl: "999",
        }),
      ),
    ).toBe(-20);
  });

  it("returns a profit when a short position trades below entry", () => {
    expect(
      calculatePositionUnrealizedPnL(
        position({
          side: "SHORT",
          position_qty: "-2",
          average_open_price: "110",
          mark_price: "100",
        }),
      ),
    ).toBe(20);
  });

  it("falls back to the feed value when price inputs are unavailable", () => {
    expect(
      calculatePositionUnrealizedPnL(
        position({ mark_price: "", unrealized_pnl: "12.5" }),
      ),
    ).toBe(12.5);
  });
});
