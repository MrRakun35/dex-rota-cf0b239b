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
import {
  useAccount,
  useMarkPrice,
  useSymbolInfo,
} from "@orderly.network/hooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@orderly.network/ui";
import {
  BotKind,
  BotAPIError,
  withBotAuthorization,
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
import {
  DCAForm,
  defaultDCASettings,
  dcaConfig,
  dcaValidation,
  dcaMinimumMargins,
} from "./DCAForm";
import { useBotTradingSettings } from "./OrderEntryMode";
import { useDCAPreview } from "./useDCAPreview";
import "./bots.css";

const cleanSymbol = (value?: string) =>
  value && /^PERP_[A-Z0-9]+_[A-Z0-9]+$/.test(value) ? value : "";

type BotListView = "running" | "history";
type SpreadUnit = "BPS" | "PERCENT" | "USDC";
type PendingBotAction = {
  bot: TradingBot;
  action: "stop" | "delete";
} | null;

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

export function BotPanel({
  symbol,
  view = "list",
  previewEnabled = true,
}: {
  symbol?: string;
  view?: "setup" | "list";
  previewEnabled?: boolean;
}) {
  const { account } = useAccount();
  const location = useLocation();
  const wallet = account.address?.toLowerCase() ?? "";
  const routeSymbol = decodeURIComponent(location.pathname)
    .toUpperCase()
    .match(/PERP_[A-Z0-9]+_[A-Z0-9]+/)?.[0];
  const market = cleanSymbol(routeSymbol || symbol);
  const { data: rawMarkPrice } = useMarkPrice(market);
  const currentMarkPrice = Number(rawMarkPrice) || 0;
  const symbolInfo = useSymbolInfo(market);
  const marketRules = symbolInfo
    ? {
        min_notional: Number(symbolInfo("min_notional")),
        base_tick: Number(symbolInfo("base_tick")),
        base_min: Number(symbolInfo("base_min")),
      }
    : undefined;
  const trading = useBotTradingSettings(market);
  const [dcaInputs, setDcaSettings] = useState({ ...defaultDCASettings });
  const dcaSettings = useMemo(
    () => ({ ...dcaInputs, leverage: String(trading.leverage) }),
    [dcaInputs, trading.leverage],
  );
  const [kind, setKind] = useState<BotKind>("MARKET_MAKER");
  const [bots, setBots] = useState<TradingBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [needsAuthorization, setNeedsAuthorization] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [listView, setListView] = useState<BotListView>("running");
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingBotAction>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const [side, setSide] = useState("BUY");
  const [quantity, setQuantity] = useState("0.01");
  const [twapTotalNotional, setTwapTotalNotional] = useState("600");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [intervalSeconds, setIntervalSeconds] = useState("30");
  const [style, setStyle] = useState("TAKER");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [direction, setDirection] = useState("LONG");
  const [gridLevels, setGridLevels] = useState("3");
  const [entrySpread, setEntrySpread] = useState("50");
  const [profitSpread, setProfitSpread] = useState("50");
  const [feeBuffer, setFeeBuffer] = useState("6");
  const [spreadUnit, setSpreadUnit] = useState<SpreadUnit>("BPS");
  const [maxInventory, setMaxInventory] = useState("0.1");
  const [maxNotional, setMaxNotional] = useState("5000");
  const [maxDailyLoss, setMaxDailyLoss] = useState("250");

  const [, baseAsset = "Base asset", quoteAsset = "USDC"] = market.split("_");
  const dcaValidationError =
    kind === "DCA"
      ? dcaValidation(dcaSettings, currentMarkPrice, marketRules)
      : "";
  const minimumMargins = dcaMinimumMargins(
    dcaSettings,
    currentMarkPrice,
    marketRules,
  );
  const dcaPreview = useDCAPreview(
    market,
    dcaSettings,
    currentMarkPrice,
    kind === "DCA" && view === "setup" && previewEnabled,
    dcaValidationError,
  );
  const runningCount = bots.filter(isRunningBot).length;
  const historyCount = bots.length - runningCount;
  const visibleBots = bots.filter((bot) =>
    listView === "running" ? isRunningBot(bot) : !isRunningBot(bot),
  );
  const twapSliceCount = Math.ceil(
    (Number(durationMinutes) * 60) / Number(intervalSeconds),
  );
  const twapAmount = Number(twapTotalNotional);
  const twapSliceNotional = twapAmount / twapSliceCount;
  const twapEstimatedQuantity =
    currentMarkPrice > 0 ? twapAmount / currentMarkPrice : 0;
  const twapValidationError = useMemo(() => {
    if (kind !== "TWAP") return "";
    if (!Number.isFinite(twapAmount) || twapAmount <= 0)
      return "Enter a valid total amount.";
    if (currentMarkPrice <= 0)
      return "Current mark price is required to calculate the order quantity.";
    if (!Number.isFinite(twapSliceCount) || twapSliceCount <= 0)
      return "Enter a valid duration and slice interval.";
    if (twapSliceNotional < 10) {
      return `Each slice must be at least 10 ${quoteAsset}. Increase the total amount to at least ${formatNumber(
        twapSliceCount * 10,
        2,
      )} ${quoteAsset} or reduce the number of slices.`;
    }
    return "";
  }, [
    currentMarkPrice,
    kind,
    quoteAsset,
    twapAmount,
    twapSliceCount,
    twapSliceNotional,
  ]);
  const makerValidationError = useMemo(() => {
    if (kind !== "MARKET_MAKER") return "";
    const levels = Number(gridLevels);
    const orderSize = Number(quantity);
    const inventory = Number(maxInventory);
    const entryBPS = distanceToBPS(
      Number(entrySpread),
      spreadUnit,
      currentMarkPrice,
    );
    if (!Number.isInteger(levels) || levels < 1 || levels > 5)
      return "Grid levels must be a whole number between 1 and 5.";
    if (!Number.isFinite(orderSize) || orderSize <= 0)
      return "Enter a valid order size per grid level.";
    if (!Number.isFinite(entryBPS) || entryBPS <= 0)
      return "Enter a valid entry distance.";
    if (entryBPS * levels >= 10000)
      return "The outermost grid level must remain above zero price.";
    if (currentMarkPrice > 0 && orderSize * currentMarkPrice < 10)
      return `Each grid order must be at least 10 ${quoteAsset} at the current price.`;
    const requiredInventory = orderSize * (levels * 2 + 1);
    if (!Number.isFinite(inventory) || inventory < requiredInventory)
      return `Max inventory must be at least ${formatNumber(requiredInventory)} ${baseAsset} to manage filled lots while keeping ${levels} floating entry orders open.`;
    if (
      currentMarkPrice > 0 &&
      requiredInventory * currentMarkPrice > Number(maxNotional)
    )
      return `Max notional must be at least ${formatNumber(requiredInventory * currentMarkPrice, 2)} ${quoteAsset} for this grid.`;
    return "";
  }, [
    baseAsset,
    currentMarkPrice,
    entrySpread,
    gridLevels,
    kind,
    maxInventory,
    maxNotional,
    quantity,
    quoteAsset,
    spreadUnit,
  ]);

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

  const authorize = useCallback(
    async (force = false) => {
      if (
        !account.address ||
        !account.accountId ||
        !account.chainId ||
        !account.walletAdapter
      ) {
        throw new Error("Connect your ROTA trading wallet first.");
      }
      const existing = localStorage.getItem(storageKey);
      if (existing && !force) return existing;
      if (force) localStorage.removeItem(storageKey);
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
      setNeedsAuthorization(false);
      window.dispatchEvent(new Event("rota-bots-updated"));
      return confirmation.authorization_token;
    },
    [account, storageKey],
  );

  const refresh = useCallback(
    async (silent = false) => {
      if (!wallet) {
        setBots([]);
        setNeedsAuthorization(false);
        return;
      }
      const token = localStorage.getItem(storageKey);
      if (!token) {
        setBots([]);
        setNeedsAuthorization(true);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const response = await listBots(wallet, token);
        setBots(response.data);
        setNeedsAuthorization(false);
        setError("");
      } catch (cause) {
        if (cause instanceof BotAPIError && cause.status === 401) {
          if (localStorage.getItem(storageKey) !== token) return;
          localStorage.removeItem(storageKey);
          setNeedsAuthorization(true);
          setBots([]);
          setError("");
          return;
        }
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
    const update = () => void refresh(true);
    window.addEventListener("rota-bots-updated", update);
    if (view !== "list")
      return () => window.removeEventListener("rota-bots-updated", update);
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("rota-bots-updated", update);
    };
  }, [refresh, view]);

  async function reconnectBots() {
    setAuthorizing(true);
    setError("");
    try {
      await authorize(true);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Bot authorization failed.",
      );
    } finally {
      setAuthorizing(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (!market)
        throw new Error("The current Trade market could not be detected.");
      if (twapValidationError) throw new Error(twapValidationError);
      if (makerValidationError) throw new Error(makerValidationError);
      if (dcaValidationError) throw new Error(dcaValidationError);
      if (
        kind === "MARKET_MAKER" &&
        spreadUnit === "USDC" &&
        currentMarkPrice <= 0
      )
        throw new Error(
          "Current mark price is required for USDC distance mode.",
        );
      const base = {
        version: 1,
        leverage: trading.leverage,
        margin_mode: trading.marginMode,
      };
      const config =
        kind === "DCA"
          ? { ...dcaConfig(dcaSettings), margin_mode: trading.marginMode }
          : kind === "TWAP"
            ? {
                ...base,
                side,
                total_quantity: twapEstimatedQuantity,
                duration_seconds: Number(durationMinutes) * 60,
                slice_interval_seconds: Number(intervalSeconds),
                style,
                max_slippage_bps: 30,
                // Keep the requested quote amount as the source of truth while
                // allowing normal price movement between form submission and
                // later slices. The execution quantity is still fixed from the
                // current mark and every slice remains exchange-validated.
                max_notional: Math.max(twapAmount * 1.05, twapAmount + 10),
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
                grid_levels: Number(gridLevels),
                max_inventory: Number(maxInventory),
                max_notional: Number(maxNotional),
                max_daily_loss: Number(maxDailyLoss),
                reprice_seconds: 30,
                max_active_orders: Math.min(20, Number(gridLevels) * 2 + 2),
              };
      await withBotAuthorization(authorize, (token) =>
        createBot({ wallet, symbol: market, kind, config }, token),
      );
      window.dispatchEvent(new Event("rota-bots-updated"));
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
    closePosition = false,
  ) {
    try {
      if (action === "delete") {
        await withBotAuthorization(authorize, (token) =>
          deleteBot(item.id, token),
        );
        setBots((current) => current.filter((bot) => bot.id !== item.id));
      } else {
        const updated = await withBotAuthorization(authorize, (token) =>
          setBotStatus(item.id, action, token, {
            closePosition,
          }),
        );
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
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bot action failed.");
      return false;
    }
  }

  async function confirmPendingAction(closePosition = false) {
    if (!pendingAction || actionSubmitting) return;
    setActionSubmitting(true);
    try {
      const succeeded = await act(
        pendingAction.bot,
        pendingAction.action,
        closePosition,
      );
      if (succeeded) setPendingAction(null);
    } finally {
      setActionSubmitting(false);
    }
  }

  return (
    <section className={`rota-bots rota-bots--${view}`}>
      <div className="rota-bots__layout">
        {view === "setup" && (
          <form className="rota-bots__form" onSubmit={submit}>
            <div className="rota-bots__switch">
              {(
                [
                  { kind: "MARKET_MAKER", label: "Grid & Market Maker" },
                  { kind: "DCA", label: "DCA Bot" },
                  { kind: "TWAP", label: "TWAP" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.kind}
                  type="button"
                  className={kind === tab.kind ? "active" : ""}
                  onClick={() => setKind(tab.kind)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="rota-bots__hint">
              {kind === "TWAP"
                ? "Split one order into smaller time-based slices."
                : kind === "DCA"
                  ? "Average into one position and take profit on the entire round."
                  : "Build independent maker grid lots with cost-adjusted reduce-only exits."}
            </p>
            <p className="rota-bots__current-market">
              {baseAsset} ·{" "}
              {trading.marginMode === "ISOLATED" ? "Isolated" : "Cross"} ·{" "}
              {trading.leverage}×
            </p>
            {kind === "DCA" ? (
              <DCAForm
                settings={dcaSettings}
                minimumMargins={minimumMargins}
                onChange={setDcaSettings}
                quoteAsset={quoteAsset}
                onPreview={dcaPreview.preview}
                onClearPreview={dcaPreview.clear}
                previewVisible={dcaPreview.visible}
                previewError={dcaPreview.error}
              />
            ) : kind === "TWAP" ? (
              <div className="rota-bots__grid">
                <Field label="Side">
                  <select
                    value={side}
                    onChange={(e) => setSide(e.target.value)}
                  >
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
                <Field
                  label={`Total amount (${quoteAsset})`}
                  note={
                    currentMarkPrice > 0
                      ? `≈ ${formatNumber(twapEstimatedQuantity)} ${baseAsset} total · ${twapSliceCount} slices · ≈ ${formatNumber(twapSliceNotional, 2)} ${quoteAsset} each`
                      : "Waiting for the current mark price."
                  }
                >
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={twapTotalNotional}
                    onChange={(e) => setTwapTotalNotional(e.target.value)}
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
                <div
                  className="rota-bots__switch rota-bots__direction rota-bots__grid-direction"
                  aria-label="Grid direction"
                >
                  {["LONG", "SHORT"].map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={direction === value}
                      className={
                        direction === value
                          ? `active is-${value.toLowerCase()}`
                          : ""
                      }
                      onClick={() => setDirection(value)}
                    >
                      {value === "LONG" ? "Long" : "Short"}
                    </button>
                  ))}
                </div>
                <Field label={`Order size per grid (${baseAsset})`}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </Field>
                <Field
                  label="Grid levels"
                  note="Open entry orders at 1×, 2× … the selected distance (maximum 5)."
                >
                  <input
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    value={gridLevels}
                    onChange={(e) => setGridLevels(e.target.value)}
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
                  note={`At least ${Number(gridLevels) * 2 + 1}× order size: filled lots plus ${gridLevels || 0} continuously maintained entry levels.`}
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
                <div className="rota-bots__flow-note rota-bots__flow-note--wide">
                  <strong>Always-in-market grid flow</strong>
                  <span>
                    Rota first opens one order-size base position at market,
                    then places {gridLevels || 0} entry levels in the{" "}
                    {direction === "LONG"
                      ? "buy direction below"
                      : "sell direction above"}{" "}
                    the fill and a reduce-only profit exit on the opposite side.
                    Every entry fill gets its own reduce-only exit and the bot
                    adds a new outer entry so {gridLevels || 0} pending entry
                    levels remain. If every bot lot exits, all pending entries
                    are cancelled before the cycle restarts at market.
                  </span>
                </div>
              </div>
            )}
            {kind === "TWAP" && twapValidationError && (
              <div className="rota-bots__validation">
                <AlertTriangle size={14} /> {twapValidationError}
              </div>
            )}
            {kind === "MARKET_MAKER" && makerValidationError && (
              <div className="rota-bots__validation">
                <AlertTriangle size={14} /> {makerValidationError}
              </div>
            )}
            {dcaValidationError && (
              <div className="rota-bots__validation">
                <AlertTriangle size={14} /> {dcaValidationError}
              </div>
            )}
            <div className="rota-bots__warning">
              <AlertTriangle size={14} /> Bots continue while this browser is
              closed.
            </div>
            {error && (
              <div className="rota-bots__error" role="alert">
                {error}
              </div>
            )}
            <button
              className="rota-bots__submit"
              disabled={
                trading.isLoading ||
                submitting ||
                !wallet ||
                !market ||
                Boolean(
                  twapValidationError ||
                  makerValidationError ||
                  dcaValidationError,
                )
              }
            >
              {submitting
                ? "Starting…"
                : wallet
                  ? `Start ${kind === "TWAP" ? "TWAP" : kind === "DCA" ? "DCA" : "Grid & Market Maker"}`
                  : "Connect wallet"}
            </button>
          </form>
        )}
        {view === "list" && (
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
                Running <span>{needsAuthorization ? "—" : runningCount}</span>
              </button>
              <button
                type="button"
                className={listView === "history" ? "active" : ""}
                onClick={() => setListView("history")}
              >
                History <span>{needsAuthorization ? "—" : historyCount}</span>
              </button>
            </div>
            {error && <div className="rota-bots__error">{error}</div>}
            {needsAuthorization ? (
              <div className="rota-bots__empty">
                Authorize your wallet to view running bots and bot history.
                <button
                  type="button"
                  disabled={authorizing}
                  onClick={() => void reconnectBots()}
                >
                  {authorizing ? "Authorizing…" : "Authorize bots"}
                </button>
              </div>
            ) : !wallet ? (
              <div className="rota-bots__empty">
                Connect your trading wallet to view your bots.
              </div>
            ) : loading ? (
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
                              ? "Grid & Market Maker"
                              : item.kind === "DCA"
                                ? "DCA Bot"
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
                            onClick={() =>
                              setPendingAction({ bot: item, action: "stop" })
                            }
                            title="Stop and keep history"
                          >
                            <Square size={13} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingAction({ bot: item, action: "delete" })
                            }
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
        )}
      </div>
      <BotActionDialog
        pending={pendingAction}
        submitting={actionSubmitting}
        onCancel={() => {
          if (!actionSubmitting) setPendingAction(null);
        }}
        onConfirm={(closePosition) => void confirmPendingAction(closePosition)}
      />
    </section>
  );
}

function BotActionDialog({
  pending,
  submitting,
  onCancel,
  onConfirm,
}: {
  pending: PendingBotAction;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (closePosition: boolean) => void;
}) {
  const isDelete = pending?.action === "delete";
  const isMakerStop =
    pending?.action === "stop" &&
    (pending.bot.kind === "MARKET_MAKER" || pending.bot.kind === "DCA");

  return (
    <Dialog
      open={Boolean(pending)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="rota-bots__dialog oui-bg-base-8 oui-border oui-border-line-12">
        <DialogHeader>
          <DialogTitle>
            {isDelete ? "Delete bot history?" : "Stop this bot?"}
          </DialogTitle>
        </DialogHeader>
        <div className="rota-bots__dialog-body">
          <AlertTriangle size={18} />
          <p>
            {isDelete
              ? "The bot record and its execution history will be permanently deleted. Any tracked open bot orders are cancelled first."
              : "The bot will stop running and all of its tracked open orders will be cancelled. Its execution history will be retained."}
          </p>
        </div>
        {isMakerStop && (
          <p className="rota-bots__dialog-note">
            Choose whether the position accumulated by this bot should remain
            open or be closed immediately at market price.
          </p>
        )}
        <div className="rota-bots__dialog-actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          {isMakerStop && (
            <button
              type="button"
              onClick={() => onConfirm(false)}
              disabled={submitting}
            >
              Stop & keep position
            </button>
          )}
          <button
            type="button"
            className={isDelete ? "is-danger" : "is-primary"}
            onClick={() => onConfirm(isMakerStop)}
            disabled={submitting}
          >
            {submitting
              ? "Processing…"
              : isDelete
                ? "Delete permanently"
                : isMakerStop
                  ? "Stop & close position"
                  : "Stop bot"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
  if (bot.kind === "DCA") {
    const cycle = (bot.progress.dca || {}) as Record<string, unknown>;
    const lots = (bot.progress.lots || []) as Array<{
      Price: number;
      Quantity: number;
    }>;
    const quantity = lots.reduce((sum, lot) => sum + lot.Quantity, 0);
    const average =
      quantity > 0
        ? lots.reduce((sum, lot) => sum + lot.Price * lot.Quantity, 0) /
          quantity
        : 0;
    return (
      <div className="rota-bots__metrics">
        <span>
          <b>{textValue(bot.config, "direction")}</b> ·{" "}
          {numericValue(bot.config, "leverage")}×
        </span>
        <span>
          DCA orders <b>{numericValue(cycle, "dca_orders")}</b> /{" "}
          {numericValue(bot.config, "max_dca_orders")}
        </span>
        <span>
          Rounds <b>{numericValue(cycle, "completed_rounds")}</b>
        </span>
        <span>
          Average entry <b>{average > 0 ? formatNumber(average) : "Waiting"}</b>
        </span>
        <span>
          Position <b>{formatNumber(quantity)}</b> {baseAsset}
        </span>
        <span>
          Step <b>{numericValue(bot.config, "price_step_percent")}%</b> · Take
          profit <b>{numericValue(bot.config, "take_profit_percent")}%</b>
        </span>
      </div>
    );
  }
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
          {Math.ceil(duration / 60)}m
        </span>
      </div>
    );
  }

  const entry = numericValue(bot.config, "entry_spread_bps");
  const profit = numericValue(bot.config, "profit_spread_bps");
  const buffer = numericValue(bot.config, "fee_buffer_bps");
  const orderSize = numericValue(bot.config, "order_quantity");
  const inventory = numericValue(bot.config, "max_inventory");
  const levels = numericValue(bot.config, "grid_levels") || 1;
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
        Levels <b>{levels}</b>
      </span>
      <span>
        Inventory{" "}
        <b>
          {formatNumber(inventory)} {baseAsset}
        </b>
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
          No order attempts recorded yet. Bot orders will appear here after
          execution starts.
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
                    {order.purpose.startsWith("dca_")
                      ? (
                          {
                            dca_base: "DCA base",
                            dca_entry: "DCA order",
                            dca_take_profit: "Round take profit",
                            dca_stop_loss: "Stop loss",
                            dca_stop_condition: "Stop condition",
                          } as Record<string, string>
                        )[order.purpose] || order.purpose
                      : order.purpose === "twap_slice"
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
