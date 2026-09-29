import type { PlatformPosition } from "@/services/market-intelligence";

const INTERNAL_ORDERLY_BROKER_ID = "orderly";

export interface PositionExposure {
  rows: PlatformPosition[];
  longNotional: number;
  shortNotional: number;
  longShare: number;
}

// Orderly Dashboard intentionally excludes the protocol's own broker rows and
// derives exposure from the returned positions. The aggregate fields in the
// API response include those internal rows and therefore describe a different
// population.
export function summarizePositionExposure(
  positions: PlatformPosition[],
): PositionExposure {
  const rows = positions.filter(
    (position) =>
      position.broker_id?.toLowerCase() !== INTERNAL_ORDERLY_BROKER_ID,
  );
  let longNotional = 0;
  let shortNotional = 0;

  for (const position of rows) {
    const notional = Math.abs(Number(position.notional));
    if (!Number.isFinite(notional)) continue;
    if (position.side === "LONG") longNotional += notional;
    if (position.side === "SHORT") shortNotional += notional;
  }

  const total = longNotional + shortNotional;
  return {
    rows,
    longNotional,
    shortNotional,
    longShare: total > 0 ? (longNotional / total) * 100 : 50,
  };
}
