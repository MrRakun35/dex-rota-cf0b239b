import { useEffect, useState } from "react";
import type { TradingBot } from "@/services/bots";

export function formatBotRuntime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return `${days ? `${days}d ` : ""}${hours ? `${hours}h ` : ""}${minutes}m ${remaining}s`;
}

const number = (value: number) =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  }).format(value);
const date = (value: string) => new Date(value).toLocaleString();

export function BotStatistics({
  bot,
  expanded = false,
}: {
  bot: TradingBot;
  expanded?: boolean;
}) {
  const hasStatistics = Boolean(bot.statistics);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (
      expanded ||
      !hasStatistics ||
      bot.kind === "TWAP" ||
      bot.status !== "active"
    )
      return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [bot.kind, bot.status, hasStatistics, expanded]);
  if (bot.kind === "TWAP") return null;
  const stats = bot.statistics;
  const pnl = stats?.gross_realized_pnl;
  const runtime = stats
    ? stats.runtime_seconds +
      (bot.status === "active"
        ? Math.max(0, (now - Date.parse(stats.as_of)) / 1000)
        : 0)
    : null;
  if (!stats) {
    return expanded ? (
      <p className="rota-bots__statistics-note">
        Performance data is not available yet.
      </p>
    ) : (
      <span className="rota-bots__statistics-pending">Performance pending</span>
    );
  }
  if (expanded) {
    return (
      <div className="rota-bots__statistics-coverage">
        <div className="rota-bots__statistics-extra">
          <span>
            Closing orders <strong>{stats.closing_orders}</strong>
          </span>
          <span>
            Fully filled orders <strong>{stats.filled_orders}</strong>
          </span>
        </div>
        <p className="rota-bots__statistics-note">
          Gross realized P&amp;L excludes fees, funding and open-position
          P&amp;L. Executed orders include partial fills; paused time is
          excluded.
        </p>
        {stats &&
          (!stats.profit_history_complete ||
            !stats.runtime_history_complete) && (
            <p className="rota-bots__statistics-note">
              {!stats.profit_history_complete &&
                (bot.kind === "DCA"
                  ? "Includes stored DCA profit; historical market-close profit may be incomplete. "
                  : pnl == null
                    ? "Historical grid profit is unavailable. Profit tracking begins when this bot next runs. "
                    : `Grid profit tracked since ${date(stats.profit_since)}; earlier daily totals are unavailable. `)}
              {!stats.runtime_history_complete &&
                `Active runtime tracked since ${date(stats.runtime_since)}; earlier pause history is unavailable.`}
            </p>
          )}
      </div>
    );
  }
  return (
    <section className="rota-bots__statistics" aria-label="Bot performance">
      <div className="rota-bots__statistics-grid">
        <div>
          <span>
            Realized P&amp;L <small>· gross</small>
          </span>
          <strong
            className={
              pnl == null
                ? ""
                : pnl < 0
                  ? "is-loss"
                  : pnl > 0
                    ? "is-profit"
                    : ""
            }
          >
            {pnl == null ? "—" : `${pnl > 0 ? "+" : ""}${number(pnl)}`}
            <small>{pnl != null && " USDC"}</small>
          </strong>
        </div>
        <div>
          <span>Executed orders</span>
          <strong>{stats.executed_orders}</strong>
        </div>
        <div>
          <span>Active time</span>
          <strong>{runtime == null ? "—" : formatBotRuntime(runtime)}</strong>
        </div>
      </div>
    </section>
  );
}
