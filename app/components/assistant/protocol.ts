import { getRuntimeConfig } from "@/utils/runtime-config";

// Wire names and embed version remain compatible with the upstream service.
export const AUTH = {
  TRIGGER: "starchild_orderly_authorize_trigger",
  REQUEST: "starchild_orderly_authorize_request",
  PUBKEY: "starchild_orderly_authorize_pubkey",
  RESULT: "starchild_orderly_authorize_result",
  ERROR: "starchild_orderly_authorize_error",
} as const;

export function getAssistantUrl() {
  const url = new URL(
    getRuntimeConfig("VITE_ROTA_AI_URL") || "https://iamstarchild.com",
  );
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("ROTA AI requires a secure service URL.");
  }
  url.searchParams.set("source", "orderly-plugin");
  url.searchParams.set("pluginVersion", "1.4.0");
  url.searchParams.set("hideLogo", "1");
  return url;
}

export function isAssistantMessage(
  event: MessageEvent,
  origin: string,
  frame: Window | null | undefined,
): boolean {
  return (
    !!frame &&
    event.source === frame &&
    event.origin === origin &&
    !!event.data &&
    typeof event.data === "object"
  );
}

export function isPublicKeyMessage(data: Record<string, unknown>): data is {
  type: string;
  pubKey: string;
  nonce: string;
  actionId?: string;
} {
  return (
    data.type === AUTH.PUBKEY &&
    typeof data.pubKey === "string" &&
    data.pubKey.length <= 8192 &&
    data.pubKey.startsWith("-----BEGIN PUBLIC KEY-----") &&
    typeof data.nonce === "string" &&
    data.nonce.length > 0 &&
    data.nonce.length <= 512 &&
    (data.actionId === undefined || typeof data.actionId === "string")
  );
}
