import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { useAccount, useMarkPrice } from "@orderly.network/hooks";
import {
  BotKind,
  createBot,
  deleteBot,
  listBots,
  setBotStatus,
  TradingBot,
} from "@/services/bots";
import {
  confirmCredentialIntent,
  createCredentialIntent,
} from "@/services/copy-trade";
import "./bots.css";

const cleanSymbol = (value?: string) =>
  value && /^PERP_[A-Z0-9]+_[A-Z0-9]+$/.test(value) ? value : "";

type BotListView = "running" | "history";
type SpreadUnit = "BPS" | "PERCENT" | "USDC";

const isRunningBot = (bot: TradingBot) =>
  bot.status === "active" || bot.status === "paused";

const formatNumber = (value: number, maximumFractionDigits = 8) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const numericValue = (source: Record<string, unknown>, key: string) => {
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : 0;
};

const textValue = (source: Record<string, unknown>, key: string) =>
  typeof source[key] === "string" ? String(source[key]) : "";

const formatRemainingTime = (seconds: number) => {
  if (seconds <= 0) return "Extended";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.ceil((seconds % 3600) / 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const distanceToBPS = (value: number, unit: SpreadUnit, markPrice: number) => {
  if (unit === "PERCENT") return value * 100;
  if (unit === "USDC") return markPrice > 0 ? (value / markPrice) * 10000 : 0;
  return value;
};

const distanceFromBPS = (bps: number, unit: SpreadUnit, markPrice: number) => {
  if (unit === "PERCENT") return bps / 100;
  if (unit === "USDC") return (markPrice * bps) / 10000;
  return bps;
};

const inputNumber = (value: number) => Number(value.toFixed(6)).toString();

export function BotPanel({ symbol }: { symbol?: string }) {
  const { account } = useAccount();
  const location = useLocation();
  const wallet = account.address?.toLowerCase() ?? "";
  const routeSymbol = decodeURIComponent(location.pathname)
    .toUpperCase()
    .match(/PERP_[A-Z0-9]+_[A-Z0-9]+/)?.[0];
  const market = cleanSymbol(routeSymbol || symbol);
  const { data: rawMarkPrice } = useMarkPrice(market);
  const currentMarkPrice = Number(rawMarkPrice) || 0;
  const [kind, setKind] = useState<BotKind>("TWAP");
  const [bots, setBots] = useState<TradingBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [listView, setListView] = useState<BotListView>("running");
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);

  const [side, setSide] = useState("BUY");
  const [quantity, setQuantity] = useState("0.01");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [intervalSeconds, setIntervalSeconds] = useState("30");
  const [style, setStyle] = useState("TAKER");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [direction, setDirection] = useState("LONG");
  const [entrySpread, setEntrySpread] = useState("50");
  const [profitSpread, setProfitSpread] = useState("50");
  const [feeBuffer, setFeeBuffer] = useState("6");
  const [spreadUnit, setSpreadUnit] = useState<SpreadUnit>("BPS");
  const [maxInventory, setMaxInventory] = useState("0.05");
  const [maxNotional, setMaxNotional] = useState("5000");
  const [maxDailyLoss, setMaxDailyLoss] = useState("250");
  const [leverage, setLeverage] = useState("3");

  const [, baseAsset = "Base asset", quoteAsset = "USDC"] = market.split("_");
  const runningCount = bots.filter(isRunningBot).length;
  const historyCount = bots.length - runningCount;
  const visibleBots = bots.filter((bot) =>
    listView === "running" ? isRunningBot(bot) : !isRunningBot(bot),
  );

  const storageKey = useMemo(
    () => `rota-copytrade-session:${wallet}`,
    [wallet],
  );

  const spreadNote = useCallback(
    (value: string) => {
      const bps = distanceToBPS(Number(value), spreadUnit, currentMarkPrice);
      if (!Number.isFinite(bps)) return "Enter a valid distance.";
      const usdc = currentMarkPrice > 0 ? (currentMarkPrice * bps) / 10000 : 0;
      return `${formatNumber(bps, 2)} bps · ${formatNumber(bps / 100, 4)}% · ${
        currentMarkPrice > 0
          ? `${formatNumber(usdc, 4)} USDC`
          : "USDC unavailable"
      }`;
    },
    [currentMarkPrice, spreadUnit],
  );

  const changeSpreadUnit = (next: SpreadUnit) => {
    if (next === spreadUnit) return;
    if ((next === "USDC" || spreadUnit === "USDC") && currentMarkPrice <= 0) {
      setError("Current mark price is required for USDC distance conversion.");
      return;
    }
    const entryBPS = distanceToBPS(
      Number(entrySpread),
      spreadUnit,
      currentMarkPrice,
    );
    const profitBPS = distanceToBPS(
      Number(profitSpread),
      spreadUnit,
      currentMarkPrice,
    );
    setEntrySpread(
      inputNumber(distanceFromBPS(entryBPS, next, currentMarkPrice)),
    );
    setProfitSpread(
      inputNumber(distanceFromBPS(profitBPS, next, currentMarkPrice)),
    );
    setSpreadUnit(next);
    setError("");
  };

  const authorize = useCallback(async () => {
    if (
      !account.address ||
      !account.accountId ||
      !account.chainId ||
      !account.walletAdapter
    ) {
      throw new Error("Connect your ROTA trading wallet first.");
    }
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const intent = await createCredentialIntent({
      wallet: account.address,
      account_id: account.accountId,
      chain_id: Number(account.chainId),
    });
    const signed = (await account.walletAdapter.generateAddOrderlyKeyMessage({
      publicKey: intent.public_key,
      brokerId: intent.broker_id,
      expiration: 365,
      timestamp: intent.timestamp,
      scope: intent.scope,
    })) as unknown as { signatured: string };
    const confirmation = await confirmCredentialIntent(
      intent.id,
      signed.signatured,
    );
    localStorage.setItem(storageKey, confirmation.authorization_token);
    return confirmation.authorization_token;
  }, [account, storageKey]);

  const refresh = useCallback(
    async (silent = false) => {
      if (!wallet) {
        setBots([]);
        return;
      }
      const token = localStorage.getItem(storageKey);
      if (!token) {
        setBots([]);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const response = await listBots(wallet, token);
        setBots(response.data);
        setError("");
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Bots could not be loaded.",
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [storageKey, wallet],
  );

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (!market)
        throw new Error("The current Trade market could not be detected.");
      if (
        kind === "MARKET_MAKER" &&
        spreadUnit === "USDC" &&
        currentMarkPrice <= 0
      )
        throw new Error(
          "Current mark price is required for USDC distance mode.",
        );
      if (
        kind === "MARKET_MAKER" &&
        Number(maxInventory) < Number(quantity) * 2
      )
        throw new Error(
          "Max inventory must cover the base position and one additional grid entry (at least 2× order size).",
        );
      const token = await authorize();
      const base = { version: 1, leverage: Number(leverage) };
      const config =
        kind === "TWAP"
          ? {
              ...base,
              side,
              total_quantity: Number(quantity),
              duration_seconds: Number(durationMinutes) * 60,
              slice_interval_seconds: Number(intervalSeconds),
              style,
              max_slippage_bps: 30,
              max_notional: Number(maxNotional),
              reduce_only: reduceOnly,
            }
          : {
              ...base,
              direction,
              calculation_mode: "PERCENT",
              entry_spread_bps: Math.max(
                1,
                Math.round(
                  distanceToBPS(
                    Number(entrySpread),
                    spreadUnit,
                    currentMarkPrice,
                  ),
                ),
              ),
              profit_spread_bps: Math.max(
                1,
                Math.round(
                  distanceToBPS(
                    Number(profitSpread),
                    spreadUnit,
                    currentMarkPrice,
                  ),
                ),
              ),
              fee_buffer_bps: Number(feeBuffer),
              order_quantity: Number(quantity),
              max_inventory: Number(maxInventory),
              max_notional: Number(maxNotional),
              max_daily_loss: Number(maxDailyLoss),
              reprice_seconds: 30,
              max_active_orders: 6,
            };
      await createBot({ wallet, symbol: market, kind, config }, token);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Bot could not be started.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function act(
    item: TradingBot,
    action: "pause" | "resume" | "stop" | "delete",
  ) {
    const token = localStorage.getItem(storageKey);
    if (!token) {
      setError("Your trading session expired. Start a bot to reconnect.");
      return;
    }
    try {
      if (action === "delete") {
        if (
          !window.confirm(
            "Stop this bot, cancel its open bot orders and delete its history?",
          )
        )
          return;
        await deleteBot(item.id, token);
        setBots((current) => current.filter((bot) => bot.id !== item.id));
      } else {
        let closePosition = false;
        if (
          action === "stop" &&
          !window.confirm(
            "Stop this bot and cancel its open orders? Its execution history will be retained.",
          )
        )
          return;
        if (action === "stop" && item.kind === "MARKET_MAKER") {
          closePosition = window.confirm(
            "Close the bot's tracked position at market price as well?\n\nOK: cancel bot orders and close its position.\nCancel: cancel bot orders but leave the position open.",
          );
        }
        const updated = await setBotStatus(item.id, action, token, {
          closePosition,
        });
        setBots((current) =>
          current.map((bot) =>
            bot.id === item.id ? { ...bot, ...updated } : bot,
          ),
        );
        if (action === "stop") {
          setExpandedBotId(null);
          setListView("history");
        }
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bot action failed.");
    }
  }

  return (
    <section className="rota-bots">
      <header className="rota-bots__header">
        <div>
          <strong>Rota Bots</strong>
          <span>Execution runs on Rota infrastructure.</span>
        </div>
      </header>
      <div className="rota-bots__layout">
        <form className="rota-bots__form" onSubmit={submit}>
          <div className="rota-bots__switch">
            <button
              type="button"
              className={kind === "TWAP" ? "active" : ""}
              onClick={() => setKind("TWAP")}
            >
              TWAP
            </button>
            <button
              type="button"
              className={kind === "MARKET_MAKER" ? "active" : ""}
              onClick={() => setKind("MARKET_MAKER")}
            >
              Grid Market Maker
            </button>
          </div>
          <p className="rota-bots__hint">
            {kind === "TWAP"
              ? "Split one order into smaller time-based slices."
              : "Build independent maker grid lots with cost-adjusted reduce-only exits."}
          </p>
          <p className="rota-bots__current-market">
            This strategy will use the market currently open in Trade.
          </p>
          {kind === "TWAP" ? (
            <div className="rota-bots__grid">
              <Field label="Side">
                <select value={side} onChange={(e) => setSide(e.target.value)}>
                  <option>BUY</option>
                  <option>SELL</option>
                </select>
              </Field>
              <Field label="Execution">
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  <option value="TAKER">Taker</option>
                  <option value="MAKER">Maker</option>
                </select>
              </Field>
              <div className="rota-bots__flow-note">
                <strong>
                  {style === "TAKER" ? "Taker flow" : "Maker flow"}
                </strong>
                <span>
                  {style === "TAKER"
                    ? "Market slices prioritize execution. Thin liquidity or partial fills can extend the schedule and increase slippage."
                    : "Post-only limit slices are cancelled and repriced when unfilled, so completion can extend beyond the selected duration."}
                </span>
              </div>
              <Field label={`Total quantity (${baseAsset})`}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
              <Field label="Duration (minutes)">
                <input
                  type="number"
                  min="1"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </Field>
              <Field label="Slice interval (seconds)">
                <input
                  type="number"
                  min="5"
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(e.target.value)}
                />
              </Field>
              <Field label="Leverage" note="Locked while the bot is running.">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                />
              </Field>
              <Field label={`Max notional (${quoteAsset})`}>
                <input
                  type="number"
                  min="1"
                  value={maxNotional}
                  onChange={(e) => setMaxNotional(e.target.value)}
                />
              </Field>
              <label
                className="rota-bots__check"
                title="Only reduces an existing position; it cannot increase or reverse your exposure."
              >
                <input
                  type="checkbox"
                  checked={reduceOnly}
                  onChange={(e) => setReduceOnly(e.target.checked)}
                />{" "}
                Reduce only (close position)
              </label>
            </div>
          ) : (
            <div className="rota-bots__grid">
              <Field label="Direction">
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option>LONG</option>
                  <option>SHORT</option>
                </select>
              </Field>
              <Field label={`Order size per grid (${baseAsset})`}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
              <Field label="Distance unit">
                <select
                  value={spreadUnit}
                  onChange={(event) =>
                    changeSpreadUnit(event.target.value as SpreadUnit)
                  }
                >
                  <option value="BPS">BPS</option>
                  <option value="PERCENT">Percent (%)</option>
                  <option value="USDC">USDC</option>
                </select>
              </Field>
              <Field
                label={`Entry distance (${spreadUnit === "PERCENT" ? "%" : spreadUnit})`}
                note={spreadNote(entrySpread)}
              >
                <input
                  type="number"
                  min="0"
                  step={spreadUnit === "BPS" ? "1" : "0.01"}
                  value={entrySpread}
                  onChange={(e) => setEntrySpread(e.target.value)}
                />
              </Field>
              <Field
                label={`Target net profit (${spreadUnit === "PERCENT" ? "%" : spreadUnit})`}
                note={spreadNote(profitSpread)}
              >
                <input
                  type="number"
                  min="0"
                  step={spreadUnit === "BPS" ? "1" : "0.01"}
                  value={profitSpread}
                  onChange={(e) => setProfitSpread(e.target.value)}
                />
              </Field>
              <Field label="Fee & safety buffer (bps)">
                <input
                  type="number"
                  min="0"
                  max="500"
                  value={feeBuffer}
                  onChange={(e) => setFeeBuffer(e.target.value)}
                />
              </Field>
              <Field
                label={`Max inventory (${baseAsset})`}
                note="At least 2× order size: base position + one grid entry."
              >
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={maxInventory}
                  onChange={(e) => setMaxInventory(e.target.value)}
                />
              </Field>
              <Field label={`Max notional (${quoteAsset})`}>
                <input
                  type="number"
                  min="1"
                  value={maxNotional}
                  onChange={(e) => setMaxNotional(e.target.value)}
                />
              </Field>
              <Field label={`Daily loss limit (${quoteAsset})`}>
                <input
                  type="number"
                  min="1"
                  value={maxDailyLoss}
                  onChange={(e) => setMaxDailyLoss(e.target.value)}
                />
              </Field>
              <Field label="Leverage" note="Locked while the bot is running.">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                />
              </Field>
              <div className="rota-bots__flow-note rota-bots__flow-note--wide">
                <strong>Always-in-market grid flow</strong>
                <span>
                  Rota first opens one order-size base position at market, then
                  keeps a buy grid entry below and a reduce-only profit exit
                  above. If every bot lot exits, it rebuilds the base position
                  before placing the next grid. Profit is targeted, not
                  guaranteed; funding, fees and fast markets still carry risk.
                </span>
              </div>
            </div>
          )}
          <div className="rota-bots__warning">
            <AlertTriangle size={14} /> Bots continue while this browser is
            closed.
          </div>
          <button
            className="rota-bots__submit"
            disabled={submitting || !wallet || !market}
          >
            {submitting
              ? "Starting…"
              : wallet
                ? `Start ${kind === "TWAP" ? "TWAP" : "Grid Market Maker"}`
                : "Connect wallet"}
          </button>
        </form>
        <div className="rota-bots__list">
          <div className="rota-bots__list-title">
            <span>My bots</span>
            <button
              type="button"
              onClick={() => void refresh()}
              aria-label="Refresh bots"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="rota-bots__list-switch" role="tablist">
            <button
              type="button"
              className={listView === "running" ? "active" : ""}
              onClick={() => setListView("running")}
            >
              Running <span>{runningCount}</span>
            </button>
            <button
              type="button"
              className={listView === "history" ? "active" : ""}
              onClick={() => setListView("history")}
            >
              History <span>{historyCount}</span>
            </button>
          </div>
          {error && <div className="rota-bots__error">{error}</div>}
          {loading ? (
            <div className="rota-bots__empty">Loading bots…</div>
          ) : visibleBots.length === 0 ? (
            <div className="rota-bots__empty">
              {listView === "running" ? (
                <Bot size={22} />
              ) : (
                <Clock3 size={22} />
              )}
              {listView === "running"
                ? "No running bots."
                : "No bot history yet."}
            </div>
          ) : (
            visibleBots.map((item) => {
              const expanded = expandedBotId === item.id;
              return (
                <article
                  className={`rota-bots__item ${expanded ? "is-expanded" : ""}`}
                  key={item.id}
                >
                  <div className="rota-bots__item-summary">
                    <button
                      type="button"
                      className="rota-bots__expand"
                      onClick={() =>
                        setExpandedBotId(expanded ? null : item.id)
                      }
                      aria-expanded={expanded}
                      title="Show execution log"
                    >
                      {expanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </button>
                    <div className="rota-bots__item-main">
                      <div className="rota-bots__identity">
                        <strong>
                          {item.kind === "MARKET_MAKER"
                            ? "Grid Market Maker"
                            : "TWAP"}
                        </strong>
                        <span>{item.symbol.replace("PERP_", "")}</span>
                      </div>
                      <BotSettingsSummary
                        bot={item}
                        markPrice={currentMarkPrice}
                      />
                      {item.last_error && (
                        <div className="rota-bots__item-warning">
                          <AlertTriangle size={11} />
                          <span>{item.last_error}</span>
                        </div>
                      )}
                    </div>
                    <div
                      className={`rota-bots__status rota-bots__status--${item.status}`}
                    >
                      {item.status}
                    </div>
                    <div className="rota-bots__actions">
                      {item.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => void act(item, "pause")}
                          title="Pause"
                        >
                          <Pause size={14} />
                        </button>
                      ) : item.status === "paused" ? (
                        <button
                          type="button"
                          onClick={() => void act(item, "resume")}
                          title="Resume"
                        >
                          <Play size={14} />
                        </button>
                      ) : null}
                      {isRunningBot(item) ? (
                        <button
                          type="button"
                          onClick={() => void act(item, "stop")}
                          title="Stop and keep history"
                        >
                          <Square size={13} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void act(item, "delete")}
                          title="Delete history permanently"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && <BotExecutionLog bot={item} />}
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function BotSettingsSummary({
  bot,
  markPrice,
}: {
  bot: TradingBot;
  markPrice: number;
}) {
  const baseAsset = bot.symbol.split("_")[1] || "base";
  const leverage = numericValue(bot.config, "leverage");
  if (bot.kind === "TWAP") {
    const total = numericValue(bot.config, "total_quantity");
    const executed = Math.min(
      total,
      numericValue(bot.progress, "executed_quantity"),
    );
    const remaining = Math.max(0, total - executed);
    const duration = numericValue(bot.config, "duration_seconds");
    const startedAt = textValue(bot.progress, "started_at") || bot.created_at;
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
    );
    return (
      <div className="rota-bots__metrics">
        <span>
          Executed <b>{formatNumber(executed)}</b> / {formatNumber(total)}{" "}
          {baseAsset}
        </span>
        <span>
          Remaining <b>{formatNumber(remaining)}</b> {baseAsset}
        </span>
        <span>
          Time left <b>{formatRemainingTime(duration - elapsed)}</b>
        </span>
        <span>
          {textValue(bot.config, "style") || "TAKER"} ·{" "}
          {Math.ceil(duration / 60)}m · {leverage}x
        </span>
      </div>
    );
  }

  const entry = numericValue(bot.config, "entry_spread_bps");
  const profit = numericValue(bot.config, "profit_spread_bps");
  const buffer = numericValue(bot.config, "fee_buffer_bps");
  const orderSize = numericValue(bot.config, "order_quantity");
  const inventory = numericValue(bot.config, "max_inventory");
  const entryUSDC = markPrice > 0 ? (markPrice * entry) / 10000 : 0;
  const targetBPS = profit + buffer;
  const targetUSDC = markPrice > 0 ? (markPrice * targetBPS) / 10000 : 0;
  return (
    <div className="rota-bots__metrics">
      <span>
        Entry{" "}
        <b>
          {entry} bps · {formatNumber(entry / 100, 4)}%
        </b>
        {markPrice > 0 && <> · ≈{formatNumber(entryUSDC, 4)} USDC</>}
      </span>
      <span>
        Target{" "}
        <b>
          {targetBPS} bps · {formatNumber(targetBPS / 100, 4)}%
        </b>
        {markPrice > 0 && <> · ≈{formatNumber(targetUSDC, 4)} USDC</>}
      </span>
      <span>
        Order{" "}
        <b>
          {formatNumber(orderSize)} {baseAsset}
        </b>
      </span>
      <span>
        Inventory{" "}
        <b>
          {formatNumber(inventory)} {baseAsset}
        </b>{" "}
        · {leverage}x
      </span>
    </div>
  );
}

function BotExecutionLog({ bot }: { bot: TradingBot }) {
  const orders = bot.recent_orders ?? [];
  const baseAsset = bot.symbol.split("_")[1] || "base";
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);
  const pageOrders = orders.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <div className="rota-bots__log">
      <div className="rota-bots__log-started">
        <Clock3 size={12} /> Started {formatDateTime(bot.created_at)}
      </div>
      {orders.length === 0 ? (
        <div className="rota-bots__log-empty">
          No order attempts recorded yet. TWAP slices and grid orders will
          appear here after execution starts.
        </div>
      ) : (
        <div className="rota-bots__log-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Side</th>
                <th>Requested</th>
                <th>Filled</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageOrders.map((order) => (
                <tr key={order.id} title={order.error_message || undefined}>
                  <td>
                    {formatDateTime(order.updated_at || order.created_at)}
                  </td>
                  <td>
                    {order.purpose === "twap_slice"
                      ? "TWAP slice"
                      : order.purpose === "bootstrap"
                        ? "Base inventory"
                        : order.purpose === "entry"
                          ? "Grid entry"
                          : order.purpose === "stop_close"
                            ? "Stop close"
                            : "Profit exit"}
                  </td>
                  <td className={`is-${order.side.toLowerCase()}`}>
                    {order.side}
                  </td>
                  <td>
                    {formatNumber(order.quantity)} {baseAsset}
                  </td>
                  <td>{formatNumber(order.executed)}</td>
                  <td>
                    {order.price > 0 ? formatNumber(order.price) : "Market"}
                  </td>
                  <td>
                    <span className={`is-status-${order.status.toLowerCase()}`}>
                      {order.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="rota-bots__log-pages">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </button>
              <span>
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() =>
                  setPage((current) => Math.min(totalPages - 1, current + 1))
                }
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="rota-bots__field">
      <span>{label}</span>
      {children}
      {note && <small>{note}</small>}
    </label>
  );
}
