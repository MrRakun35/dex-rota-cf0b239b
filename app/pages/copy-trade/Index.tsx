import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  LoaderCircle,
  Pause,
  Play,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trash2,
  UserRound,
  UserRoundCheck,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useAccount } from "@orderly.network/hooks";
import {
  CopyLeader,
  CopySettings,
  CopySubscription,
  LeaderPerformance,
  LeaderWindow,
  confirmCredentialIntent,
  createCredentialIntent,
  createSubscription,
  deleteSubscription,
  getLeaderPerformance,
  getLeaders,
  getBackendHealth,
  getSubscriptions,
  pauseSubscription,
  resumeSubscription,
} from "@/services/copy-trade";
import "./copy-trade.css";

const windows: Array<{ value: LeaderWindow; label: string }> = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

const defaults: CopySettings = {
  size_ratio: 0.1,
  leverage: 5,
  max_position_notional: 1_000,
  max_daily_loss: 100,
  max_concurrent_positions: 3,
  max_slippage_bps: 50,
};

const walletPattern = /^0x[0-9a-fA-F]{40}$/;

function number(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | number) {
  const amount = number(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(amount) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(amount) >= 10_000 ? 2 : 0,
  }).format(amount);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function symbolLabel(symbol: string) {
  return symbol
    .replace(/^PERP_/, "")
    .replace(/_USDC$/, "")
    .replace("_", "/");
}

function signedMoney(value: string | number | null) {
  const amount = number(value);
  return `${amount > 0 ? "+" : ""}${money(amount)}`;
}

function leaderPnL(leader: CopyLeader, window: LeaderWindow) {
  return number(leader[`pnl_${window}`]);
}

function leaderVolume(leader: CopyLeader, window: LeaderWindow) {
  return number(leader[`volume_${window}`]);
}

function leaderWinRate(leader: CopyLeader, window: LeaderWindow) {
  return leader[`win_rate_${window}`];
}

function Avatar({ address, rank }: { address: string; rank: number }) {
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  return (
    <div
      className="ct-avatar"
      style={{ "--avatar-hue": hue } as React.CSSProperties}
    >
      {rank <= 3 ? `#${rank}` : address.slice(2, 4).toUpperCase()}
    </div>
  );
}

