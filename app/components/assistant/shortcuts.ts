export const assistantOpenEvent = "rota-ai:open";
export interface AssistantOpenDetail {
  tab?: "chat" | "settings" | "tasks";
  prompt?: string;
}
export function openAssistant(detail: AssistantOpenDetail = {}) {
  window.dispatchEvent(new CustomEvent(assistantOpenEvent, { detail }));
}
export const assistantShortcuts = [
  {
    id: "markets",
    label: "Market & funding",
    title: "Markets & funding",
    tools: "market_query · reference_prices",
    description:
      "Live market summaries, order books, candles, trades and funding comparisons. Compare Orderly prices with spot reference markets.",
    prompt:
      "Compare BTC and ETH funding rates using market_query. Include source timestamps and explain the difference.",
  },
  {
    id: "technical",
    label: "Technical analysis",
    title: "Technical analysis",
    tools: "technical_analysis",
    description:
      "Research RSI, SMA, EMA, volatility and trends from spot candles. Spot research prices are different from perpetual execution prices.",
    prompt:
      "Use technical_analysis for PERP_ETH_USDC on the 4h interval. Explain the trend, RSI and moving averages.",
  },
  {
    id: "research",
    label: "Crypto & DeFi research",
    title: "Crypto & DeFi research",
    tools: "crypto_research · defi_research",
    description:
      "Explore CoinGecko trending assets and market data, plus chain TVL from DeFiLlama.",
    prompt:
      "Summarize trending assets with crypto_research and Ethereum TVL with defi_research.",
  },
  {
    id: "portfolio",
    label: "Portfolio & positions",
    title: "Portfolio & positions",
    tools: "positions · balances · portfolio_risk",
    description:
      "Review open positions, balances, total exposure, 24h PnL and liquidation distance. Connect read-only account access first.",
    prompt:
      "Use positions and portfolio_risk to review my portfolio. Show concentration risk and positions closest to liquidation.",
  },
  {
    id: "orders",
    label: "Orders & fills",
    title: "Orders & fills",
    tools: "open_orders · trade_history",
    description:
      "Inspect pending orders and recent fills. Recent trades are a snapshot, not your complete historical performance.",
    prompt:
      "Summarize my pending orders and recent fills using open_orders and trade_history.",
  },
  {
    id: "trade",
    label: "Draft an order",
    title: "Order proposals",
    tools: "plan_order · plan_cancel_order",
    description:
      "Prepare an order or cancellation for your review. Quantities are in base asset units. Confirm the action card to execute; simulation cards never place a live order.",
    prompt:
      "Draft a MARKET BUY for 0.01 ETH on PERP_ETH_USDC with reduce_only false. Show the price, USDC notional and slippage limit, then wait for my confirmation.",
  },
  {
    id: "guard",
    label: "ROTA Guard",
    title: "ROTA Guard",
    tools: "guard_state · plan_guard",
    description:
      "Review your risk policy and draft limits for daily losses, total exposure and minimum liquidation distance. Changes require confirmation.",
    prompt:
      "Show my guard_state. Propose an enabled Guard policy with a 50 USDC daily loss limit, 500 USDC maximum exposure and 10% minimum liquidation distance.",
  },
  {
    id: "bots",
    label: "Bots & Copy Trade",
    title: "Bots & Copy Trade",
    tools: "bot_performance · copy_overview · leader_research",
    description:
      "Review DCA, TWAP and market-maker bots, copy-trading settings and public leaders. Draft a pause or stop for an existing bot, or pause a subscription. Configure new bots in the Algo panel.",
    prompt:
      "Use bot_performance and copy_overview to summarize the status and risks of my bots and Copy Trade subscriptions.",
  },
  {
    id: "tasks",
    label: "Reports & alerts",
    title: "Reports & alerts",
    tools: "tasks_list · plan_task",
    description:
      "Schedule daily position reports, position-change monitoring, price alerts and funding alerts. Tasks run on ROTA, without automatic trades or background model token usage.",
    prompt:
      "Draft a daily position report at 09:00 in Europe/Istanbul with Telegram notifications enabled. Wait for my confirmation.",
  },
];
