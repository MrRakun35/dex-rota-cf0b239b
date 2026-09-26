import {
  API,
  AlgoOrderRootType,
  MarginMode,
  OrderSide,
} from "@orderly.network/types";

export const MIN_CALLBACK_PERCENT = 0.1;
export const MAX_CALLBACK_PERCENT = 5;
export const CALLBACK_RATE_API_TICK = 0.01;

export type TSLPosition = API.PositionTPSLExt | API.PositionExt;
export type TSLOrder = API.AlgoOrder;

export function toFiniteNumber(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeCallbackPercent(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  if (
    parsed === undefined ||
    parsed < MIN_CALLBACK_PERCENT ||
    parsed > MAX_CALLBACK_PERCENT
  ) {
    return undefined;
  }
  return Math.round(parsed * 10) / 10;
}

/** Converts a UI percentage (1.5) into the API ratio ("0.015"). */
export function callbackPercentToRatio(value: unknown): string | undefined {
  const percent = normalizeCallbackPercent(value);
  if (percent === undefined) return undefined;
  return (percent / 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function callbackRatioToPercent(value: unknown): number | undefined {
  const ratio = toFiniteNumber(value);
  if (ratio === undefined || ratio <= 0) return undefined;
  return Math.round(ratio * 1_000) / 10;
}

/**
 * Orderly validates callback_rate in ratio units with a 0.01 tick. That only
 * represents whole percentages (0.01 = 1%). Decimal UI percentages are sent
 * as callback_value instead so values such as 2.6% remain selectable.
 */
export function isCallbackRateTickAligned(value: unknown): boolean {
  const ratio = callbackPercentToRatio(value);
  if (!ratio) return false;
  const steps = Number(ratio) / CALLBACK_RATE_API_TICK;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

export function callbackPercentToValue(
  percentValue: unknown,
  referencePrice: number,
  tick: number,
  precision: number,
): number | undefined {
  const percent = normalizeCallbackPercent(percentValue);
  if (
    percent === undefined ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    !Number.isFinite(tick) ||
    tick <= 0
  ) {
    return undefined;
  }

  return Math.max(
    tick,
    roundToTick(referencePrice * (percent / 100), tick, precision),
  );
}

export function floorToTick(
  value: number,
  tick: number,
  precision: number,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(tick) || tick <= 0) {
    return Number.NaN;
  }
  const steps = Math.floor((value + tick * 1e-9) / tick);
  return Number((steps * tick).toFixed(precision));
}

export function roundToTick(
  value: number,
  tick: number,
  precision: number,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(tick) || tick <= 0) {
    return Number.NaN;
  }
  return Number((Math.round(value / tick) * tick).toFixed(precision));
}

export function closingSide(position: TSLPosition): OrderSide {
  return Number(position.position_qty) > 0 ? OrderSide.SELL : OrderSide.BUY;
}

export function findActiveTSLOrder(
  orders: TSLOrder[] | null | undefined,
  position: TSLPosition | null | undefined,
): TSLOrder | undefined {
  if (!position?.symbol || !orders?.length) return undefined;
  const expectedSide = closingSide(position);
  const expectedMargin = position.margin_mode ?? MarginMode.CROSS;

  return orders
    .filter(
      (order) =>
        order.symbol === position.symbol &&
        order.algo_type === AlgoOrderRootType.TRAILING_STOP &&
        (!order.side || order.side === expectedSide) &&
        (!order.margin_mode || order.margin_mode === expectedMargin),
    )
    .sort(
      (left, right) =>
        Number(right.updated_time || right.created_time || 0) -
        Number(left.updated_time || left.created_time || 0),
    )[0];
}

export function activationPriceError(
  value: unknown,
  position: TSLPosition | null | undefined,
  markPrice: number | undefined,
): string | undefined {
  const price = toFiniteNumber(value);
  if (value === "" || value === null || value === undefined) return undefined;
  if (price === undefined || price <= 0) {
    return "Please enter a valid activation price.";
  }
  if (!position || !markPrice || markPrice <= 0) return undefined;

  const isLong = Number(position.position_qty) > 0;
  if (isLong && price <= markPrice) {
    return "For a long position, activation price must be above the current mark price.";
  }
  if (!isLong && price >= markPrice) {
    return "For a short position, activation price must be below the current mark price.";
  }
  return undefined;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