function PerformanceChart({ data }: { data: LeaderPerformance["pnl_curve"] }) {
  const width = 560;
  const height = 170;
  const padding = 8;
  const values = data.map((point) => point.cumulative_pnl);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const points = data.map((point, index) => ({
    x: padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2),
    y:
      padding + ((max - point.cumulative_pnl) / range) * (height - padding * 2),
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = points.length
    ? `M ${points[0].x} ${height} L ${points
        .map((point) => `${point.x} ${point.y}`)
        .join(" L ")} L ${points[points.length - 1].x} ${height} Z`
    : "";

  if (!data.length) {
    return (
      <div className="ct-chart-empty">30-day PnL history is unavailable.</div>
    );
  }
  return (
    <div className="ct-chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="30-day cumulative PnL"
      >
        <defs>
          <linearGradient id="ct-pnl-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgb(41 233 169)" stopOpacity=".3" />
            <stop offset="1" stopColor="rgb(41 233 169)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ct-pnl-area)" />
        <polyline
          points={line}
          fill="none"
          stroke="rgb(41 233 169)"
          strokeWidth="2.5"
        />
      </svg>
      <div className="ct-chart-axis">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export default function CopyTradePage() {
  const { account } = useAccount();
  const followerWallet = account.address?.toLowerCase() ?? "";
  const [window, setWindow] = useState<LeaderWindow>("7d");
  const [leaders, setLeaders] = useState<CopyLeader[]>([]);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [query, setQuery] = useState("");
  const [searchedLeader, setSearchedLeader] = useState<CopyLeader | null>(null);
  const [walletSearchLoading, setWalletSearchLoading] = useState(false);
  const [walletSearchError, setWalletSearchError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const [selected, setSelected] = useState<CopyLeader | null>(null);
  const [modalView, setModalView] = useState<"performance" | "settings">(
    "performance",
  );
  const [performance, setPerformance] = useState<LeaderPerformance | null>(
    null,
  );
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState("");
  const [settings, setSettings] = useState<CopySettings>(defaults);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [modalError, setModalError] = useState("");
  const [subscriptions, setSubscriptions] = useState<CopySubscription[]>([]);
  const [copiesLoading, setCopiesLoading] = useState(false);
  const [copiesError, setCopiesError] = useState("");
  const [copySessionMissing, setCopySessionMissing] = useState(false);
  const [copyAction, setCopyAction] = useState("");
  const [copiesOpen, setCopiesOpen] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState("");
  const performanceCache = useRef(new Map<string, LeaderPerformance>());
  const copyFeedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const selectedAddress = selected?.address;

  const copyWallet = useCallback(async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedWallet(address.toLowerCase());
    if (copyFeedbackTimeout.current) {
      globalThis.clearTimeout(copyFeedbackTimeout.current);
    }
    copyFeedbackTimeout.current = globalThis.setTimeout(
      () => setCopiedWallet(""),
      1_500,
    );
  }, []);

  useEffect(
    () => () => {
      if (copyFeedbackTimeout.current) {
        globalThis.clearTimeout(copyFeedbackTimeout.current);
      }
    },
    [],
  );

  const loadCopies = useCallback(
    async (silent = false) => {
      if (!followerWallet) {
        setSubscriptions([]);
        setCopiesError("");
        setCopySessionMissing(false);
        return;
      }
      const token = localStorage.getItem(
        `rota-copytrade-session:${followerWallet}`,
      );
      if (!token) {
        setSubscriptions([]);
        setCopySessionMissing(true);
        return;
      }
      setCopySessionMissing(false);
      if (!silent) setCopiesLoading(true);
      setCopiesError("");
      try {
        const response = await getSubscriptions(followerWallet, token);
        setSubscriptions(response.data);
      } catch (cause) {
        setCopiesError(
          cause instanceof Error
            ? cause.message
            : "Your copies could not be loaded.",
        );
      } finally {
        if (!silent) setCopiesLoading(false);
      }
    },
    [followerWallet],
  );

  useEffect(() => {
    void loadCopies();
    const interval = globalThis.setInterval(
      () => void loadCopies(true),
      15_000,
    );
    return () => globalThis.clearInterval(interval);
  }, [loadCopies]);

  const loadLeaders = useCallback(
    async (signal?: AbortSignal, silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const response = await getLeaders(window, signal);
        const unique = new Map<string, CopyLeader>();
        for (const leader of response.data.rows) {
          if (
            !walletPattern.test(leader.address) ||
            number(leader[`pnl_${window}`]) <= 0
          ) {
            continue;
          }
          const key = leader.address.toLowerCase();
          const current = unique.get(key);
          if (
            !current ||
            leaderPnL(leader, window) > leaderPnL(current, window)
          ) {
            unique.set(key, leader);
          }
        }
        setLeaders([...unique.values()]);
        setLastUpdated(response.data.last_updated_time);
      } catch (cause) {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setError(
          cause instanceof Error ? cause.message : "Leader scan failed.",
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [window],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadLeaders(controller.signal);
    return () => controller.abort();
  }, [loadLeaders]);

  // An empty successful response means the backend is still warming its
  // leader cache. Keep checking quietly instead of leaving a static empty UI.
  useEffect(() => {
    if (loading || leaders.length > 0 || error) return;
    const controller = new AbortController();
    const interval = globalThis.setInterval(
      () => void loadLeaders(controller.signal, true),
      5_000,
    );
    return () => {
      controller.abort();
      globalThis.clearInterval(interval);
    };
  }, [error, leaders.length, loadLeaders, loading]);

  useEffect(() => {
    const controller = new AbortController();
    const checkHealth = async () => {
      try {
        await getBackendHealth(controller.signal);
        setBackendStatus("online");
      } catch (cause) {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setBackendStatus("offline");
      }
    };
    void checkHealth();
    const interval = globalThis.setInterval(() => void checkHealth(), 15_000);
    return () => {
      controller.abort();
      globalThis.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedAddress) return;
    const cacheKey = selectedAddress.toLowerCase();
    const cached = performanceCache.current.get(cacheKey);
    if (cached) {
      setPerformance(cached);
      setPerformanceError("");
      setPerformanceLoading(false);
      return;
    }
    const controller = new AbortController();
    setPerformance(null);
    setPerformanceError("");
    setPerformanceLoading(true);
    getLeaderPerformance(selectedAddress, controller.signal)
      .then((response) => {
        performanceCache.current.set(cacheKey, response.data);
        setPerformance(response.data);
      })
      .catch((cause: Error) => {
        if (cause.name !== "AbortError") {
          setPerformanceError(
            "Detailed performance is temporarily unavailable",
          );
        }
      })
      .finally(() => setPerformanceLoading(false));
    return () => controller.abort();
  }, [selectedAddress]);

  useEffect(() => {
    const wallet = query.trim().toLowerCase();
    setWalletSearchError("");
    setSearchedLeader(null);
    setWalletSearchLoading(false);
    if (!walletPattern.test(wallet)) return;
    const existing = leaders.find(
      (leader) => leader.address.toLowerCase() === wallet,
    );
    if (existing) return;

    const controller = new AbortController();
    setWalletSearchLoading(true);
    getLeaderPerformance(wallet, controller.signal)
      .then((response) => {
        performanceCache.current.set(wallet, response.data);
        setSearchedLeader(response.data.summary);
      })
      .catch((cause: Error) => {
        if (cause.name !== "AbortError") {
          setWalletSearchError("Wallet activity could not be loaded.");
        }
      })
      .finally(() => setWalletSearchLoading(false));
    return () => controller.abort();
  }, [leaders, query]);

  const visibleLeaders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return leaders;
    const matches = leaders.filter((leader) =>
      leader.address.toLowerCase().includes(normalized),
    );
    if (
      searchedLeader &&
      searchedLeader.address.toLowerCase() === normalized &&
      !matches.some(
        (leader) =>
          leader.address.toLowerCase() === searchedLeader.address.toLowerCase(),
      )
    ) {
      return [searchedLeader, ...matches];
    }
    return matches;
  }, [leaders, query, searchedLeader]);

  const totalPnL = leaders.reduce(
    (sum, leader) => sum + leaderPnL(leader, window),
    0,
  );
  const totalVolume = leaders.reduce(
    (sum, leader) => sum + leaderVolume(leader, window),
    0,
  );

  const setSetting = (key: keyof CopySettings, value: number) =>
    setSettings((current) => ({ ...current, [key]: value }));

  function openLeader(leader: CopyLeader) {
    setSelected(leader);
    setModalView("performance");
    setModalError("");
  }

  async function authorizeWallet() {
    const wallet = account.address;
    const accountID = account.accountId;
    const chainID = Number(account.chainId);
    if (!wallet || !accountID || !chainID || !account.walletAdapter) {
      throw new Error(
        "Connect your ROTA trading wallet from the top right first.",
      );
    }
    const storageKey = `rota-copytrade-session:${wallet.toLowerCase()}`;
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;

    const intent = await createCredentialIntent({
      wallet,
      account_id: accountID,
      chain_id: chainID,
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
  }

  async function submitCopy(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setModalError("");
    try {
      const token = await authorizeWallet();
      const result = await createSubscription({
        follower_wallet: account.address!,
        leader_wallet: selected.address,
        settings,
        token,
      });
      setSuccess(
        `Copying active · ${shortAddress(selected.address)} · ${result.status}`,
      );
      setSelected(null);
      await loadCopies();
    } catch (cause) {
      setModalError(
        cause instanceof Error
          ? cause.message
          : "Copy trading could not be started.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function changeCopy(
    subscription: CopySubscription,
    action: "pause" | "resume" | "delete",
  ) {
    const token = localStorage.getItem(
      `rota-copytrade-session:${followerWallet}`,
    );
    if (!token) {
      setCopiesError(
        "Your copy-trading session has expired. Reconnect your trading wallet.",
      );
      return;
    }
    if (
      action === "delete" &&
      !globalThis.confirm(
        `Stop copying ${shortAddress(subscription.leader_wallet)} and delete its copy history?`,
      )
    ) {
      return;
    }
    setCopyAction(`${subscription.id}:${action}`);
    setCopiesError("");
    try {
      if (action === "pause") {
        await pauseSubscription(subscription.id, token);
      } else if (action === "resume") {
        await resumeSubscription(subscription.id, token);
      } else {
        await deleteSubscription(subscription.id, token);
      }
      setSuccess(
        action === "delete"
          ? `Copy stopped · ${shortAddress(subscription.leader_wallet)}`
          : `Copy ${action === "pause" ? "paused" : "resumed"} · ${shortAddress(subscription.leader_wallet)}`,
      );
      await loadCopies();
    } catch (cause) {
      setCopiesError(
        cause instanceof Error
          ? cause.message
          : "The copy could not be updated.",
      );
    } finally {
      setCopyAction("");
    }
  }

  return (
    <main className="ct-page">
      <section className="ct-hero">
        <div className="ct-hero-copy">
          <div className="ct-eyebrow">
            <Sparkles size={14} /> ROTA COPY ENGINE
          </div>
          <h1>
            Discover proven traders.
            <br />
            <span>Copy on your terms.</span>
          </h1>
          <p>
            Explore high-performing wallets across ROTA. Only new trades made
            after you subscribe are mirrored within the limits you set.
          </p>
          <div className="ct-trust-row">
            <span>
              <ShieldCheck size={16} /> Non-custodial access
            </span>
            <span>
              <Activity size={16} /> Automated execution
            </span>
            <span>
              <Copy size={16} /> Pause anytime
            </span>
          </div>
        </div>
        <div className="ct-network-visual" aria-hidden="true">
          <svg className="ct-network-lines" viewBox="0 0 360 250">
            <defs>
              <linearGradient
                id="ct-link-gradient"
                gradientUnits="userSpaceOnUse"
                x1="126"
                y1="125"
                x2="278"
                y2="125"
              >
                <stop
                  offset="0"
                  stopColor="rgb(139 169 255)"
                  stopOpacity=".65"
                />
                <stop offset="1" stopColor="rgb(41 233 169)" stopOpacity=".3" />
              </linearGradient>
            </defs>
            <path d="M126 125 C 185 125, 196 48, 260 48" />
            <path d="M126 125 C 190 125, 208 125, 277 125" />
            <path d="M126 125 C 185 125, 196 202, 260 202" />
          </svg>
          <div className="ct-leader-node">
            <UserRoundCheck size={30} />
            <span>LEADER</span>
          </div>
          {[
            ["ct-follower-one", "F1"],
            ["ct-follower-two", "F2"],
            ["ct-follower-three", "F3"],
          ].map(([className, label]) => (
            <div className={`ct-follower-node ${className}`} key={label}>
              <UserRound size={17} />
              <span>{label}</span>
            </div>
          ))}
          <div className="ct-network-caption">
            <i /> LIVE MIRRORING
          </div>
        </div>
      </section>

      {success && (
        <div className="ct-success">
          <Check size={18} /> {success}
        </div>
      )}

      <section className="ct-stats">
        <div>
          <span>Leaders tracked</span>
          <strong>{leaders.length}</strong>
        </div>
        <div>
          <span>Combined positive PnL</span>
          <strong className="ct-profit">{money(totalPnL)}</strong>
        </div>
        <div>
          <span>Trading volume</span>
          <strong>{money(totalVolume)}</strong>
        </div>
        <div>
          <span>Data source</span>
          <strong
            className={`ct-live ct-live-${backendStatus}`}
            title={
              backendStatus === "online"
                ? "Copy Trade backend is reachable"
                : backendStatus === "offline"
                  ? "Copy Trade backend is unreachable"
                  : "Checking Copy Trade backend"
            }
          >
            <i />
            {backendStatus === "online"
              ? "ROTA Live"
              : backendStatus === "offline"
                ? "ROTA Offline"
                : "Checking…"}
          </strong>
        </div>
      </section>

      <section className={`ct-my-copies ${copiesOpen ? "open" : ""}`}>
        <button
          type="button"
          className="ct-my-copies-toggle"
          onClick={() => setCopiesOpen((current) => !current)}
          aria-expanded={copiesOpen}
        >
          <span className="ct-my-copies-title">
            <Radio size={19} />
            <strong>My Copies</strong>
          </span>
          <span className="ct-my-copies-meta">
            <small>
              {!followerWallet
                ? "Connect wallet to manage copies"
                : copiesLoading
                  ? "Loading…"
                  : `${subscriptions.length} trader${subscriptions.length === 1 ? "" : "s"} followed`}
            </small>
            <ChevronDown className="ct-my-copies-chevron" size={18} />
          </span>
        </button>

        {copiesOpen && (
          <div className="ct-my-copies-body">
            <div className="ct-copies-tools">
              <p>Monitor and control the wallets you currently follow.</p>
              {followerWallet && (
                <button type="button" onClick={() => void loadCopies()}>
                  Refresh
                </button>
              )}
            </div>

            {!followerWallet ? (
              <div className="ct-copies-empty">
                Connect your ROTA trading wallet to view your copied traders.
              </div>
            ) : copySessionMissing ? (
              <div className="ct-copies-empty">
                Your copy session is not available in this browser. Starting a
                new copy will request wallet authorization and restore access.
              </div>
            ) : copiesLoading ? (
              <div className="ct-copies-empty">
                <LoaderCircle className="ct-spin" size={18} /> Loading your
                copies…
              </div>
            ) : copiesError ? (
              <div className="ct-copies-empty ct-state-error">
                <AlertTriangle size={17} /> {copiesError}
              </div>
            ) : subscriptions.length === 0 ? (
              <div className="ct-copies-empty">
                You are not copying a trader yet. Choose a leader below to
                begin.
              </div>
            ) : (
              <div className="ct-copy-list">
                {subscriptions.map((subscription) => {
                  const connected =
                    subscription.connection.state === "connected";
                  const paused = subscription.status === "paused";
                  return (
                    <article className="ct-copy-item" key={subscription.id}>
                      <div className="ct-copy-summary">
                        <Avatar
                          address={subscription.leader_wallet}
                          rank={99}
                        />
                        <div className="ct-copy-identity">
                          <span>LEADER WALLET</span>
                          <div className="ct-wallet-line">
                            <strong>
                              {shortAddress(subscription.leader_wallet)}
                            </strong>
                            <button
                              type="button"
                              className={`ct-wallet-copy ${copiedWallet === subscription.leader_wallet.toLowerCase() ? "copied" : ""}`}
                              onClick={() =>
                                void copyWallet(subscription.leader_wallet)
                              }
                              aria-label="Copy full wallet address"
                              title="Copy full wallet address"
                            >
                              {copiedWallet ===
                              subscription.leader_wallet.toLowerCase() ? (
                                <Check size={12} />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                          <small>
                            Copy ratio{" "}
                            {Math.round(subscription.settings.size_ratio * 100)}
                            % · Max {subscription.settings.leverage}x
                          </small>
                        </div>
                        <div
                          className={`ct-connection ct-connection-${paused ? "paused" : subscription.connection.state}`}
                          title={subscription.connection.detail || undefined}
                        >
                          {connected && !paused ? (
                            <Wifi size={14} />
                          ) : (
                            <WifiOff size={14} />
                          )}
                          <span>
                            {paused
                              ? "Paused"
                              : connected
                                ? subscription.connection.mode === "private_ws"
                                  ? "Live WebSocket"
                                  : "Live polling"
                                : subscription.connection.state || "Connecting"}
                          </span>
                        </div>
                        <div className="ct-copy-controls">
                          <button
                            type="button"
                            disabled={Boolean(copyAction)}
                            onClick={() =>
                              void changeCopy(
                                subscription,
                                paused ? "resume" : "pause",
                              )
                            }
                          >
                            {copyAction ===
                            `${subscription.id}:${paused ? "resume" : "pause"}` ? (
                              <LoaderCircle className="ct-spin" size={14} />
                            ) : paused ? (
                              <Play size={14} />
                            ) : (
                              <Pause size={14} />
                            )}
                            {paused ? "Resume" : "Pause"}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            disabled={Boolean(copyAction)}
                            onClick={() =>
                              void changeCopy(subscription, "delete")
                            }
                          >
                            {copyAction === `${subscription.id}:delete` ? (
                              <LoaderCircle className="ct-spin" size={14} />
                            ) : (
                              <Trash2 size={14} />
                            )}
                            Stop
                          </button>
                        </div>
                      </div>

                      <div className="ct-copy-activity">
                        <div className="ct-copy-activity-title">
                          <span>Recent copied trades</span>
                          <small>
                            Last {subscription.recent_trades.length} events
                          </small>
                        </div>
                        {subscription.recent_trades.length === 0 ? (
                          <p>
                            No new leader trades have been processed since you
                            started copying.
                          </p>
                        ) : (
                          <div className="ct-copy-trades">
                            {subscription.recent_trades
                              .slice(0, 6)
                              .map((trade) => (
                                <div key={trade.id}>
                                  <span
                                    className={
                                      trade.side.toLowerCase() === "buy"
                                        ? "long"
                                        : "short"
                                    }
                                  >
                                    {trade.side}
                                  </span>
                                  <strong>{symbolLabel(trade.symbol)}</strong>
                                  <small>
                                    {number(
                                      trade.requested_quantity,
                                    ).toLocaleString()}
                                  </small>
                                  <time>
                                    {new Date(trade.created_at).toLocaleString(
                                      "en-US",
                                      {
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )}
                                  </time>
                                  <b
                                    className={`ct-audit-status ct-audit-${trade.status}`}
                                  >
                                    {trade.status.replace("_", " ")}
                                  </b>
                                  {trade.error_message && (
                                    <em>{trade.error_message}</em>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="ct-board">
        <div className="ct-toolbar">
          <div>
            <div className="ct-section-title">
              <Users size={20} /> Leaderboard
            </div>
            <p>ROTA wallets ranked by realized PnL</p>
          </div>
          <div className="ct-actions">
            <div className="ct-periods">
              {windows.map((item) => (
                <button
                  className={window === item.value ? "active" : ""}
                  key={item.value}
                  onClick={() => setWindow(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="ct-search">
              {walletSearchLoading ? (
                <LoaderCircle className="ct-spin" size={16} />
              ) : (
                <Search size={16} />
              )}
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Wallet"
              />
            </label>
          </div>
        </div>

        {loading ? (
          <div className="ct-state">
            <LoaderCircle className="ct-spin" /> Loading leaders…
          </div>
        ) : error ? (
          <div className="ct-state ct-state-error">
            <AlertTriangle /> {error}
          </div>
        ) : walletSearchLoading ? (
          <div className="ct-state">
            <LoaderCircle className="ct-spin" /> Looking up wallet activity…
          </div>
        ) : walletSearchError ? (
          <div className="ct-state ct-state-error">
            <AlertTriangle /> {walletSearchError}
          </div>
        ) : visibleLeaders.length === 0 ? (
          query.trim() ? (
            <div className="ct-state">
              Enter a complete wallet address to look up a trader.
            </div>
          ) : (
            <div className="ct-state ct-state-scanning" role="status">
              <span className="ct-scan-loader" aria-hidden="true">
                <LoaderCircle className="ct-spin" size={24} />
                <span />
                <span />
              </span>
              <span>
                <strong>Scanning the ROTA network</strong>
                <small>
                  Discovering active wallets and preparing leader metrics. The
                  list will appear automatically.
                </small>
              </span>
            </div>
          )
        ) : (
          <>
            <div className="ct-featured">
              {visibleLeaders.slice(0, 3).map((leader, index) => (
                <article className="ct-card" key={leader.address}>
                  <div className="ct-card-top">
                    <Avatar address={leader.address} rank={index + 1} />
                    <div className="ct-wallet-line">
                      <strong>{shortAddress(leader.address)}</strong>
                      <button
                        type="button"
                        className={`ct-wallet-copy ${copiedWallet === leader.address.toLowerCase() ? "copied" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyWallet(leader.address);
                        }}
                        aria-label="Copy full wallet address"
                        title="Copy full wallet address"
                      >
                        {copiedWallet === leader.address.toLowerCase() ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                    <span className="ct-rank">#{index + 1}</span>
                  </div>
                  <div className="ct-pnl-label">
                    REALIZED PNL · {window.toUpperCase()}
                  </div>
                  <div className="ct-pnl">
                    {money(leaderPnL(leader, window))}
                  </div>
                  <div className="ct-mini-grid">
                    <div>
                      <span>Volume</span>
                      <strong>{money(leaderVolume(leader, window))}</strong>
                    </div>
                    <div>
                      <span>Win rate</span>
                      <strong>
                        {leaderWinRate(leader, window) == null
                          ? "—"
                          : `${(number(leaderWinRate(leader, window)) * 100).toFixed(0)}%`}
                      </strong>
                    </div>
                    <div>
                      <span>Open pos.</span>
                      <strong>{leader.position_count}</strong>
                    </div>
                  </div>
                  <button
                    className="ct-copy-button"
                    onClick={() => openLeader(leader)}
                  >
                    Copy this leader <ArrowUpRight size={16} />
                  </button>
                </article>
              ))}
            </div>

            <div className="ct-table-wrap">
              <table className="ct-table">
                <thead>
                  <tr>
                    <th># / TRADER</th>
                    <th>REALIZED PNL</th>
                    <th>WIN RATE</th>
                    <th>VOLUME</th>
                    <th>OPEN</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleLeaders.slice(3).map((leader, index) => (
                    <tr key={leader.address}>
                      <td>
                        <div className="ct-trader">
                          <span>{index + 4}</span>
                          <Avatar address={leader.address} rank={index + 4} />
                          <div className="ct-wallet-line">
                            <strong>{shortAddress(leader.address)}</strong>
                            <button
                              type="button"
                              className={`ct-wallet-copy ${copiedWallet === leader.address.toLowerCase() ? "copied" : ""}`}
                              onClick={() => void copyWallet(leader.address)}
                              aria-label="Copy full wallet address"
                              title="Copy full wallet address"
                            >
                              {copiedWallet === leader.address.toLowerCase() ? (
                                <Check size={12} />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="ct-profit">
                        {money(leaderPnL(leader, window))}
                      </td>
                      <td>
                        {leaderWinRate(leader, window) == null
                          ? "—"
                          : `${(number(leaderWinRate(leader, window)) * 100).toFixed(1)}%`}
                      </td>
                      <td>{money(leaderVolume(leader, window))}</td>
                      <td>{leader.position_count}</td>
                      <td>
                        <button
                          className="ct-row-button"
                          onClick={() => openLeader(leader)}
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {lastUpdated > 0 && (
          <div className="ct-updated">
            ROTA snapshot · {new Date(lastUpdated).toLocaleString()}
          </div>
        )}
      </section>

      {selected && (
        <div
          className="ct-modal-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSelected(null)
          }
        >
          <form className="ct-modal ct-profile-modal" onSubmit={submitCopy}>
            <button
              type="button"
              className="ct-close"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              <X />
            </button>
            <div className="ct-profile-heading">
              <Avatar address={selected.address} rank={99} />
              <h2>{shortAddress(selected.address)}</h2>
              <button
                type="button"
                className={`ct-wallet-copy ct-profile-wallet-copy ${copiedWallet === selected.address.toLowerCase() ? "copied" : ""}`}
                onClick={() => void copyWallet(selected.address)}
                aria-label="Copy full wallet address"
                title="Copy full wallet address"
              >
                {copiedWallet === selected.address.toLowerCase() ? (
                  <Check size={13} />
                ) : (
                  <Copy size={13} />
                )}
              </button>
              <span className="ct-leader-label">LEADER</span>
              <div className="ct-profile-live">
                <i /> LIVE DATA
              </div>
            </div>

            <div className="ct-modal-tabs">
              <button
                type="button"
                className={modalView === "performance" ? "active" : ""}
                onClick={() => setModalView("performance")}
              >
                Performance
              </button>
              <button
                type="button"
                className={modalView === "settings" ? "active" : ""}
                onClick={() => setModalView("settings")}
              >
                Copy settings
              </button>
            </div>

            {modalView === "performance" ? (
              <div className="ct-performance">
                <div className="ct-performance-stats">
                  <div>
                    <span>30D realized PnL</span>
                    <strong>{money(selected.pnl_30d)}</strong>
                  </div>
                  <div>
                    <span>Win rate</span>
                    <strong>
                      {performance?.win_rate == null
                        ? selected.win_rate_30d == null
                          ? "—"
                          : `${(selected.win_rate_30d * 100).toFixed(1)}%`
                        : `${(performance.win_rate * 100).toFixed(1)}%`}
                    </strong>
                  </div>
                  <div>
                    <span>Avg. trade size</span>
                    <strong>
                      {money(
                        performance?.average_trade_size ??
                          selected.avg_trade_size ??
                          0,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Trades · 30D</span>
                    <strong>{performance?.trade_count ?? "—"}</strong>
                  </div>
                </div>

                <section className="ct-profile-section ct-chart-section">
                  <div className="ct-section-title">
                    <span>
                      <TrendingUp size={15} /> 30-day cumulative PnL
                    </span>
                    <b>{money(selected.pnl_30d)}</b>
                  </div>
                  {performanceLoading ? (
                    <div className="ct-profile-loading">
                      <LoaderCircle className="ct-spin" /> Loading trading
                      history…
                    </div>
                  ) : performanceError ? (
                    <div className="ct-profile-error">
                      <AlertTriangle size={16} /> {performanceError}. Summary
                      data is still available.
                    </div>
                  ) : (
                    <PerformanceChart data={performance?.pnl_curve ?? []} />
                  )}
                </section>

                <div className="ct-profile-columns">
                  <section className="ct-profile-section">
                    <div className="ct-section-title">
                      <span>
                        <BarChart3 size={15} /> Most traded pairs
                      </span>
                    </div>
                    <div className="ct-pair-list">
                      {performance?.most_traded_pairs.length ? (
                        performance.most_traded_pairs.map((pair, index) => (
                          <div key={pair.symbol}>
                            <span>
                              <b>{index + 1}</b>
                              {symbolLabel(pair.symbol)}
                            </span>
                            <small>
                              {pair.trade_count} trades · {money(pair.volume)}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p>No pair activity available.</p>
                      )}
                    </div>
                  </section>
                  <section className="ct-profile-section">
                    <div className="ct-section-title">
                      <span>
                        <Activity size={15} /> Open positions
                      </span>
                      <em>
                        {performance?.open_positions.length ??
                          selected.position_count}
                      </em>
                    </div>
                    <div className="ct-position-list">
                      {performance?.open_positions.length ? (
                        performance.open_positions.map((position) => {
                          const quantity = number(position.position_qty);
                          const entryPrice = number(
                            position.average_open_price,
                          );
                          const unrealizedPnL = number(position.unrealized_pnl);
                          const entryNotional = Math.abs(quantity) * entryPrice;
                          const pnlPercent = entryNotional
                            ? (unrealizedPnL / entryNotional) * 100
                            : 0;
                          const profitable = unrealizedPnL >= 0;
                          return (
                            <div key={position.symbol}>
                              <div className="ct-position-main">
                                <span>
                                  <b
                                    className={quantity > 0 ? "long" : "short"}
                                  >
                                    {quantity > 0 ? "LONG" : "SHORT"}
                                  </b>
                                  {symbolLabel(position.symbol)}
                                </span>
                                <small>
                                  {Math.abs(quantity).toLocaleString()}
                                  {position.leverage
                                    ? ` · ${position.leverage}x`
                                    : ""}
                                </small>
                              </div>
                              <div className="ct-position-metrics">
                                <small>
                                  Entry <b>{money(entryPrice)}</b> · Mark{" "}
                                  <b>{money(position.mark_price)}</b>
                                </small>
                                <strong
                                  className={
                                    profitable ? "ct-profit" : "ct-loss"
                                  }
                                >
                                  {signedMoney(unrealizedPnL)}{" "}
                                  <em>
                                    ({pnlPercent > 0 ? "+" : ""}
                                    {pnlPercent.toFixed(2)}%)
                                  </em>
                                </strong>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p>No open positions.</p>
                      )}
                    </div>
                  </section>
                </div>

                <section className="ct-profile-section">
                  <div className="ct-section-title">
                    <span>
                      <Clock3 size={15} /> Last 10 trades
                    </span>
                  </div>
                  <div className="ct-trades-wrap">
                    <table className="ct-profile-table">
                      <thead>
                        <tr>
                          <th>MARKET</th>
                          <th>SIDE</th>
                          <th>SIZE</th>
                          <th>PRICE</th>
                          <th>REALIZED PNL</th>
                          <th>TIME</th>
                        </tr>
                      </thead>
                      <tbody>
                        {performance?.recent_trades.length ? (
                          performance.recent_trades.map((trade) => (
                            <tr key={`${trade.id}-${trade.executed_timestamp}`}>
                              <td>{symbolLabel(trade.symbol)}</td>
                              <td>
                                <b
                                  className={
                                    trade.side.toLowerCase() === "buy"
                                      ? "long"
                                      : "short"
                                  }
                                >
                                  {trade.side}
                                </b>
                              </td>
                              <td>
                                {number(
                                  trade.executed_quantity,
                                ).toLocaleString()}
                              </td>
                              <td>{money(trade.executed_price)}</td>
                              <td
                                className={
                                  number(trade.realized_pnl) >= 0
                                    ? "ct-profit"
                                    : "ct-loss"
                                }
                              >
                                {trade.realized_pnl == null
                                  ? "—"
                                  : signedMoney(trade.realized_pnl)}
                              </td>
                              <td>
                                {new Date(
                                  trade.executed_timestamp,
                                ).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6}>
                              No recent trade history available.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <div className="ct-performance-footer">
                  <span>
                    <ShieldCheck size={16} /> Review the strategy before
                    allocating capital.
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalView("settings")}
                  >
                    Set copy limits <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="ct-settings-panel">
                <button
                  type="button"
                  className="ct-back"
                  onClick={() => setModalView("performance")}
                >
                  <ArrowLeft size={15} /> Back to performance
                </button>
                <h3>Set your copy limits</h3>
                <p className="ct-modal-sub">
                  Choose how {shortAddress(selected.address)} will be mirrored
                  in your account.
                </p>
                <div className="ct-warning">
                  <AlertTriangle size={18} />
                  <span>
                    Existing positions are not copied. Only new trades opened
                    after you subscribe will be mirrored.
                  </span>
                </div>
                <label className="ct-field ct-field-wide">
                  <span>
                    Copy ratio <b>{Math.round(settings.size_ratio * 100)}%</b>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={settings.size_ratio * 100}
                    onChange={(e) =>
                      setSetting("size_ratio", Number(e.target.value) / 100)
                    }
                  />
                  <small className="ct-field-help">
                    Percentage of each new leader trade to mirror.
                  </small>
                </label>
                <div className="ct-form-grid">
                  <label className="ct-field">
                    <span>Max leverage</span>
                    <div>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={settings.leverage}
                        onChange={(e) =>
                          setSetting("leverage", Number(e.target.value))
                        }
                      />
                      <em>x</em>
                    </div>
                    <small className="ct-field-help">
                      Copied trades will never exceed this leverage.
                    </small>
                  </label>
                  <label className="ct-field">
                    <span>Max position</span>
                    <div>
                      <em>$</em>
                      <input
                        type="number"
                        min="10"
                        value={settings.max_position_notional}
                        onChange={(e) =>
                          setSetting(
                            "max_position_notional",
                            Number(e.target.value),
                          )
                        }
                      />
                    </div>
                    <small className="ct-field-help">
                      Maximum exposure allowed for one market.
                    </small>
                  </label>
                  <label className="ct-field">
                    <span>Daily loss limit</span>
                    <div>
                      <em>$</em>
                      <input
                        type="number"
                        min="1"
                        value={settings.max_daily_loss}
                        onChange={(e) =>
                          setSetting("max_daily_loss", Number(e.target.value))
                        }
                      />
                    </div>
                    <small className="ct-field-help">
                      Copying pauses when today&apos;s loss reaches this amount.
                    </small>
                  </label>
                  <label className="ct-field">
                    <span>Concurrent positions</span>
                    <div>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={settings.max_concurrent_positions}
                        onChange={(e) =>
                          setSetting(
                            "max_concurrent_positions",
                            Number(e.target.value),
                          )
                        }
                      />
                    </div>
                    <small className="ct-field-help">
                      Maximum number of copied positions open together.
                    </small>
                  </label>
                  <label className="ct-field">
                    <span>Max slippage</span>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="5000"
                        value={settings.max_slippage_bps}
                        onChange={(e) =>
                          setSetting("max_slippage_bps", Number(e.target.value))
                        }
                      />
                      <em>bps</em>
                    </div>
                    <small className="ct-field-help">
                      Maximum accepted price movement before an order is
                      skipped.
                    </small>
                  </label>
                </div>
                {modalError && (
                  <div className="ct-modal-error">{modalError}</div>
                )}
                <div className="ct-modal-footer">
                  <span>
                    <ShieldCheck size={16} /> No withdrawal permission
                  </span>
                  <button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <LoaderCircle className="ct-spin" /> Awaiting approval
                      </>
                    ) : (
                      "Sign and start copying"
                    )}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </main>
  );
}
