import { getCopyTradeAPIURL } from "@/utils/copy-trade-api-url";

export interface AgentSettings {
  provider:
    | "starter"
    | "openrouter"
    | "openai"
    | "groq"
    | "gemini"
    | "anthropic";
  model: string;
  has_key: boolean;
  api_key?: string;
  share_account_data: boolean;
  max_order_notional: number;
  notes: string;
}
export interface AgentAccess {
  settings: AgentSettings;
  authenticated: boolean;
  read_authorized: boolean;
  trading_authorized: boolean;
}
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  at?: string;
}
export interface AgentTrace {
  name: string;
  data?: unknown;
  error?: string;
  private?: boolean;
}
export interface AgentProposal {
  id: string;
  kind: string;
  args: Record<string, unknown>;
  expires_at: string;
  dry_run: boolean;
  status: string;
}
export interface AgentReply {
  message: AgentMessage;
  model: string;
  traces: AgentTrace[];
  proposals: AgentProposal[];
  remaining: number;
}
export interface AgentCapabilities {
  starter_ready: boolean;
  starter_model: string;
  daily_messages: number;
  dry_run: boolean;
  tools: { function: { name: string; description: string } }[];
}
export interface AgentTaskInput {
  kind: "daily_report" | "position_watch" | "price_alert" | "funding_alert";
  symbol?: string;
  interval_seconds: number;
  hour: number;
  timezone: string;
  threshold: number;
  direction?: "above" | "below";
  notify: boolean;
}
export interface AgentTask extends AgentTaskInput {
  id: string;
  enabled: boolean;
  next_run: string;
  last_run?: string;
  last_error?: string;
}
export interface AgentSession {
  authorization_token: string;
  scope: string;
}
export interface AgentIntent {
  id: string;
  public_key: string;
  broker_id: string;
  scope: string;
  timestamp: number;
  expiration: number;
}
// Keys only travel in the settings request, never through chat or browser storage.
export async function agentRequest<T>(
  path: string,
  token?: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${getCopyTradeAPIURL()}/v1/agent${path}`, {
    method,
    signal,
    cache: "no-store",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      response.status === 401
        ? "Your AI session expired. Reconnect your account."
        : result.error || "ROTA AI is temporarily unavailable.",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
