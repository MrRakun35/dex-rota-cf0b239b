import { getRuntimeConfig } from "../utils/runtime-config";

const apiURL = () =>
  (
    getRuntimeConfig("VITE_COPYTRADE_API_URL") || "https://rota.algobotapp.com"
  ).replace(/\/$/, "");

export type BotKind = "TWAP" | "MARKET_MAKER" | "DCA";
export type BotStatus =
  | "active"
  | "paused"
  | "stopped"
  | "completed"
  | "failed";

export interface TradingBot {
  id: string;
  wallet: string;
  account_id: string;
  kind: BotKind;
  symbol: string;
  status: BotStatus;
  config: Record<string, unknown>;
  progress: Record<string, unknown>;
  last_error?: string;
  next_run_at: string;
  created_at: string;
  updated_at: string;
  recent_orders?: Array<{
    id: number;
    client_order_id: string;
    orderly_order_id?: string;
    purpose: string;
    side: string;
    order_type: string;
    price: number;
    quantity: number;
    executed: number;
    status: string;
    error_message?: string;
    created_at: string;
    updated_at: string;
  }>;
}

export class BotAPIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "BotAPIError";
  }
}

export async function withBotAuthorization<T>(
  authorize: (force?: boolean) => Promise<string>,
  operation: (token: string) => Promise<T>,
) {
  const token = await authorize();
  try {
    return await operation(token);
  } catch (error) {
    // A 401 is rejected before the bot operation runs. Never retry ambiguous
    // network errors or server failures that may have already created an order.
    if (!(error instanceof BotAPIError) || error.status !== 401) throw error;
    return operation(await authorize(true));
  }
}

async function request<T>(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${apiURL()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new BotAPIError(
      body.error || `Request failed (${response.status})`,
      response.status,
    );
  return body as T;
}

export function listBots(wallet: string, token: string) {
  return request<{ data: TradingBot[] }>(
    `/v1/bots?wallet=${encodeURIComponent(wallet)}`,
    token,
  );
}

export function createBot(
  input: {
    wallet: string;
    symbol: string;
    kind: BotKind;
    config: Record<string, unknown>;
  },
  token: string,
) {
  return request<TradingBot>("/v1/bots", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function setBotStatus(
  id: string,
  action: "pause" | "resume" | "stop",
  token: string,
  options?: { closePosition?: boolean },
) {
  return request<TradingBot>(`/v1/bots/${id}/${action}`, token, {
    method: "POST",
    body: JSON.stringify({ close_position: options?.closePosition ?? false }),
  });
}

export function deleteBot(id: string, token: string) {
  return request<void>(`/v1/bots/${id}`, token, { method: "DELETE" });
}
