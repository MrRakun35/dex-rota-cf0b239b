import { getCopyTradeAPIURL } from "@/utils/copy-trade-api-url";

export class NotificationAPIError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "NotificationAPIError";
  }
}

export async function withNotificationAuthorization<T>(
  authorize: (force?: boolean) => Promise<string>,
  operation: (token: string) => Promise<T>,
) {
  const token = await authorize();
  try {
    return await operation(token);
  } catch (error) {
    if (!(error instanceof NotificationAPIError) || error.status !== 401)
      throw error;
    return operation(await authorize(true));
  }
}

interface NotificationCredentialIntent {
  id: string;
  public_key: string;
  broker_id: string;
  scope: "read";
  timestamp: number;
  expiration: number;
}

export function createNotificationCredentialIntent(input: {
  wallet: string;
  account_id: string;
  chain_id: number;
}) {
  return notificationRequest<NotificationCredentialIntent>(
    input.wallet,
    "",
    "/credentials/intents",
    "POST",
    input,
  );
}

export function confirmNotificationCredentialIntent(
  wallet: string,
  id: string,
  signature: string,
) {
  return notificationRequest<{
    wallet: string;
    authorization_token: string;
    expires_in: number;
  }>(
    wallet,
    "",
    `/credentials/intents/${encodeURIComponent(id)}/confirm`,
    "POST",
    { signature },
  );
}

export const notificationEvents = [
  [
    "position_opened",
    "Position opened",
    "When a new long or short position opens.",
  ],
  [
    "position_increased",
    "Position increased",
    "When you add to an existing position.",
  ],
  [
    "position_reduced",
    "Position reduced",
    "When part of your position closes.",
  ],
  [
    "position_closed",
    "Position closed",
    "When your position closes completely.",
  ],
  [
    "take_profit",
    "Take profit (TP)",
    "When a take profit order fills, including partial fills.",
  ],
  ["stop_loss", "Stop loss (SL)", "When a stop loss or trailing stop fills."],
  ["liquidation", "Liquidation", "When the exchange liquidates a position."],
  [
    "order_filled",
    "Order filled",
    "When a regular order fills, including partial fills.",
  ],
  ["order_cancelled", "Order cancelled", "When a regular order is cancelled."],
  [
    "order_rejected",
    "Order rejected",
    "When the exchange rejects a regular order.",
  ],
] as const;

export interface NotificationSettings {
  verified: boolean;
  bot_username?: string;
  events: string[];
  verified_at?: string;
}

export async function notificationRequest<T>(
  wallet: string,
  token: string,
  path = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const base = getCopyTradeAPIURL();
  const response = await fetch(
    `${base}/v1/notifications${path}?wallet=${encodeURIComponent(wallet)}`,
    {
      method,
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new NotificationAPIError(
      result.error || "Unable to update notifications",
      response.status,
    );
  return result as T;
}
