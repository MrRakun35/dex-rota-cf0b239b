import { getRuntimeConfig } from "@/utils/runtime-config";

const apiURL = () => {
  // The production API only accepts the Rota domain. During local Vite
  // development, route through Vite's same-origin proxy so browser CORS does
  // not hide otherwise healthy market data.
  if (import.meta.env.DEV) return "/copy-api";
  return (
    getRuntimeConfig("VITE_COPYTRADE_API_URL") || "https://copy.algobotapp.com"
  ).replace(/\/$/, "");
};

export interface MarketSnapshot {
  symbol: string;
  mark_price: string;
  index_price: string;
  "24h_open": string;
  "24h_close": string;
  "24h_high": string;
  "24h_low": string;
  "24h_volume": string;
  "24h_amount": string;
  open_interest: string;
  last_funding_rate: string;
  est_funding_rate: string | null;
  next_funding_time: number;
  bid_price: string;
  ask_price: string;
  max_leverage: string;
}

export interface PlatformPosition {
  address: string;
  account_id: string;
  symbol: string;
  side: "LONG" | "SHORT" | string;
  position_qty: string;
  notional: string;
  average_open_price: string;
  mark_price: string;
  est_liq_price: string | null;
  unrealized_pnl: string | null;
  leverage: number | null;
  margin_mode: string | null;
  opened_at: number | null;
}

export interface FundingVenue {
  name: string;
  last: string;
  "1d": string;
  "7d": string;
  "30d": string;
}

export interface FundingComparisonRow {
  symbol: string;
  next_funding_time: number;
  exchanges: FundingVenue[];
}

export interface MarketDetail {
  symbol: string;
  market_info?: MarketSnapshot;
  orderbook?: {
    asks: Array<{ price: string; quantity: string }>;
    bids: Array<{ price: string; quantity: string }>;
  };
  recent_trades?: Array<Record<string, unknown>>;
  funding_history?: Array<Record<string, unknown>>;
  candles?: Array<Record<string, unknown> | unknown[]>;
}

export interface IntelligenceEnvelope<T> {
  success: boolean;
  data: T;
  ts: number;
  message?: string;
}

export async function intelligenceQuery<T>(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const response = await fetch(`${apiURL()}/v1/market-intelligence/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as
    | IntelligenceEnvelope<T>
    | { error?: string };
  if (!response.ok || !("success" in body) || !body.success) {
    throw new Error(
      ("error" in body && body.error) ||
        ("message" in body && body.message) ||
        `Request failed (${response.status})`,
    );
  }
  return body as IntelligenceEnvelope<T>;
}
