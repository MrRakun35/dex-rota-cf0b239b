import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  AreaChart,
  BarChart3,
  BookOpen,
  CandlestickChart,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Flame,
  Gauge,
  Layers3,
  Minus,
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  Waves,
} from "lucide-react";
import {
  FundingComparisonRow,
  IntelligenceEnvelope,
  MarketDetail,
  MarketSnapshot,
  PlatformPosition,
  intelligenceQuery,
} from "@/services/market-intelligence";
import "./intelligence.css";

type Metric =
  | "overview"
  | "liquidations"
  | "open-interest"
  | "positions"
  | "funding"
  | "funding-arbitrage"
  | "volume"
  | "orderbook"
  | "screener";

interface SummaryData {
  total_24h_volume: string | null;
  total_open_interest: string | null;
  markets: MarketSnapshot[];
}

interface PositionsData {
  total_long_notional: string;
  total_short_notional: string;
  total_positions: number;
  rows: PlatformPosition[];
}

interface LiquidationEvent {
  symbol: string;
  side: string;
  price: number;
  notional: number;
  timestamp: number;
}

interface CandlePoint {
  timestamp: number;
  close: number;
}

const metricItems: Array<{
  id: Metric;
  label: string;
  description: string;
  icon: typeof Activity;
}> = [
  {
    id: "overview",
    label: "Market Overview",
    description: "Network pulse",
    icon: Gauge,
  },
  {
    id: "liquidations",
    label: "Liquidation Map",
    description: "Risk price clusters",
    icon: Flame,
  },
  {
    id: "open-interest",
    label: "Open Interest",
    description: "Capital concentration",
    icon: Layers3,
  },
  {
    id: "positions",
    label: "Position Map",
    description: "Long / short exposure",
    icon: CandlestickChart,
  },
  {
    id: "funding",
    label: "Funding Rates",
    description: "Current and historical",
    icon: CircleDollarSign,
  },
  {
    id: "funding-arbitrage",
    label: "Funding Arbitrage",
    description: "Cross-venue spreads",
    icon: TrendingUp,
  },
  {
    id: "volume",
    label: "Volume & Volatility",
    description: "Flow and movers",
    icon: BarChart3,
  },
  {
    id: "orderbook",
    label: "Orderbook Depth",
    description: "Liquidity walls",
    icon: BookOpen,
  },
  {
    id: "screener",
    label: "Market Screener",
    description: "All perpetuals",
    icon: AreaChart,
  },
];

const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: unknown, compact = true) => {
  const parsed = number(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 0,
  }).format(parsed);
};

const percent = (value: unknown, scale = 100) =>
  `${(number(value) * scale).toFixed(4)}%`;
const cleanSymbol = (symbol: string) =>
  symbol.replace(/^PERP_/, "").replace(/_USDC(?:[._].*)?$/, "");

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="mi-skeleton" aria-label="Loading market intelligence">
      <div className="mi-loader-copy">
        <RefreshCw size={15} /> Loading live market data…
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <i key={index} style={{ width: `${92 - index * 5}%` }} />
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mi-empty">
      <Waves size={22} />
      <span>{message}</span>
    </div>
  );
}

