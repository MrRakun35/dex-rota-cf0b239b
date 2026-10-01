import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useAccount } from "@orderly.network/hooks";
import {
  notificationEvents,
  notificationRequest,
  NotificationSettings,
  NotificationAPIError,
  withNotificationAuthorization,
  createNotificationCredentialIntent,
  confirmNotificationCredentialIntent,
} from "@/services/notifications";
import "./notifications.css";

export default function PortfolioNotifications() {
  const { account } = useAccount();
  const wallet = account.address?.toLowerCase() || "";
  const storageKey = `rota-notifications-session:${wallet}:${account.accountId || ""}`;
  const currentSession = useRef(storageKey);
  currentSession.current = storageKey;
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [botToken, setBotToken] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(null);
    setSelected([]);
    setBotToken("");
    setLink("");
    setError("");
    setNotice("");
    setBusy("");
    setLoaded(false);
    const token = localStorage.getItem(storageKey);
    if (!wallet || !token) return;
    const controller = new AbortController();
    notificationRequest<NotificationSettings>(
      wallet,
      token,
      "",
      "GET",
      undefined,
      controller.signal,
    )
      .then((value) => {
        setSettings(value);
        setSelected(value.events);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof NotificationAPIError && err.status === 401)
          localStorage.removeItem(storageKey);
        else
          setError(
            err instanceof Error ? err.message : "Unable to load notifications",
          );
      });
    return () => controller.abort();
  }, [wallet, storageKey]);

  async function authorize(force = false) {
    if (
      !account.address ||
      !account.accountId ||
      !account.chainId ||
      !account.walletAdapter
    )
      throw new Error("Connect your ROTA trading wallet first.");
    if (!/^0x[0-9a-f]{40}$/i.test(account.address))
      throw new Error(
        "Telegram notifications currently require an EVM trading wallet.",
      );
    const existing = localStorage.getItem(storageKey);
    if (existing && !force) return existing;
    if (force) localStorage.removeItem(storageKey);
    const intent = await createNotificationCredentialIntent({
      wallet,
      account_id: account.accountId,
      chain_id: Number(account.chainId),
    });
    if (intent.scope !== "read")
      throw new Error(
        "Notifications require a read-only API key. Update the backend before authorizing.",
      );
    const signed = (await account.walletAdapter.generateAddOrderlyKeyMessage({
      publicKey: intent.public_key,
      brokerId: intent.broker_id,
      expiration: 365,
      timestamp: intent.timestamp,
      scope: "read",
    })) as unknown as { signatured: string };
    if (currentSession.current !== storageKey)
      throw new Error("Account changed. Try again with your current account.");
    const confirmation = await confirmNotificationCredentialIntent(
      wallet,
      intent.id,
      signed.signatured,
    );
    localStorage.setItem(storageKey, confirmation.authorization_token);
    return confirmation.authorization_token;
  }

  async function run(
    action: string,
    operation: (token: string) => Promise<() => void>,
  ) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const apply = await withNotificationAuthorization(authorize, operation);
      if (currentSession.current === storageKey) apply();
    } catch (err) {
      if (currentSession.current === storageKey)
        setError(
          err instanceof Error ? err.message : "Unable to update notifications",
        );
    } finally {
      if (currentSession.current === storageKey) setBusy("");
    }
  }

  function load() {
    void run("load", async (token) => {
      const value = await notificationRequest<NotificationSettings>(
        wallet,
        token,
      );
      return () => {
        setSettings(value);
        setSelected(value.events);
        setLoaded(true);
      };
    });
  }
  function connect() {
    void run("connect", async (token) => {
      const value = await notificationRequest<{ telegram_url: string }>(
        wallet,
        token,
        "/telegram/connect",
        "POST",
        { token: botToken.trim() },
      );
      return () => {
        setLink(value.telegram_url);
        setBotToken("");
        setNotice(
          "Open your bot in Telegram and press Start, then verify the connection below.",
        );
      };
    });
  }
  function verify() {
    void run("verify", async (token) => {
      const value = await notificationRequest<NotificationSettings>(
        wallet,
        token,
        "/telegram/verify",
        "POST",
      );
      return () => {
        setSettings(value);
        setSelected(value.events);
        setLoaded(true);
        setLink("");
        setNotice(
          "Connected! A confirmation message was sent to your Telegram. Choose your notifications below.",
        );
      };
    });
  }
  function save() {
    void run("save", async (token) => {
      const value = await notificationRequest<NotificationSettings>(
        wallet,
        token,
        "",
        "PUT",
        { events: selected },
      );
      return () => {
        setSettings(value);
        setSelected(value.events);
        setNotice("Notification preferences saved.");
      };
    });
  }
  function disconnect() {
    void run("disconnect", async (token) => {
      await notificationRequest(wallet, token, "/telegram", "DELETE");
      return () => {
        setSettings({ verified: false, events: [] });
        setSelected([]);
        setLink("");
        setBotToken("");
        setNotice("Telegram disconnected.");
      };
    });
  }

  const changed =
    JSON.stringify([...selected].sort()) !==
    JSON.stringify([...(settings?.events || [])].sort());
  return (
    <main className="rota-notifications">
      <div className="rn-heading">
        <div className="rn-icon">
          <Bell size={24} />
        </div>
        <div>
          <h1>Telegram Notifications</h1>
          <p>Your trading activity, delivered to Telegram.</p>
        </div>
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
      {!wallet ? (
        <section className="rn-card">
          <h2>Connect your wallet</h2>
          <p>
            Connect your ROTA trading wallet to set up Telegram notifications.
          </p>
        </section>
      ) : (
        <>
          {!loaded && (
            <section className="rn-card">
              <h2>Access your notifications</h2>
              <p>
                Authorize read-only access to monitor all trading activity on
                your account, including manual trades, while you are away. This
                connection cannot place orders.
              </p>
              <button className="rn-primary" disabled={!!busy} onClick={load}>
                {busy === "load" ? "Loading…" : "Load notification settings"}
              </button>
            </section>
          )}
          <section className="rn-card">
            <div className="rn-card-heading">
              <div>
                <h2>
                  <Send size={19} /> Telegram bot
                </h2>
                <p>
                  Connect a dedicated bot created with{" "}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @BotFather <ExternalLink size={12} />
                  </a>
                  .
                </p>
              </div>
              {settings?.verified && (
                <span className="rn-badge">
                  <CheckCircle2 size={15} /> Connected
                </span>
              )}
            </div>
            {settings?.verified && (
              <div className="rn-connected">
                <span>@{settings.bot_username}</span>
                <button
                  className="rn-secondary"
                  disabled={!!busy}
                  onClick={disconnect}
                >
                  {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                connect();
              }}
            >
              <label className="rn-label" htmlFor="telegram-bot-token">
                {settings?.verified ? "Connect a different bot" : "Bot token"}
              </label>
              <div className="rn-input-row">
                <input
                  id="telegram-bot-token"
                  type="password"
                  autoComplete="new-password"
                  placeholder="123456789:AA…"
                  value={botToken}
                  disabled={!!busy}
                  onChange={(event) => {
                    setBotToken(event.target.value);
                    setLink("");
                  }}
                />
                <button
                  className="rn-primary"
                  disabled={!!busy || !botToken.trim()}
                  type="submit"
                >
                  {busy === "connect" ? "Connecting…" : "Verify bot"}
                </button>
              </div>
            </form>
            <p className="rn-security">
              <ShieldCheck size={15} /> Your token is encrypted and never shown
              after saving.
            </p>
            {link && (
              <div className="rn-link-step">
                <h3>Confirm your Telegram chat</h3>
                <p>
                  Open the bot using this link and press Start. The link expires
                  in 10 minutes.
                </p>
                <div className="rn-actions">
                  <a
                    className="rn-secondary"
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Telegram <ExternalLink size={14} />
                  </a>
                  <button
                    className="rn-primary"
                    disabled={!!busy}
                    onClick={verify}
                  >
                    {busy === "verify" ? "Verifying…" : "Verify connection"}
                  </button>
                </div>
              </div>
            )}
          </section>
          {settings?.verified && (
            <section className="rn-card">
              <div className="rn-card-heading">
                <div>
                  <h2>Trading notifications</h2>
                  <p>
                    Choose which events you want to receive. Save to apply your
                    selection.
                  </p>
                </div>
              </div>
              <div className="rn-options">
                {notificationEvents.map(([id, title, description]) => (
                  <label
                    key={id}
                    htmlFor={`notification-${id}`}
                    aria-label={title}
                    className={`rn-option ${selected.includes(id) ? "rn-selected" : ""}`}
                  >
                    <div>
                      <strong>{title}</strong>
                      <span>{description}</span>
                    </div>
                    <input
                      id={`notification-${id}`}
                      type="checkbox"
                      checked={selected.includes(id)}
                      disabled={!!busy}
                      onChange={(event) =>
                        setSelected((old) =>
                          event.target.checked
                            ? [...old, id]
                            : old.filter((item) => item !== id),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="rn-save">
                <p>
                  {selected.length
                    ? `${selected.length} notification types selected`
                    : "All trading notifications are off"}
                </p>
                <button
                  className="rn-primary"
                  disabled={!!busy || !changed}
                  onClick={save}
                >
                  {busy === "save" ? "Saving…" : "Save preferences"}
                </button>
              </div>
              <p className="rn-footnote">
                Messages include rota.finance, symbol, price, quantity and
                leverage when provided by the exchange. TP/SL alerts are sent on
                execution. Position updates use the mark price and may also
                produce a separate order notification.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
