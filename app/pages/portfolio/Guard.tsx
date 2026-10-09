import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldAlert, OctagonX, RefreshCw } from "lucide-react";
import { useAccount } from "@orderly.network/hooks";
import {
  createCredentialIntent,
  confirmCredentialIntent,
} from "@/services/copy-trade";
import {
  GuardAPIError,
  GuardPolicy,
  GuardState,
  guardRequest,
  guardReasonLabels,
  validateGuardPolicy,
} from "@/services/guard";
import "./guard.css";
import "./notifications.css";

const defaults: GuardPolicy = {
  enabled: false,
  max_loss_24h: 100,
  max_notional: 5000,
  min_liquidation_distance_percent: 5,
};
const money = (value: number | undefined) =>
  value === undefined
    ? "—"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
const eventLabels: Record<string, string> = {
  settings_updated: "Rules updated",
  triggered: "Guard stopped automation entries",
  cleanup_completed: "Bot order cleanup completed",
  reset: "Guard reset",
};

export default function PortfolioGuard() {
  const { account } = useAccount();
  const wallet = account.address?.toLowerCase() || "";
  const accountId = account.accountId || "";
  const identity = `${wallet}:${accountId}`;
  const storageKey = `rota-copytrade-session:${wallet}`;
  const current = useRef(identity);
  current.current = identity;
  const initialized = useRef(false);
  const requestVersion = useRef(0);
  const [state, setState] = useState<GuardState | null>(null);
  const [policy, setPolicy] = useState<GuardPolicy>(defaults);
  const [session, setSession] = useState({ identity: "", token: "" });
  const token = session.identity === identity ? session.token : "";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    initialized.current = false;
    requestVersion.current++;
    setState(null);
    setPolicy(defaults);
    setBusy("");
    setError("");
    setNotice("");
    setSession({
      identity,
      token: wallet && accountId ? localStorage.getItem(storageKey) || "" : "",
    });
  }, [identity, wallet, accountId, storageKey]);

  useEffect(() => {
    if (!wallet || !accountId || !token) return;
    const controller = new AbortController();
    let running = false;
    async function refresh() {
      if (running || busy) return;
      running = true;
      const version = requestVersion.current;
      setNow(Date.now());
      try {
        const value = await guardRequest(
          wallet,
          accountId,
          token,
          "",
          "GET",
          undefined,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          current.current !== identity ||
          version !== requestVersion.current
        )
          return;
        setState(value);
        setError("");
        if (!initialized.current) {
          setPolicy(
            value.updated_at.startsWith("0001-") ? defaults : value.policy,
          );
          initialized.current = true;
        }
      } catch (err) {
        if (controller.signal.aborted || current.current !== identity) return;
        if (
          err instanceof GuardAPIError &&
          (err.status === 401 || err.status === 409)
        ) {
          localStorage.removeItem(storageKey);
          setSession({ identity, token: "" });
          setState(null);
        }
        setError(
          err instanceof Error ? err.message : "Unable to refresh Guard",
        );
      } finally {
        running = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [wallet, accountId, token, identity, storageKey, busy]);

  async function authorize() {
    if (!wallet || !accountId || !account.walletAdapter || !account.chainId)
      throw new Error("Connect your ROTA trading account first.");
    if (!/^0x[0-9a-f]{40}$/i.test(wallet))
      throw new Error("Rota Guard currently requires an EVM trading wallet.");
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const intent = await createCredentialIntent({
      wallet,
      account_id: accountId,
      chain_id: Number(account.chainId),
    });
    if (current.current !== identity)
      throw new Error("Account changed; reconnect Guard.");
    if (intent.scope !== "read,trading")
      throw new Error(
        "Guard requires a trading key without withdrawal permission.",
      );
    const signed = (await account.walletAdapter.generateAddOrderlyKeyMessage({
      publicKey: intent.public_key,
      brokerId: intent.broker_id,
      expiration: 365,
      timestamp: intent.timestamp,
      scope: intent.scope,
    })) as unknown as { signatured: string };
    if (current.current !== identity)
      throw new Error("Account changed; reconnect Guard.");
    const confirmation = await confirmCredentialIntent(
      intent.id,
      signed.signatured,
    );
    if (current.current !== identity)
      throw new Error("Account changed; reconnect Guard.");
    localStorage.setItem(storageKey, confirmation.authorization_token);
    return confirmation.authorization_token;
  }

  async function run(
    action: string,
    path = "",
    method = "GET",
    input?: GuardPolicy,
  ) {
    setBusy(action);
    setError("");
    setNotice("");
    requestVersion.current++;
    try {
      let authToken = await authorize();
      let value: GuardState;
      try {
        value = await guardRequest(
          wallet,
          accountId,
          authToken,
          path,
          method,
          input,
        );
      } catch (err) {
        if (
          !(err instanceof GuardAPIError) ||
          (err.status !== 401 && err.status !== 409)
        )
          throw err;
        if (current.current !== identity) return;
        localStorage.removeItem(storageKey);
        authToken = await authorize();
        value = await guardRequest(
          wallet,
          accountId,
          authToken,
          path,
          method,
          input,
        );
      }
      if (current.current !== identity) return;
      setSession({ identity, token: authToken });
      setState(value);
      setNow(Date.now());
      setPolicy(value.updated_at.startsWith("0001-") ? defaults : value.policy);
      initialized.current = true;
      setNotice(
        action === "save"
          ? "Rules saved. A triggered stop remains locked until you reset Guard."
          : action === "reset"
            ? "Guard reset. Resume paused bots individually when ready."
            : action === "emergency"
              ? "New automation entries are blocked. Bot order cleanup runs in the background."
              : "Guard connected.",
      );
    } catch (err) {
      if (current.current === identity)
        setError(err instanceof Error ? err.message : "Unable to update Guard");
    } finally {
      if (current.current === identity) setBusy("");
    }
  }

  const snap = state?.snapshot;
  const fresh = !!snap && now - new Date(snap.updated_at).getTime() <= 20000;
  const stopped = !!state?.triggered_at;
  const status = stopped
    ? "Stopped"
    : !state
      ? "Not connected"
      : !state.policy.enabled
        ? "Disabled"
        : state.last_error || !fresh || error
          ? "Monitoring unavailable"
          : "Monitoring";
  const validation = validateGuardPolicy(policy);
  const changed =
    !!state && JSON.stringify(policy) !== JSON.stringify(state.policy);

  return (
    <main className="rota-notifications rota-guard">
      <div className="rn-heading">
        <div className="rn-icon">
          <ShieldCheck size={26} />
        </div>
        <div>
          <h1>Rota Guard</h1>
          <p>One set of risk rules for your ROTA trading account.</p>
        </div>
        <span
          className={`rg-status ${stopped || status === "Monitoring unavailable" ? "rg-danger" : ""}`}
          role="status"
        >
          {status}
        </span>
      </div>
      {error && (
        <div className="rn-message rn-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rn-message rn-success" role="status">
          {notice}
        </div>
      )}
      {!wallet || !accountId ? (
        <section className="rn-card">
          <h2>Connect your trading account</h2>
          <p>
            Connect your wallet and register your Orderly account to use Rota
            Guard.
          </p>
        </section>
      ) : (
        <>
          {!state && (
            <section className="rn-card">
              <h2>Connect Rota Guard</h2>
              <p>
                Authorize account monitoring and bot order cancellation. Your
                trading key cannot withdraw funds. Existing ROTA bot and copy
                trade authorization can be reused.
              </p>
              <button
                className="rn-primary"
                disabled={!!busy}
                onClick={() => void run("connect")}
              >
                {busy ? "Connecting…" : "Connect Guard"}
              </button>
            </section>
          )}
          {state && (
            <>
              {stopped && (
                <section className="rn-card rg-stop">
                  <h2>
                    <ShieldAlert size={20} />
                    {guardReasonLabels[state.reason || ""] || "Guard triggered"}
                  </h2>
                  <p>
                    New ROTA bot and copy trade entries are blocked until you
                    explicitly reset Guard. Positions remain open. Manual orders
                    remain available.
                  </p>
                  <p>
                    {state.cleanup_error ||
                      (state.cleanup_pending
                        ? "Pausing bots and cancelling tracked bot orders…"
                        : "Bot order cleanup completed. Paused bots will not resume automatically.")}
                  </p>
                  <button
                    className="rn-secondary"
                    disabled={!!busy || state.cleanup_pending}
                    onClick={() => void run("reset", "/reset", "POST")}
                  >
                    <RefreshCw size={16} />
                    {busy === "reset"
                      ? "Checking account…"
                      : "Check account and reset Guard"}
                  </button>
                </section>
              )}
              <div className="rg-metrics">
                <section className="rn-card">
                  <span>Rolling 24h P&L</span>
                  <strong>{money(snap?.pnl_24h)}</strong>
                </section>
                <section className="rn-card">
                  <span>Open position exposure</span>
                  <strong>{money(snap?.notional)}</strong>
                </section>
                <section className="rn-card">
                  <span>Nearest liquidation distance</span>
                  <strong>
                    {snap?.liquidation_data_complete &&
                    snap.min_liquidation_distance_percent != null
                      ? `${snap.min_liquidation_distance_percent.toFixed(2)}%`
                      : "—"}
                  </strong>
                </section>
              </div>
              <p className="rg-updated">
                {snap
                  ? `Account sample: ${new Date(snap.updated_at).toLocaleString()}${fresh ? "" : " · stale"}`
                  : "No account sample yet"}
                . P&L is reported by Orderly; this is a rolling 24-hour window.
              </p>
              {state.last_error && (
                <div className="rn-message rn-error" role="alert">
                  {state.last_error}
                </div>
              )}
              <form
                className="rn-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!validation) void run("save", "", "PUT", policy);
                }}
              >
                <div className="rn-card-heading">
                  <div>
                    <h2>Account rules</h2>
                    <p>A value of 0 disables an individual rule.</p>
                  </div>
                  <label className="rg-enable">
                    <input
                      type="checkbox"
                      checked={policy.enabled}
                      disabled={!!busy}
                      onChange={(event) =>
                        setPolicy({ ...policy, enabled: event.target.checked })
                      }
                    />
                    Enable monitoring
                  </label>
                </div>
                <div className="rg-fields">
                  {(
                    [
                      [
                        "max_loss_24h",
                        "24-hour loss threshold",
                        "USDC",
                        "Stop when reported 24-hour P&L reaches this loss.",
                      ],
                      [
                        "max_notional",
                        "Exposure stop threshold",
                        "USDC",
                        "Stop when gross open-position exposure reaches this amount.",
                      ],
                      [
                        "min_liquidation_distance_percent",
                        "Liquidation distance threshold",
                        "%",
                        "Stop new entries when any position gets this close to its estimated liquidation price.",
                      ],
                    ] as const
                  ).map(([name, label, unit, description]) => (
                    <label
                      className="rg-field"
                      key={name}
                      htmlFor={`guard-${name}`}
                    >
                      <span>{label}</span>
                      <div>
                        <input
                          id={`guard-${name}`}
                          type="number"
                          min="0"
                          max={unit === "%" ? 50 : undefined}
                          step="any"
                          required
                          value={Number.isNaN(policy[name]) ? "" : policy[name]}
                          disabled={!!busy}
                          onChange={(event) =>
                            setPolicy({
                              ...policy,
                              [name]:
                                event.target.value === ""
                                  ? NaN
                                  : Number(event.target.value),
                            })
                          }
                        />
                        <span>{unit}</span>
                      </div>
                      <small>{description}</small>
                    </label>
                  ))}
                </div>
                {validation && (
                  <p role="alert" className="rg-validation">
                    {validation}
                  </p>
                )}
                <div className="rn-save">
                  <p>Rules monitor all positions in this trading account.</p>
                  <button
                    className="rn-primary"
                    type="submit"
                    disabled={!!busy || !changed || !!validation}
                  >
                    {busy === "save" ? "Saving…" : "Save Guard rules"}
                  </button>
                </div>
                <p className="rn-footnote">
                  Guard runs on the server while your browser is closed. Limits
                  are monitored thresholds, not guaranteed loss or exposure
                  caps. In-flight orders and price moves can exceed them. Guard
                  pauses bots and cancels their tracked orders, including bot TP
                  orders; it does not close positions or cancel manual orders.
                  Liquidation-distance rules do not guarantee liquidation
                  prevention.
                </p>
              </form>
              <section className="rn-card rg-emergency">
                <div>
                  <h2>
                    <OctagonX size={19} />
                    Emergency automation stop
                  </h2>
                  <p>
                    Immediately lock new automation entries and start bot order
                    cleanup. Existing positions remain open.
                  </p>
                </div>
                <button
                  className="rn-secondary rg-danger-button"
                  disabled={!!busy || stopped}
                  onClick={() =>
                    void run("emergency", "/emergency-stop", "POST")
                  }
                >
                  {busy === "emergency" ? "Stopping…" : "Stop automation"}
                </button>
              </section>
              <section className="rn-card">
                <h2>Guard activity</h2>
                {state.events.length === 0 ? (
                  <p>No Guard events yet.</p>
                ) : (
                  <ol className="rg-events">
                    {[...state.events].reverse().map((event, index) => (
                      <li key={`${event.at}:${index}`}>
                        <div>
                          <strong>
                            {eventLabels[event.type] || event.type}
                          </strong>
                          {event.detail && (
                            <span>
                              {guardReasonLabels[event.detail] || event.detail}
                            </span>
                          )}
                        </div>
                        <time dateTime={event.at}>
                          {new Date(event.at).toLocaleString()}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