function Card({
  title,
  note,
  children,
  className = "",
  action,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`mi-card ${className}`}>
      <header>
        <div>
          <h3>{title}</h3>
          {note && <p>{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function HorizontalBars({
  rows,
  valueLabel = money,
}: {
  rows: Array<{
    label: string;
    value: number;
    tone?: "green" | "red" | "purple";
  }>;
  valueLabel?: (value: number) => string;
}) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  return (
    <div className="mi-bars">
      {rows.map((row) => (
        <div className="mi-bar-row" key={row.label}>
          <span>{row.label}</span>
          <div>
            <i
              className={row.tone || "purple"}
              style={{
                width: `${Math.max(2, (Math.abs(row.value) / max) * 100)}%`,
              }}
            />
          </div>
          <strong>{valueLabel(row.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function LineChart({
  points,
  color = "#8b7cff",
  baseline,
  valueLabel = (value) =>
    value.toLocaleString("en-US", { maximumFractionDigits: 2 }),
  startLabel = "Oldest",
  endLabel = "Latest",
}: {
  points: number[];
  color?: string;
  baseline?: number;
  valueLabel?: (value: number) => string;
  startLabel?: string;
  endLabel?: string;
}) {
  if (points.length < 2)
    return <EmptyState message="Not enough observations for this chart yet." />;
  const width = 800;
  const height = 260;
  const pad = 24;
  const min = Math.min(...points, baseline ?? Infinity);
  const max = Math.max(...points, baseline ?? -Infinity);
  const spread = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = pad + ((max - point) / spread) * (height - pad * 2);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const baselineY =
    baseline == null
      ? null
      : pad + ((max - baseline) / spread) * (height - pad * 2);
  return (
    <div className="mi-line-chart">
      <div className="mi-line-y-labels">
        <span>{valueLabel(max)}</span>
        <span>{valueLabel(min)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient
            id={`fade-${color.replace("#", "")}`}
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0" stopColor={color} stopOpacity=".35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={pad}
            x2={width - pad}
            y1={pad + (height - pad * 2) * ratio}
            y2={pad + (height - pad * 2) * ratio}
            className="mi-chart-grid"
          />
        ))}
        {baselineY != null && (
          <line
            x1={pad}
            x2={width - pad}
            y1={baselineY}
            y2={baselineY}
            className="mi-zero-line"
          />
        )}
        <path
          d={`${path} L${width - pad},${height - pad} L${pad},${height - pad} Z`}
          fill={`url(#fade-${color.replace("#", "")})`}
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mi-line-x-labels">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

function LiquidationPriceChart({
  positions,
  candles,
  mark,
  range,
}: {
  positions: PlatformPosition[];
  candles: CandlePoint[];
  mark: number;
  range: "7d" | "30d";
}) {
  const width = 1040;
  const height = 520;
  const left = 66;
  const right = 96;
  const top = 28;
  const bottom = 48;
  const visiblePositions = positions.filter((position) => {
    const price = number(position.est_liq_price);
    return price > mark * 0.72 && price < mark * 1.28;
  });
  if (!visiblePositions.length || candles.length < 2)
    return (
      <EmptyState message="There is not enough open-position history to build this liquidation map." />
    );

  const priceValues = [
    ...candles.map((candle) => candle.close),
    ...visiblePositions.map((position) => number(position.est_liq_price)),
    mark,
  ];
  const rawMin = Math.min(...priceValues);
  const rawMax = Math.max(...priceValues);
  const margin = Math.max((rawMax - rawMin) * 0.055, mark * 0.004);
  const min = rawMin - margin;
  const max = rawMax + margin;
  const spread = max - min || 1;
  const rows = 28;
  const rowSize = spread / rows;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const cellWidth = plotWidth / candles.length;
  const cellHeight = plotHeight / rows;
  const y = (value: number) => top + ((max - value) / spread) * plotHeight;
  const x = (index: number) =>
    left + (index / Math.max(candles.length - 1, 1)) * plotWidth;
  const cells = Array.from({ length: rows }, () =>
    Array.from({ length: candles.length }, () => ({ long: 0, short: 0 })),
  );

  visiblePositions.forEach((position) => {
    const price = number(position.est_liq_price);
    const row = Math.min(
      rows - 1,
      Math.max(0, Math.floor((max - price) / rowSize)),
    );
    const openedAt = number(position.opened_at) || candles[0].timestamp;
    candles.forEach((candle, index) => {
      if (candle.timestamp < openedAt) return;
      const side = position.side === "SHORT" ? "short" : "long";
      cells[row][index][side] += Math.abs(number(position.notional));
    });
  });

  const maxSideIntensity = Math.max(
    ...cells.flatMap((row) => row.flatMap((cell) => [cell.long, cell.short])),
    1,
  );
  const opacity = (value: number) =>
    value ? 0.12 + (0.8 * Math.log1p(value)) / Math.log1p(maxSideIntensity) : 0;
  const pricePath = candles
    .map(
      (candle, index) => `${index ? "L" : "M"}${x(index)},${y(candle.close)}`,
    )
    .join(" ");
  const priceTicks = Array.from(
    { length: 7 },
    (_, index) => max - (index / 6) * spread,
  );
  const timeTicks = Array.from({ length: 5 }, (_, index) =>
    Math.round((index / 4) * (candles.length - 1)),
  );
  const latestRows = cells.map((row, index) => ({
    price: max - (index + 0.5) * rowSize,
    long: row.at(-1)?.long || 0,
    short: row.at(-1)?.short || 0,
  }));
  const topLong = [...latestRows].sort((a, b) => b.long - a.long)[0];
  const topShort = [...latestRows].sort((a, b) => b.short - a.short)[0];
  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  return (
    <div className="mi-price-heatmap">
      <div className="mi-risk-summary">
        <div className="long">
          <span>Largest long liquidation cluster</span>
          <strong>{topLong.long ? money(topLong.price, false) : "—"}</strong>
          <small>
            {topLong.long
              ? `${money(topLong.long)} current notional`
              : "No visible cluster"}
          </small>
        </div>
        <div className="short">
          <span>Largest short liquidation cluster</span>
          <strong>{topShort.short ? money(topShort.price, false) : "—"}</strong>
          <small>
            {topShort.short
              ? `${money(topShort.short)} current notional`
              : "No visible cluster"}
          </small>
        </div>
        <div>
          <span>Positions represented</span>
          <strong>{visiblePositions.length}</strong>
          <small>Currently open · within ±28% of mark</small>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Long and short liquidation exposure accumulated across the ${range === "7d" ? "seven-day" : "thirty-day"} price path`}
      >
        <rect
          x={left}
          y={top}
          width={plotWidth}
          height={plotHeight}
          className="mi-heat-plot-bg"
        />
        {priceTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              className="mi-heat-grid"
            />
            <text
              x={width - right + 11}
              y={y(tick) + 4}
              className="mi-heat-axis"
            >
              {money(tick, false)}
            </text>
          </g>
        ))}
        {cells.flatMap((row, rowIndex) =>
          row.map((cell, columnIndex) => {
            if (!cell.long && !cell.short) return null;
            const dominant = cell.long >= cell.short ? "long" : "short";
            const strength = opacity(Math.max(cell.long, cell.short));
            const price = max - (rowIndex + 0.5) * rowSize;
            return (
              <rect
                key={`${rowIndex}-${columnIndex}`}
                x={left + columnIndex * cellWidth}
                y={top + rowIndex * cellHeight}
                width={Math.max(cellWidth + 0.35, 0.8)}
                height={Math.max(cellHeight + 0.35, 0.8)}
                fill={
                  dominant === "long"
                    ? `rgba(241,93,121,${strength})`
                    : `rgba(40,221,166,${strength})`
                }
              >
                <title>{`${formatDate(candles[columnIndex].timestamp)} · ${money(price, false)} · Long ${money(cell.long)} · Short ${money(cell.short)}`}</title>
              </rect>
            );
          }),
        )}
        <path
          d={pricePath}
          fill="none"
          stroke="#f7f5ff"
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
          className="mi-heat-price-path"
        />
        <line
          x1={left}
          x2={width - right}
          y1={y(mark)}
          y2={y(mark)}
          className="mi-mark-line"
        />
        <rect
          x={width - right - 62}
          y={y(mark) - 12}
          width="62"
          height="24"
          rx="4"
          className="mi-mark-label-bg"
        />
        <text
          x={width - right - 31}
          y={y(mark) + 4}
          textAnchor="middle"
          className="mi-mark-label"
        >
          MARK
        </text>
        {timeTicks.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={height - 13}
            textAnchor={
              index === 0
                ? "start"
                : index === candles.length - 1
                  ? "end"
                  : "middle"
            }
            className="mi-heat-axis"
          >
            {formatDate(candles[index].timestamp)}
          </text>
        ))}
      </svg>
      <div className="mi-heat-explainer">
        <span className="long">
          <i />
          Long liquidation exposure
        </span>
        <span className="short">
          <i />
          Short liquidation exposure
        </span>
        <span className="price">
          <i />
          Market price
        </span>
        <strong>Darker → brighter means more open notional</strong>
      </div>
      <p className="mi-data-caveat">
        Each position starts contributing from its actual opening time and
        remains visible while it is open. Closed positions cannot be
        reconstructed by the public current-position feed, so this is an
        exposure history of positions open now—not a complete archive of every
        past position.
      </p>
    </div>
  );
}

function parseCandleClose(candle: Record<string, unknown> | unknown[]): number {
  if (Array.isArray(candle)) return number(candle[4]);
  return number(candle.close ?? candle.c ?? candle["close_price"]);
}

function parseCandleTimestamp(
  candle: Record<string, unknown> | unknown[],
): number {
  if (Array.isArray(candle)) return number(candle[0]);
  return number(candle.timestamp ?? candle.t ?? candle["start_time"]);
}

function parseFunding(row: Record<string, unknown>): number {
  return number(row.funding_rate ?? row.rate ?? row.fundingRate);
}

function parseLiquidations(raw: unknown): LiquidationEvent[] {
  const data = raw as { rows?: Array<Record<string, unknown>> } | undefined;
  const rows = data?.rows || [];
  return rows
    .flatMap((row) => {
      const nested = Array.isArray(row.positions_by_perp)
        ? (row.positions_by_perp as Array<Record<string, unknown>>)
        : [row];
      return nested.map((position) => {
        const qty = Math.abs(
          number(position.position_qty ?? position.quantity),
        );
        const price = number(
          position.transfer_price ??
            position.price ??
            position.liquidation_price,
        );
        return {
          symbol: String(position.symbol ?? row.symbol ?? "—"),
          side: String(
            position.side ??
              (number(position.position_qty) > 0 ? "LONG" : "SHORT"),
          ),
          price,
          notional: number(position.notional) || qty * price,
          timestamp: number(row.timestamp ?? row.created_time),
        };
      });
    })
    .filter((event) => event.price > 0);
}

export default function IntelligencePage() {
  const [metric, setMetric] = useState<Metric>("overview");
  const [fontScale, setFontScale] = useState(1.08);
  const [liquidationRange, setLiquidationRange] = useState<"7d" | "30d">("7d");
  const [symbol, setSymbol] = useState("PERP_BTC_USDC");
  const [search, setSearch] = useState("");
  const [summary, setSummary] =
    useState<IntelligenceEnvelope<SummaryData> | null>(null);
  const [positions, setPositions] =
    useState<IntelligenceEnvelope<PositionsData> | null>(null);
  const [funding, setFunding] = useState<IntelligenceEnvelope<{
    rows: FundingComparisonRow[];
  }> | null>(null);
  const [detail, setDetail] =
    useState<IntelligenceEnvelope<MarketDetail> | null>(null);
  const [liquidations, setLiquidations] = useState<IntelligenceEnvelope<{
    rows: Array<Record<string, unknown>>;
  }> | null>(null);
  const [loading, setLoading] = useState({ summary: true, symbol: true });
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading((current) => ({ ...current, summary: true }));
    intelligenceQuery<SummaryData>({ type: "marketSummary" }, controller.signal)
      .then((result) => {
        setSummary(result);
        setSymbol((currentSymbol) =>
          result.data.markets.some((market) => market.symbol === currentSymbol)
            ? currentSymbol
            : result.data.markets[0]?.symbol || currentSymbol,
        );
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading((current) => ({ ...current, summary: false })));
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading((current) => ({ ...current, symbol: true }));
    const end = Date.now();
    const candleInterval = liquidationRange === "30d" ? "4h" : "1h";
    const candleLimit = liquidationRange === "30d" ? 180 : 168;
    Promise.allSettled([
      intelligenceQuery<PositionsData>(
        { type: "platformPositions", symbol, min_notional: "100", limit: 500 },
        controller.signal,
      ),
      intelligenceQuery<{ rows: FundingComparisonRow[] }>(
        { type: "fundingComparison", symbol },
        controller.signal,
      ),
      intelligenceQuery<MarketDetail>(
        {
          type: "marketDetail",
          symbol,
          include: [
            "market_info",
            "orderbook",
            "recent_trades",
            "funding_history",
            "candles",
          ],
          orderbook_levels: 50,
          recent_trades_limit: 50,
          funding_history_limit: 90,
          candles_interval: candleInterval,
          candles_limit: candleLimit,
        },
        controller.signal,
      ),
      intelligenceQuery<{ rows: Array<Record<string, unknown>> }>(
        {
          type: "liquidations",
          symbol,
          start_time: end - 24 * 60 * 60 * 1000,
          end_time: end,
          limit: 500,
        },
        controller.signal,
      ),
    ])
      .then(
        ([positionResult, fundingResult, detailResult, liquidationResult]) => {
          if (positionResult.status === "fulfilled")
            setPositions(positionResult.value);
          if (fundingResult.status === "fulfilled")
            setFunding(fundingResult.value);
          if (detailResult.status === "fulfilled")
            setDetail(detailResult.value);
          if (liquidationResult.status === "fulfilled")
            setLiquidations(liquidationResult.value);
          const rejected = [positionResult, fundingResult, detailResult].find(
            (item) => item.status === "rejected",
          );
          if (rejected?.status === "rejected")
            setError(
              rejected.reason instanceof Error
                ? rejected.reason.message
                : "Some metrics are unavailable",
            );
          else setError(null);
        },
      )
      .finally(() => setLoading((current) => ({ ...current, symbol: false })));
    return () => controller.abort();
  }, [symbol, refreshKey, liquidationRange]);

  const markets = useMemo(
    () => summary?.data.markets || [],
    [summary?.data.markets],
  );
  const current =
    markets.find((market) => market.symbol === symbol) || markets[0];
  const filteredMarkets = useMemo(
    () =>
      markets.filter((market) =>
        cleanSymbol(market.symbol).toLowerCase().includes(search.toLowerCase()),
      ),
    [markets, search],
  );
  const change = current
    ? (number(current["24h_close"]) - number(current["24h_open"])) /
      Math.max(number(current["24h_open"]), 1)
    : 0;
  const spreadBps = current
    ? ((number(current.ask_price) - number(current.bid_price)) /
        Math.max(number(current.mark_price), 1)) *
      10000
    : 0;
  const positionRows = useMemo(
    () => positions?.data.rows || [],
    [positions?.data.rows],
  );
  const longNotional = number(positions?.data.total_long_notional);
  const shortNotional = number(positions?.data.total_short_notional);
  const longShare =
    longNotional + shortNotional
      ? (longNotional / (longNotional + shortNotional)) * 100
      : 50;
  const fundingRows = funding?.data.rows || [];
  const selectedFunding =
    fundingRows.find((row) => row.symbol === symbol) || fundingRows[0];
  const orderlyFunding = selectedFunding?.exchanges.find(
    (venue) => venue.name.toLowerCase() === "orderly",
  );
  const fundingHistory = (detail?.data.funding_history || [])
    .map((row) => parseFunding(row))
    .filter(Number.isFinite);
  const candlePoints = useMemo(
    () =>
      (detail?.data.candles || [])
        .map((candle) => ({
          timestamp: parseCandleTimestamp(candle),
          close: parseCandleClose(candle),
        }))
        .filter((candle) => candle.timestamp > 0 && candle.close > 0)
        .sort((a, b) => a.timestamp - b.timestamp),
    [detail?.data.candles],
  );
  const candleCloses = candlePoints.map((candle) => candle.close);
  const pulseHigh = candleCloses.length ? Math.max(...candleCloses) : 0;
  const pulseLow = candleCloses.length ? Math.min(...candleCloses) : 0;
  const pulseChange =
    candleCloses.length > 1
      ? ((candleCloses.at(-1) || 0) - candleCloses[0]) /
        Math.max(candleCloses[0], 1)
      : null;
  const liquidationEvents = parseLiquidations(liquidations?.data);

  const openInterestRows = useMemo(
    () =>
      [...markets]
        .sort(
          (a, b) =>
            number(b.open_interest) * number(b.mark_price) -
            number(a.open_interest) * number(a.mark_price),
        )
        .slice(0, 14)
        .map((market) => ({
          label: cleanSymbol(market.symbol),
          value: number(market.open_interest) * number(market.mark_price),
        })),
    [markets],
  );
  const volumeRows = useMemo(
    () =>
      [...markets]
        .sort((a, b) => number(b["24h_amount"]) - number(a["24h_amount"]))
        .slice(0, 14)
        .map((market) => ({
          label: cleanSymbol(market.symbol),
          value: number(market["24h_amount"]),
        })),
    [markets],
  );

  const renderLiquidationMap = () => (
    <div className="mi-two-column mi-liquidation-layout">
      <Card
        title={`${cleanSymbol(symbol)} Liquidation Heatmap`}
        note="When currently open long and short liquidation exposure appeared along the price path"
        className="mi-wide-card"
        action={
          <div
            className="mi-range-switch"
            aria-label="Liquidation heatmap period"
          >
            <button
              className={liquidationRange === "7d" ? "active" : ""}
              onClick={() => setLiquidationRange("7d")}
            >
              7D
            </button>
            <button
              className={liquidationRange === "30d" ? "active" : ""}
              onClick={() => setLiquidationRange("30d")}
            >
              30D
            </button>
          </div>
        }
      >
        {loading.symbol ? (
          <Skeleton rows={8} />
        ) : (
          <LiquidationPriceChart
            positions={positionRows}
            candles={candlePoints}
            mark={number(current?.mark_price)}
            range={liquidationRange}
          />
        )}
      </Card>
      <Card
        title="24H Liquidation Feed"
        note="Forced closures already completed; separate from the estimated zones"
      >
        {loading.symbol ? (
          <Skeleton />
        ) : liquidationEvents.length ? (
          <div className="mi-event-list">
            {liquidationEvents.slice(0, 12).map((event, index) => (
              <div key={`${event.timestamp}-${index}`}>
                <span className={event.side === "LONG" ? "loss" : "gain"}>
                  {event.side}
                </span>
                <strong>{money(event.notional)}</strong>
                <small>@ {money(event.price, false)}</small>
                <time>
                  {event.timestamp
                    ? new Date(event.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No completed liquidations were returned for the selected period." />
        )}
      </Card>
    </div>
  );

  const renderContent = () => {
    if (metric === "liquidations") return renderLiquidationMap();
    if (metric === "open-interest")
      return (
        <div className="mi-two-column">
          <Card
            title="Open Interest by Market"
            note="Dollar value of contracts still open, ranked by market"
            className="mi-wide-card"
          >
            {loading.summary ? (
              <Skeleton rows={10} />
            ) : (
              <HorizontalBars rows={openInterestRows} />
            )}
          </Card>
          <Card
            title="Selected Market"
            note={`${cleanSymbol(symbol)} concentration and turnover`}
          >
            <div className="mi-stat-stack">
              <div>
                <span>Open interest</span>
                <strong>
                  {money(
                    number(current?.open_interest) *
                      number(current?.mark_price),
                  )}
                </strong>
              </div>
              <div>
                <span>Network share</span>
                <strong>
                  {percent(
                    (number(current?.open_interest) *
                      number(current?.mark_price)) /
                      Math.max(number(summary?.data.total_open_interest), 1),
                  )}
                </strong>
              </div>
              <div>
                <span>24H volume / OI</span>
                <strong>
                  {(
                    number(current?.["24h_amount"]) /
                    Math.max(
                      number(current?.open_interest) *
                        number(current?.mark_price),
                      1,
                    )
                  ).toFixed(2)}
                  ×
                </strong>
              </div>
            </div>
            <p className="mi-card-help">
              Volume / OI shows how often the open position base turned over
              during the last 24 hours.
            </p>
          </Card>
        </div>
      );
    if (metric === "positions")
      return (
        <div className="mi-two-column">
          <Card
            title="Long / Short Exposure"
            note={`${positionRows.length} visible positions`}
          >
            <div className="mi-ratio">
              <div style={{ width: `${longShare}%` }} />
              <i style={{ width: `${100 - longShare}%` }} />
            </div>
            <div className="mi-ratio-labels">
              <span>
                Long <strong>{longShare.toFixed(1)}%</strong>
                <small>{money(longNotional)}</small>
              </span>
              <span>
                Short <strong>{(100 - longShare).toFixed(1)}%</strong>
                <small>{money(shortNotional)}</small>
              </span>
            </div>
          </Card>
          <Card title="Leverage Distribution" note="Visible platform positions">
            <HorizontalBars
              rows={[1, 2, 3, 5, 10, 20, 50].map((lev, index, values) => ({
                label: index === values.length - 1 ? `${lev}×+` : `≤ ${lev}×`,
                value: positionRows
                  .filter(
                    (row) =>
                      number(row.leverage) <= lev &&
                      (index === 0 || number(row.leverage) > values[index - 1]),
                  )
                  .reduce(
                    (sum, row) => sum + Math.abs(number(row.notional)),
                    0,
                  ),
              }))}
            />
          </Card>
          <Card
            title="Largest Open Positions"
            note="Wallets are shortened"
            className="mi-full-card"
          >
            <div className="mi-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Side</th>
                    <th>Notional</th>
                    <th>Entry</th>
                    <th>Mark</th>
                    <th>Liquidation</th>
                    <th>Leverage</th>
                    <th>uPnL</th>
                  </tr>
                </thead>
                <tbody>
                  {[...positionRows]
                    .sort((a, b) => number(b.notional) - number(a.notional))
                    .slice(0, 20)
                    .map((row, index) => (
                      <tr key={`${row.account_id}-${index}`}>
                        <td>
                          {row.address
                            ? `${row.address.slice(0, 6)}…${row.address.slice(-4)}`
                            : "—"}
                        </td>
                        <td>
                          <span
                            className={row.side === "LONG" ? "gain" : "loss"}
                          >
                            {row.side}
                          </span>
                        </td>
                        <td>{money(row.notional)}</td>
                        <td>{money(row.average_open_price, false)}</td>
                        <td>{money(row.mark_price, false)}</td>
                        <td>
                          {row.est_liq_price
                            ? money(row.est_liq_price, false)
                            : "—"}
                        </td>
                        <td>{row.leverage ? `${row.leverage}×` : "—"}</td>
                        <td
                          className={
                            number(row.unrealized_pnl) >= 0 ? "gain" : "loss"
                          }
                        >
                          {money(row.unrealized_pnl)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      );
    if (metric === "funding")
      return (
        <div className="mi-two-column">
          <Card
            title="Funding Rate History"
            note={`${cleanSymbol(symbol)} · periodic payments between long and short positions`}
            className="mi-wide-card"
          >
            {loading.symbol ? (
              <Skeleton />
            ) : (
              <LineChart
                points={fundingHistory}
                color="#f3c969"
                baseline={0}
                valueLabel={(value) => percent(value)}
                startLabel="Oldest settlement"
                endLabel="Latest settlement"
              />
            )}
            <div className="mi-chart-footer">
              <span>
                Last settled{" "}
                <strong>{percent(current?.last_funding_rate)}</strong>
              </span>
              <span>
                Estimated{" "}
                <strong
                  className={
                    number(current?.est_funding_rate) >= 0 ? "gain" : "loss"
                  }
                >
                  {percent(current?.est_funding_rate)}
                </strong>
              </span>
              <span>
                Next funding{" "}
                <strong>
                  {current?.next_funding_time
                    ? new Date(current.next_funding_time).toLocaleTimeString(
                        [],
                        { hour: "2-digit", minute: "2-digit" },
                      )
                    : "—"}
                </strong>
              </span>
            </div>
          </Card>
          <Card
            title="Funding Snapshot"
            note="Positive funding usually means longs pay shorts"
          >
            <div className="mi-stat-stack">
              <div>
                <span>Latest</span>
                <strong>
                  {percent(orderlyFunding?.last ?? current?.last_funding_rate)}
                </strong>
              </div>
              <div>
                <span>1 day avg.</span>
                <strong>{percent(orderlyFunding?.["1d"])}</strong>
              </div>
              <div>
                <span>7 day avg.</span>
                <strong>{percent(orderlyFunding?.["7d"])}</strong>
              </div>
              <div>
                <span>30 day avg.</span>
                <strong>{percent(orderlyFunding?.["30d"])}</strong>
              </div>
            </div>
          </Card>
        </div>
      );
    if (metric === "funding-arbitrage")
      return (
        <Card
          title={`${cleanSymbol(symbol)} Cross-Venue Funding`}
          note="Positive spread can indicate a hedged funding opportunity; fees are not included"
        >
          <div className="mi-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Latest</th>
                  <th>1D avg.</th>
                  <th>7D avg.</th>
                  <th>30D avg.</th>
                  <th>vs Rota liquidity</th>
                </tr>
              </thead>
              <tbody>
                {(selectedFunding?.exchanges || [])
                  .sort((a, b) => number(b.last) - number(a.last))
                  .map((venue) => (
                    <tr key={venue.name}>
                      <td className="mi-venue">{venue.name}</td>
                      <td className={number(venue.last) >= 0 ? "gain" : "loss"}>
                        {percent(venue.last)}
                      </td>
                      <td>{percent(venue["1d"])}</td>
                      <td>{percent(venue["7d"])}</td>
                      <td>{percent(venue["30d"])}</td>
                      <td>
                        {percent(
                          number(venue.last) - number(orderlyFunding?.last),
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="mi-warning">
            <AlertTriangle size={15} /> Funding spreads are informational.
            Execution fees, interval differences, slippage and hedge risk can
            remove the apparent return.
          </div>
        </Card>
      );
    if (metric === "volume")
      return (
        <div className="mi-two-column">
          <Card
            title="24H Volume Leaders"
            note="Notional turnover"
            className="mi-wide-card"
          >
            {loading.summary ? (
              <Skeleton rows={10} />
            ) : (
              <HorizontalBars rows={volumeRows} />
            )}
          </Card>
          <Card
            title="Price Range"
            note={`${cleanSymbol(symbol)} intraday volatility`}
          >
            <div className="mi-stat-stack">
              <div>
                <span>24H high</span>
                <strong>{money(current?.["24h_high"], false)}</strong>
              </div>
              <div>
                <span>24H low</span>
                <strong>{money(current?.["24h_low"], false)}</strong>
              </div>
              <div>
                <span>High / low range</span>
                <strong>
                  {percent(
                    (number(current?.["24h_high"]) -
                      number(current?.["24h_low"])) /
                      Math.max(number(current?.["24h_low"]), 1),
                  )}
                </strong>
              </div>
              <div>
                <span>Turnover</span>
                <strong>{money(current?.["24h_amount"])}</strong>
              </div>
            </div>
          </Card>
        </div>
      );
    if (metric === "orderbook") {
      const asks = detail?.data.orderbook?.asks || [];
      const bids = detail?.data.orderbook?.bids || [];
      const depthRows = (side: typeof asks, reverse = false) => {
        let sum = 0;
        const rows = side.slice(0, 20).map((row) => ({
          label: money(row.price, false),
          value: (sum += number(row.price) * number(row.quantity)),
        }));
        return reverse ? rows.reverse() : rows;
      };
      return (
        <div className="mi-two-column">
          <Card title="Bid Depth" note="Cumulative buy liquidity">
            <HorizontalBars
              rows={depthRows(bids).map((row) => ({
                ...row,
                tone: "green" as const,
              }))}
            />
          </Card>
          <Card title="Ask Depth" note="Cumulative sell liquidity">
            <HorizontalBars
              rows={depthRows(asks).map((row) => ({
                ...row,
                tone: "red" as const,
              }))}
            />
          </Card>
          <Card
            title="Liquidity Quality"
            note={cleanSymbol(symbol)}
            className="mi-full-card"
          >
            <div className="mi-kpi-grid">
              <div>
                <span>Best bid</span>
                <strong>{money(current?.bid_price, false)}</strong>
              </div>
              <div>
                <span>Best ask</span>
                <strong>{money(current?.ask_price, false)}</strong>
              </div>
              <div>
                <span>Spread</span>
                <strong>{spreadBps.toFixed(2)} bps</strong>
              </div>
              <div>
                <span>Top-20 bid depth</span>
                <strong>{money(depthRows(bids).at(-1)?.value)}</strong>
              </div>
              <div>
                <span>Top-20 ask depth</span>
                <strong>{money(depthRows(asks).at(-1)?.value)}</strong>
              </div>
            </div>
          </Card>
        </div>
      );
    }
    if (metric === "screener")
      return (
        <Card
          title="Perpetual Market Screener"
          note={`${filteredMarkets.length} active markets`}
        >
          <div className="mi-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Mark</th>
                  <th>24H</th>
                  <th>24H volume</th>
                  <th>Open interest</th>
                  <th>Funding</th>
                  <th>Spread</th>
                  <th>Max leverage</th>
                </tr>
              </thead>
              <tbody>
                {filteredMarkets.map((market) => {
                  const move =
                    (number(market["24h_close"]) - number(market["24h_open"])) /
                    Math.max(number(market["24h_open"]), 1);
                  const spread =
                    ((number(market.ask_price) - number(market.bid_price)) /
                      Math.max(number(market.mark_price), 1)) *
                    10000;
                  return (
                    <tr
                      key={market.symbol}
                      onClick={() => setSymbol(market.symbol)}
                      className={market.symbol === symbol ? "is-selected" : ""}
                    >
                      <td>
                        <strong>{cleanSymbol(market.symbol)}</strong>
                        <small>PERP</small>
                      </td>
                      <td>{money(market.mark_price, false)}</td>
                      <td className={move >= 0 ? "gain" : "loss"}>
                        {percent(move)}
                      </td>
                      <td>{money(market["24h_amount"])}</td>
                      <td>
                        {money(
                          number(market.open_interest) *
                            number(market.mark_price),
                        )}
                      </td>
                      <td
                        className={
                          number(market.est_funding_rate) >= 0 ? "gain" : "loss"
                        }
                      >
                        {percent(market.est_funding_rate)}
                      </td>
                      <td>{spread.toFixed(2)} bps</td>
                      <td>{market.max_leverage}×</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      );
    return (
      <div className="mi-dashboard-grid">
        <div className="mi-kpi-card">
          <span>24H Network Volume</span>
          <strong>{money(summary?.data.total_24h_volume)}</strong>
          <small>
            Capital traded across {markets.length} perpetual markets
          </small>
        </div>
        <div className="mi-kpi-card">
          <span>Total Open Interest</span>
          <strong>{money(summary?.data.total_open_interest)}</strong>
          <small>Dollar value of contracts still open</small>
        </div>
        <div className="mi-kpi-card">
          <span>{cleanSymbol(symbol)} 24H Move</span>
          <strong className={change >= 0 ? "gain" : "loss"}>
            {percent(change)}
          </strong>
          <small>{money(current?.["24h_amount"])} traded</small>
        </div>
        <div className="mi-kpi-card">
          <span>Visible Position Bias</span>
          <strong>{longShare.toFixed(1)}% long</strong>
          <small>Share of sampled position notional held long</small>
        </div>
        <Card
          title={`${cleanSymbol(symbol)} Market Pulse`}
          note={`${liquidationRange === "30d" ? "Four-hour" : "Hourly"} closing price over the last ${liquidationRange === "30d" ? "30 days" : "seven days"} — direction and volatility at a glance`}
          className="mi-overview-chart"
        >
          {loading.symbol ? (
            <Skeleton />
          ) : (
            <LineChart
              points={candleCloses}
              valueLabel={(value) => money(value, false)}
              startLabel={liquidationRange === "30d" ? "30D ago" : "7D ago"}
              endLabel="Now"
            />
          )}
          <div className="mi-pulse-summary">
            <span>
              <small>Line represents</small>
              <strong>
                {liquidationRange === "30d" ? "4-hour" : "Hourly"} close price
              </strong>
            </span>
            <span>
              <small>{liquidationRange === "30d" ? "30D" : "7D"} high</small>
              <strong>{pulseHigh ? money(pulseHigh, false) : "—"}</strong>
            </span>
            <span>
              <small>{liquidationRange === "30d" ? "30D" : "7D"} low</small>
              <strong>{pulseLow ? money(pulseLow, false) : "—"}</strong>
            </span>
            <span>
              <small>{liquidationRange === "30d" ? "30D" : "7D"} change</small>
              <strong
                className={
                  pulseChange == null ? "" : pulseChange >= 0 ? "gain" : "loss"
                }
              >
                {pulseChange == null ? "—" : percent(pulseChange)}
              </strong>
            </span>
          </div>
          <div className="mi-chart-footer">
            <span>
              Mark <strong>{money(current?.mark_price, false)}</strong>
            </span>
            <span>
              Index <strong>{money(current?.index_price, false)}</strong>
            </span>
            <span>
              Spread <strong>{spreadBps.toFixed(2)} bps</strong>
            </span>
          </div>
        </Card>
        <Card
          title="Open Interest Leaders"
          note="Markets carrying the largest open contract value"
          className="mi-overview-bars"
        >
          {loading.summary ? (
            <Skeleton />
          ) : (
            <HorizontalBars rows={openInterestRows.slice(0, 8)} />
          )}
        </Card>
        <div className="mi-overview-liquidations">{renderLiquidationMap()}</div>
      </div>
    );
  };

  return (
    <main
      className="mi-page"
      style={{ "--mi-font-scale": fontScale } as React.CSSProperties}
    >
      <aside className="mi-sidebar">
        <div className="mi-side-heading">
          <span>ROTA</span>
          <strong>Intelligence</strong>
          <small>Network analytics</small>
        </div>
        <nav>
          {metricItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={metric === item.id ? "active" : ""}
                onClick={() => setMetric(item.id)}
              >
                <Icon size={18} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="mi-font-controls">
          <span>Content text</span>
          <div>
            <button
              onClick={() =>
                setFontScale((value) =>
                  Math.max(0.94, Number((value - 0.07).toFixed(2))),
                )
              }
              disabled={fontScale <= 0.94}
              aria-label="Decrease content text size"
            >
              <Minus size={15} />
            </button>
            <strong>{Math.round(fontScale * 100)}%</strong>
            <button
              onClick={() =>
                setFontScale((value) =>
                  Math.min(1.29, Number((value + 0.07).toFixed(2))),
                )
              }
              disabled={fontScale >= 1.29}
              aria-label="Increase content text size"
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        <div className="mi-source">
          <i className={error ? "offline" : ""} />
          <span>
            <strong>{error ? "Data degraded" : "Live network data"}</strong>
            <small>{error || "Updates from Rota backend"}</small>
          </span>
        </div>
      </aside>
      <div className="mi-content">
        <header className="mi-topbar">
          <div>
            <p>Market Intelligence</p>
            <h1>{metricItems.find((item) => item.id === metric)?.label}</h1>
          </div>
          <div className="mi-controls">
            <label>
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search market"
              />
            </label>
            <div className="mi-select-wrap">
              <select
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
              >
                {filteredMarkets.map((market) => (
                  <option value={market.symbol} key={market.symbol}>
                    {cleanSymbol(market.symbol)} PERP
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <button
              className="mi-refresh"
              onClick={() => setRefreshKey((value) => value + 1)}
              aria-label="Refresh data"
            >
              <RefreshCw
                size={16}
                className={loading.summary || loading.symbol ? "spinning" : ""}
              />
            </button>
          </div>
        </header>
        <div className="mi-market-strip">
          <div>
            <span>{cleanSymbol(symbol)} PERP</span>
            <strong>{current ? money(current.mark_price, false) : "—"}</strong>
            <em className={change >= 0 ? "gain" : "loss"}>{percent(change)}</em>
          </div>
          <div>
            <span>Open interest</span>
            <strong>
              {current
                ? money(
                    number(current.open_interest) * number(current.mark_price),
                  )
                : "—"}
            </strong>
          </div>
          <div>
            <span>Est. funding</span>
            <strong
              className={
                number(current?.est_funding_rate) >= 0 ? "gain" : "loss"
              }
            >
              {current ? percent(current.est_funding_rate) : "—"}
            </strong>
          </div>
          <div>
            <span>24H volume</span>
            <strong>{current ? money(current["24h_amount"]) : "—"}</strong>
          </div>
          <div>
            <span>Next funding</span>
            <strong>
              <Clock3 size={13} />
              {current?.next_funding_time
                ? new Date(current.next_funding_time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </strong>
          </div>
          <div className="mi-updated">
            <Activity size={14} />
            {summary?.ts
              ? `Updated ${new Date(summary.ts).toLocaleTimeString()}`
              : "Waiting for data"}
          </div>
        </div>
        {error && (
          <div className="mi-error">
            <AlertTriangle size={16} />
            <span>
              {error}. Available panels will continue to render cached or
              partial data.
            </span>
          </div>
        )}
        {loading.summary && !summary ? <Skeleton rows={10} /> : renderContent()}
      </div>
    </main>
  );
}
