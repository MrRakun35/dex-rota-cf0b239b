import type { PlatformPosition } from "@/services/market-intelligence";

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calculates linear USDC perpetual price PnL from the displayed entry and mark.
 * The platform feed's `unrealized_pnl` can include unsettled adjustments, so its
 * sign is not guaranteed to describe the price move shown in this table.
 */
export function calculatePositionUnrealizedPnL(
  position: PlatformPosition,
): number {
  const quantity = finiteNumber(position.position_qty);
  const entryPrice = finiteNumber(position.average_open_price);
  const markPrice = finiteNumber(position.mark_price);

  if (
    quantity !== null &&
    quantity !== 0 &&
    entryPrice !== null &&
    entryPrice > 0 &&
    markPrice !== null &&
    markPrice > 0
  ) {
    const side = position.side.toUpperCase();
    const signedQuantity =
      side === "SHORT"
        ? -Math.abs(quantity)
        : side === "LONG"
          ? Math.abs(quantity)
          : quantity;

    return (markPrice - entryPrice) * signedQuantity;
  }

  return finiteNumber(position.unrealized_pnl) ?? 0;
}
