import { getCopyTradeAPIURL } from "@/utils/copy-trade-api-url";

export interface GuardPolicy {
  enabled: boolean;
  max_loss_24h: number;
  max_notional: number;
  min_liquidation_distance_percent: number;
}

export interface GuardState {
  wallet: string;
  account_id: string;
  policy: GuardPolicy;
  snapshot: {
    pnl_24h: number;
    notional: number;
    open_positions: number;
    min_liquidation_distance_percent: number | null;
    liquidation_data_complete: boolean;
    updated_at: string;
  } | null;
  triggered_at: string | null;
  reason?: string;
  cleanup_pending: boolean;
  cleanup_error?: string;
  last_error?: string;
  updated_at: string;
  events: { type: string; detail?: string; at: string }[];
}

export class GuardAPIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "GuardAPIError";
  }
}

export async function guardRequest(
  wallet: string,
  accountId: string,
  token: string,
  path = "",
  method = "GET",
  policy?: GuardPolicy,
  signal?: AbortSignal,
): Promise<GuardState> {
  const query = new URLSearchParams({ wallet, account_id: accountId });
  const response = await fetch(
    `${getCopyTradeAPIURL()}/v1/guard${path}?${query}`,
    {
      method,
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: policy === undefined ? undefined : JSON.stringify(policy),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new GuardAPIError(
      result.error || "Rota Guard unavailable",
      response.status,
    );
  return result as GuardState;
}

export function validateGuardPolicy(policy: GuardPolicy): string {
  const limits = [
    policy.max_loss_24h,
    policy.max_notional,
    policy.min_liquidation_distance_percent,
  ];
  if (limits.some((value) => !Number.isFinite(value) || value < 0))
    return "Enter finite, non-negative limits.";
  if (policy.min_liquidation_distance_percent > 50)
    return "Liquidation distance must be between 0 and 50%.";
  if (policy.enabled && limits.every((value) => value === 0))
    return "Set at least one rule before enabling Guard.";
  return "";
}

export const guardReasonLabels: Record<string, string> = {
  loss_24h: "24-hour loss threshold reached",
  total_exposure: "Exposure threshold reached",
  liquidation_distance: "Position near liquidation",
  emergency_stop: "Emergency stop requested",
};
