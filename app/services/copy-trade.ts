import { getRuntimeConfig } from "@/utils/runtime-config";

const apiURL = () =>
  (
    getRuntimeConfig("VITE_COPYTRADE_API_URL") || "https://copy.algobotapp.com"
  ).replace(/\/$/, "");

export type BackendHealth = "online" | "offline";

export type LeaderWindow = "24h" | "7d" | "30d";

export interface CopyLeader {
  address: string;
  broker_id: string;
  total_notional: string;
  pnl_24h: string;
  pnl_7d: string;
  pnl_30d: string;
  volume_24h: string;
  volume_7d: string;
  volume_30d: string;
  trade_count_24h: number;
  win_rate_24h: number | null;
  win_rate_7d: number | null;
  win_rate_30d: number | null;
  avg_trade_size: string | null;
  position_count: number;
}

export interface LeaderResponse {
  data: {
    rows: CopyLeader[];
    next_cursor: string | null;
    last_updated_time: number;
  };
  window: LeaderWindow;
}

export interface LeaderDailyPnL {
  date: string;
  pnl: number;
  cumulative_pnl: number;
}

export interface LeaderTrade {
  id: string;
  order_id: string | null;
  symbol: string;
  side: string;
  executed_price: string;
  executed_quantity: string;
  realized_pnl: string | null;
  executed_timestamp: number;
}

export interface LeaderPosition {
  symbol: string;
  side: string;
  position_qty: string;
  notional: string;
  average_open_price: string;
  mark_price: string;
  unrealized_pnl: string;
  leverage: number;
  updated_at: number | null;
}

export interface LeaderPairActivity {
  symbol: string;
  trade_count: number;
  volume: number;
}

export interface LeaderPerformance {
  summary: CopyLeader;
  pnl_curve: LeaderDailyPnL[];
  recent_trades: LeaderTrade[];
  open_positions: LeaderPosition[];
  most_traded_pairs: LeaderPairActivity[];
  average_trade_size: number;
  win_rate: number | null;
  trade_count: number;
  updated_at: number;
}

export interface CopySettings {
  size_ratio: number;
  leverage: number;
  max_position_notional: number;
  max_daily_loss: number;
  max_concurrent_positions: number;
  max_slippage_bps: number;
}

export interface CredentialIntent {
  id: string;
  public_key: string;
  broker_id: string;
  scope: string;
  timestamp: number;
  expiration: number;
}

export interface CopyTradeAudit {
  id: number;
  subscription_id: string;
  leader_event_id: string;
  symbol: string;
  side: string;
  requested_quantity: number;
  reduce_only: boolean;
  status:
    | "submitted"
    | "filled"
    | "partial_fill"
    | "dry_run"
    | "retrying"
    | "failed"
    | "risk_rejected";
  error_message?: string;
  latency_ms: number;
  created_at: string;
}

export interface CopySubscription {
  id: string;
  follower_wallet: string;
  leader_wallet: string;
  status: "active" | "paused";
  settings: CopySettings;
  connection: {
    state: "connected" | "connecting" | "degraded" | "paused" | string;
    mode: "private_ws" | "public_polling" | string;
    detail?: string;
    updated_at: number;
  };
  recent_trades: CopyTradeAudit[];
  created_at: string;
  updated_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiURL()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body as T;
}

export async function getBackendHealth(
  signal?: AbortSignal,
): Promise<BackendHealth> {
  const response = await fetch(`${apiURL()}/healthz`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Backend health check failed (${response.status})`);
  }

  return "online";
}

export function getLeaders(window: LeaderWindow, signal?: AbortSignal) {
  return request<LeaderResponse>(`/v1/leaders?window=${window}`, { signal });
}

export function getLeaderPerformance(address: string, signal?: AbortSignal) {
  return request<{ data: LeaderPerformance }>(
    `/v1/leaders/${encodeURIComponent(address)}/performance`,
    { signal },
  );
}

export function createCredentialIntent(input: {
  wallet: string;
  account_id: string;
  chain_id: number;
}) {
  return request<CredentialIntent>("/v1/credentials/intents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmCredentialIntent(id: string, signature: string) {
  return request<{
    wallet: string;
    authorization_token: string;
    expires_in: number;
  }>(`/v1/credentials/intents/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify({ signature }),
  });
}

export function createSubscription(input: {
  follower_wallet: string;
  leader_wallet: string;
  settings: CopySettings;
  token: string;
}) {
  return request<CopySubscription>("/v1/subscriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({
      follower_wallet: input.follower_wallet,
      leader_wallet: input.leader_wallet,
      settings: input.settings,
      proof: { nonce: "", signature: "" },
    }),
  });
}

export function getSubscriptions(wallet: string, token: string) {
  return request<{ data: CopySubscription[] }>(
    `/v1/subscriptions?wallet=${encodeURIComponent(wallet)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

function subscriptionAction(
  id: string,
  action: "pause" | "resume",
  token: string,
) {
  return request<CopySubscription>(`/v1/subscriptions/${id}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nonce: "", signature: "" }),
  });
}

export function pauseSubscription(id: string, token: string) {
  return subscriptionAction(id, "pause", token);
}

export function resumeSubscription(id: string, token: string) {
  return subscriptionAction(id, "resume", token);
}

export function deleteSubscription(id: string, token: string) {
  return request<void>(`/v1/subscriptions/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nonce: "", signature: "" }),
  });
}
