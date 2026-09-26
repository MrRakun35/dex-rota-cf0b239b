import { describe, expect, it } from "vitest";
import { MarginMode, OrderSide } from "@orderly.network/types";
import {
  activationPriceError,
  callbackPercentToValue,
  callbackPercentToRatio,
  callbackRatioToPercent,
  findActiveTSLOrder,
  floorToTick,
  isCallbackRateTickAligned,
  normalizeCallbackPercent,
  roundToTick,
  TSLOrder,
  TSLPosition,
} from "./tsl-utils";

const longPosition = {
  symbol: "PERP_ETH_USDC",
  position_qty: 2,
  margin_mode: MarginMode.CROSS,
} as TSLPosition;

describe("TSL numeric normalization", () => {
  it("converts UI percentages to API ratios without changing modes", () => {
    expect(callbackPercentToRatio(0.1)).toBe("0.001");
    expect(callbackPercentToRatio(1.5)).toBe("0.015");
    expect(callbackPercentToRatio(5)).toBe("0.05");
    expect(callbackPercentToRatio(0.09)).toBeUndefined();
    expect(callbackPercentToRatio(5.1)).toBeUndefined();
  });

  it("rounds callback percentages to the supported 0.1% step", () => {
    expect(normalizeCallbackPercent(1.26)).toBe(1.3);
    expect(callbackRatioToPercent("0.015")).toBe(1.5);
  });

  it("uses quote distance when a decimal percentage misses the API rate tick", () => {
    expect(isCallbackRateTickAligned(2)).toBe(true);
    expect(isCallbackRateTickAligned(2.6)).toBe(false);
    expect(callbackPercentToValue(2.6, 2_000, 0.01, 2)).toBe(52);
    expect(callbackPercentToValue(0.1, 1.25, 0.01, 2)).toBe(0.01);
  });

  it("aligns quantities and prices to exchange ticks", () => {
    expect(floorToTick(0.12349, 0.001, 3)).toBe(0.123);
    expect(roundToTick(2010.126, 0.01, 2)).toBe(2010.13);
  });
});

describe("TSL position safety", () => {
  it("validates activation direction", () => {
    expect(activationPriceError(2100, longPosition, 2000)).toBeUndefined();
    expect(activationPriceError(1900, longPosition, 2000)).toContain("above");

    const shortPosition = {
      ...longPosition,
      position_qty: -2,
    } as TSLPosition;
    expect(activationPriceError(1900, shortPosition, 2000)).toBeUndefined();
    expect(activationPriceError(2100, shortPosition, 2000)).toContain("below");
  });

  it("selects the latest order matching symbol, side and margin mode", () => {
    const orders = [
      {
        algo_order_id: 1,
        symbol: longPosition.symbol,
        algo_type: "TRAILING_STOP",
        side: OrderSide.BUY,
        margin_mode: MarginMode.CROSS,
        updated_time: 3,
      },
      {
        algo_order_id: 2,
        symbol: longPosition.symbol,
        algo_type: "TRAILING_STOP",
        side: OrderSide.SELL,
        margin_mode: MarginMode.CROSS,
        updated_time: 2,
      },
      {
        algo_order_id: 3,
        symbol: longPosition.symbol,
        algo_type: "TRAILING_STOP",
        side: OrderSide.SELL,
        margin_mode: MarginMode.CROSS,
        updated_time: 4,
      },
    ] as TSLOrder[];

    expect(findActiveTSLOrder(orders, longPosition)?.algo_order_id).toBe(3);
  });
});
