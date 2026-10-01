import { getRuntimeConfig } from "./runtime-config";

export function getCopyTradeAPIURL(): string {
  if (import.meta.env.DEV) return "/copy-api";
  return (
    getRuntimeConfig("VITE_COPYTRADE_API_URL") || "https://rota.algobotapp.com"
  ).replace(/\/$/, "");
}
