import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock3,
  MessageSquare,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useAccount, useConfig } from "@orderly.network/hooks";
import {
  agentRequest,
  type AgentAccess,
  type AgentCapabilities,
  type AgentIntent,
  type AgentMessage,
  type AgentProposal,
  type AgentReply,
  type AgentSession,
  type AgentSettings,
  type AgentTask,
  type AgentTaskInput,
  type AgentTrace,
} from "@/services/agent";
import { withBasePath } from "@/utils/base-path";
import { getRuntimeConfig } from "@/utils/runtime-config";
import {
  assistantShortcuts,
  assistantOpenEvent,
  type AssistantOpenDetail,
} from "./shortcuts";
import "./assistant.css";

const defaults: AgentSettings = {
  provider: "starter",
  model: "openrouter/free",
  has_key: false,
  share_account_data: false,
  max_order_notional: 100,
  notes: "",
};
const defaultTask: AgentTaskInput = {
  kind: "daily_report",
  interval_seconds: 3600,
  hour: 9,
  timezone: "Europe/Istanbul",
  threshold: 0,
  direction: "above",
  notify: false,
};
const actionNames: Record<string, string> = {
  plan_order: "Order",
  plan_cancel_order: "Cancel order",
  plan_guard: "Guard policy",
  plan_bot_control: "Bot control",
  plan_copy_control: "Copy Trade control",
  plan_task: "Background task",
};
function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function RotaAssistant() {
  const { state } = useAccount();
  const network = useConfig("networkId");
  if (getRuntimeConfig("VITE_ROTA_AI_ENABLED") === "false") return null;
  return (
    <AssistantSession key={`${state.address}:${state.accountId}:${network}`} />
  );
}
function AssistantSession() {
  const { state, account } = useAccount();
  const network = useConfig("networkId");
  const storageKey = `rota-native-ai:${state.address || "guest"}:${state.accountId || "guest"}:${network}`;
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState("chat");
  const [token, setToken] = useState(
    () => sessionStorage.getItem(storageKey) || "",
  );
  const [caps, setCaps] = useState<AgentCapabilities>();
  const [access, setAccess] = useState<AgentAccess>();
  const [settings, setSettings] = useState<AgentSettings>(defaults);
  const [apiKey, setAPIKey] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [records, setRecords] = useState<unknown[]>([]);
  const [task, setTask] = useState<AgentTaskInput>(defaultTask);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [model, setModel] = useState("");
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  const controller = useRef(new AbortController());
  const locked = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const connected = !!state.address && !!state.accountId;
  useEffect(() => {
    alive.current = true;
    const current = new AbortController();
    controller.current = current;
    return () => {
      alive.current = false;
      current.abort();
    };
  }, []);
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, traces, busy]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => {
    function openAssistant(event: Event) {
      const detail = (event as CustomEvent<AssistantOpenDetail>).detail;
      setOpen(true);
      setTab(detail?.tab || "chat");
      if (detail?.prompt) setInput(detail.prompt);
    }
    window.addEventListener(assistantOpenEvent, openAssistant);
    return () => window.removeEventListener(assistantOpenEvent, openAssistant);
  }, []);
  const refresh = useCallback(async (session: string) => {
    const [next, history] = await Promise.all([
      agentRequest<AgentAccess>(
        "/settings",
        session,
        "GET",
        undefined,
        controller.current.signal,
      ),
      agentRequest<AgentMessage[]>(
        "/history",
        session,
        "GET",
        undefined,
        controller.current.signal,
      ),
    ]);
    if (!alive.current) return;
    setAccess(next);
    setSettings(next.settings);
    setMessages(history);
    if (next.authenticated) {
      const [items, reports, audit] = await Promise.all([
        agentRequest<AgentTask[]>(
          "/tasks",
          session,
          "GET",
          undefined,
          controller.current.signal,
        ),
        agentRequest<unknown[]>(
          "/reports",
          session,
          "GET",
          undefined,
          controller.current.signal,
        ),
        agentRequest<unknown[]>(
          "/audit",
          session,
          "GET",
          undefined,
          controller.current.signal,
        ),
      ]);
      if (alive.current) {
        setTasks(items);
        setRecords([...reports, ...audit]);
      }
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function initialize() {
      try {
        const capabilities = await agentRequest<AgentCapabilities>(
          "/capabilities",
          undefined,
          "GET",
          undefined,
          controller.current.signal,
        );
        if (cancelled || !alive.current) return;
        setCaps(capabilities);
        let current = token;
        if (!current) {
          const session = await agentRequest<AgentSession>(
            "/sessions",
            undefined,
            "POST",
            {},
            controller.current.signal,
          );
          if (cancelled || !alive.current) return;
          current = session.authorization_token;
          sessionStorage.setItem(storageKey, current);
          setToken(current);
        } else await refresh(current);
      } catch (e) {
        if (!cancelled && alive.current) {
          const message =
            e instanceof Error ? e.message : "AI could not start.";
          setError(message);
          if (message.includes("session expired")) {
            sessionStorage.removeItem(storageKey);
            setToken("");
            setMessages([]);
            setTraces([]);
            setProposals([]);
            setAccess(undefined);
          }
        }
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [open, token, storageKey, refresh, retry]);
  async function perform(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "ROTA AI request failed.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function authorize(scope: "read" | "read,trading") {
    await perform(async () => {
      if (
        !account?.address ||
        !account.accountId ||
        !account.chainId ||
        !account.walletAdapter
      )
        throw new Error("Connect your ROTA trading wallet first.");
      const intent = await agentRequest<AgentIntent>(
        "/credentials/intents",
        undefined,
        "POST",
        {
          wallet: account.address,
          account_id: account.accountId,
          chain_id: Number(account.chainId),
          scope,
        },
        controller.current.signal,
      );
      const signed = (await account.walletAdapter.generateAddOrderlyKeyMessage({
        publicKey: intent.public_key,
        brokerId: intent.broker_id,
        expiration: 365,
        timestamp: intent.timestamp,
        scope: intent.scope,
      })) as unknown as { signatured: string };
      if (!alive.current) return;
      const session = await agentRequest<AgentSession>(
        `/credentials/intents/${intent.id}/confirm`,
        undefined,
        "POST",
        { signature: signed.signatured },
        controller.current.signal,
      );
      if (!alive.current) return;
      sessionStorage.setItem(storageKey, session.authorization_token);
      setToken(session.authorization_token);
      setTraces([]);
      setProposals([]);
      await refresh(session.authorization_token);
      if (alive.current)
        setNotice(
          scope === "read"
            ? "Account connected with read-only access."
            : "Separate ROTA AI trading key authorized. Every action still needs confirmation.",
        );
    });
  }
  async function send() {
    if (!input.trim() || !token) return;
    const text = input.trim();
    await perform(async () => {
      setInput("");
      setTraces([]);
      setProposals([]);
      setMessages((current) => [...current, { role: "user", content: text }]);
      try {
        const reply = await agentRequest<AgentReply>(
          "/chat",
          token,
          "POST",
          { message: text },
          controller.current.signal,
        );
        if (!alive.current) return;
        setMessages((current) => [...current, reply.message]);
        setTraces(reply.traces);
        setProposals(reply.proposals);
        setModel(reply.model);
        setNotice(`${reply.remaining} messages remaining today`);
      } catch (e) {
        if (alive.current) {
          setInput(text);
          setMessages((current) => current.slice(0, -1));
        }
        throw e;
      }
    });
  }
  async function confirm(p: AgentProposal) {
    await perform(async () => {
      // The model response can never trigger this endpoint; only this explicit button can.
      const result = await agentRequest<unknown>(
        `/proposals/${p.id}/confirm`,
        token,
        "POST",
        { confirmed: true },
        controller.current.signal,
      );
      if (!alive.current) return;
      setProposals((items) => items.filter((item) => item.id !== p.id));
      setTraces((items) => [
        ...items,
        {
          name: `${actionNames[p.kind] || p.kind} result`,
          data: result,
          private: true,
        },
      ]);
      await refresh(token);
    });
  }
  function close() {
    setOpen(false);
    setAPIKey("");
    launcher.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const element = panel.current;
    function handle(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setAPIKey("");
        launcher.current?.focus();
      }
      if (event.key !== "Tab" || !element) return;
      const nodes = Array.from(
        element.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
        ),
      ).filter((node) => node.offsetParent !== null);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    element?.addEventListener("keydown", handle);
    return () => element?.removeEventListener("keydown", handle);
  }, [open]);
  const ready =
    !!token &&
    !!access &&
    (settings.provider !== "starter" || !!caps?.starter_ready);
  return (
    <>
      <button
        ref={launcher}
        className="rota-ai-launcher"
        aria-label="Open ROTA AI"
        aria-expanded={open}
        aria-controls="rota-native-ai"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={17} /> ROTA AI
      </button>
      {open && <div className="rota-ai-backdrop" aria-hidden="true" />}
      {open && (
        <section
          id="rota-native-ai"
          className="rota-ai-panel"
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-label="ROTA AI assistant"
          ref={panel}
        >
          <header className="rota-ai-header">
            <Sparkles size={22} />
            <div>
              <strong>
                ROTA <span>AI</span>
              </strong>
              <small>Research. Manage. Stay informed.</small>
            </div>
            <button
              ref={closeButton}
              onClick={close}
              aria-label="Close ROTA AI"
            >
              <X size={18} />
            </button>
          </header>
          <nav className="rota-ai-tabs" aria-label="Assistant views">
            {[
              ["chat", "Chat", MessageSquare],
              ["tasks", "Tasks", Clock3],
              ["settings", "Settings", Settings2],
            ].map(([id, label, Icon]) => (
              <button
                key={String(id)}
                aria-pressed={tab === id}
                onClick={() => setTab(String(id))}
              >
                {typeof Icon !== "string" && <Icon size={14} />}
                {String(label)}
              </button>
            ))}
          </nav>
          <div className="rota-ai-account">
            <ShieldCheck size={14} />
            <span>
              {access?.trading_authorized
                ? "Trading authorized · confirmation required"
                : access?.read_authorized
                  ? "Account connected · read only"
                  : "Public research"}
            </span>
            <span className="rota-ai-badge">
              {caps
                ? caps.dry_run
                  ? "SIMULATION"
                  : "LIVE"
                : error
                  ? "OFFLINE"
                  : "CONNECTING"}
            </span>
          </div>
          {error && (
            <div className="rota-ai-error" role="alert">
              {error}
              {!caps && (
                <button
                  onClick={() => {
                    setError("");
                    setRetry((value) => value + 1);
                  }}
                >
                  Retry connection
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="rota-ai-notice" role="status">
              {notice}
            </div>
          )}
          {tab === "chat" && (
            <>
              <div className="rota-ai-scroll" aria-live="polite">
                {!messages.length && (
                  <div className="rota-ai-welcome">
                    <span className="rota-ai-orb">
                      <Sparkles size={28} />
                    </span>
                    <h2>Your ROTA copilot</h2>
                    <p>
                      Live markets, portfolio risk, funding, technical research
                      and your ROTA strategies in one conversation.
                    </p>
                    <div className="rota-ai-prompts">
                      {[
                        "Compare BTC and ETH funding rates",
                        "Analyze my portfolio risk",
                        "Review my bots and copy trading",
                        "Create a daily position report at 9 AM in Istanbul",
                      ].map((prompt) => (
                        <button key={prompt} onClick={() => setInput(prompt)}>
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, index) => (
                  <article
                    key={index}
                    className={`rota-ai-message rota-ai-${m.role}`}
                  >
                    <small>{m.role === "user" ? "You" : "ROTA AI"}</small>
                    <p>{m.content}</p>
                  </article>
                ))}
                {traces.map((tr, index) => (
                  <details className="rota-ai-result" key={index}>
                    <summary>
                      {tr.name.replaceAll("_", " ")}
                      {tr.private ? " · private" : ""}
                      {tr.error ? " · unavailable" : ""}
                    </summary>
                    <pre>{tr.error || json(tr.data)}</pre>
                  </details>
                ))}
                {proposals.map((p) => (
                  <div className="rota-ai-proposal" key={p.id}>
                    <strong>
                      {actionNames[p.kind] || p.kind} ·{" "}
                      {p.kind === "plan_task"
                        ? "persistent task"
                        : p.dry_run
                          ? "simulation"
                          : "live action"}
                    </strong>
                    <pre>{json(p.args)}</pre>
                    <small>
                      Expires {new Date(p.expires_at).toLocaleTimeString()} ·
                      base asset quantities
                    </small>
                    <div>
                      <button
                        className="rota-ai-primary"
                        disabled={busy || now >= Date.parse(p.expires_at)}
                        onClick={() => void confirm(p)}
                      >
                        {now >= Date.parse(p.expires_at)
                          ? "Expired"
                          : p.kind === "plan_task"
                            ? "Confirm task"
                            : p.dry_run
                              ? "Confirm simulation"
                              : "Confirm live action"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await agentRequest(
                              `/proposals/${p.id}`,
                              token,
                              "DELETE",
                              undefined,
                              controller.current.signal,
                            );
                            if (alive.current)
                              setProposals((items) =>
                                items.filter((item) => item.id !== p.id),
                              );
                          })
                        }
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
                {busy && (
                  <p className="rota-ai-working" role="status">
                    ROTA AI is working…
                  </p>
                )}
                <div ref={end} />
              </div>
              {caps &&
                !caps.starter_ready &&
                settings.provider === "starter" && (
                  <div className="rota-ai-starter">
                    Free model activation is pending. Connect your own API in
                    Settings. Public tools remain available.
                  </div>
                )}
              <div className="rota-ai-shortcuts">
                <label>
                  Tool shortcuts
                  <select
                    aria-label="Tool shortcuts"
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      const shortcut = assistantShortcuts.find(
                        (item) => item.id === event.target.value,
                      );
                      if (shortcut) setInput(shortcut.prompt);
                    }}
                  >
                    <option value="">Choose a tool or example…</option>
                    {assistantShortcuts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Link to={withBasePath("/rota-ai")} onClick={close}>
                  Usage guide
                </Link>
              </div>
              <form
                className="rota-ai-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <textarea
                  aria-label="Message ROTA AI"
                  placeholder="Ask ROTA AI…"
                  value={input}
                  maxLength={4000}
                  disabled={busy}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="rota-ai-primary"
                  aria-label="Send message"
                  disabled={busy || !ready || !input.trim()}
                >
                  <Send size={17} />
                </button>
              </form>
              <footer className="rota-ai-footer">
                {model ||
                  (settings.provider === "starter"
                    ? `${caps?.daily_messages || 20} free messages / day`
                    : settings.model)}{" "}
                · Check tool timestamps before acting.
              </footer>
            </>
          )}
          {tab === "settings" && (
            <div className="rota-ai-scroll rota-ai-settings">
              <h2>Your AI, inside ROTA</h2>
              <p>
                The starter tier uses a free model. Add your own provider key
                for higher capacity; provider usage is billed to your account.
              </p>
              <div className="rota-ai-connect">
                <strong>ROTA account access</strong>
                <p>
                  Use a separate AI key for account tools. It cannot withdraw
                  funds.
                </p>
                <button
                  disabled={busy || !connected}
                  onClick={() => void authorize("read")}
                >
                  {access?.read_authorized
                    ? "Refresh account access"
                    : "Connect account (read only)"}
                </button>
                <button
                  disabled={
                    busy ||
                    !connected ||
                    access?.trading_authorized ||
                    getRuntimeConfig("VITE_ROTA_AI_TRADING_AUTHORIZATION") ===
                      "false"
                  }
                  onClick={() => void authorize("read,trading")}
                >
                  Enable AI trading
                </button>
                {!connected && (
                  <small>Connect your wallet on ROTA first.</small>
                )}
                {access?.read_authorized && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await agentRequest(
                          "/credentials",
                          token,
                          "DELETE",
                          undefined,
                          controller.current.signal,
                        );
                        await refresh(token);
                        if (alive.current)
                          setNotice(
                            "AI execution and account reads disabled. Revoke the exchange key in Orderly key management to remove it permanently.",
                          );
                      })
                    }
                  >
                    Disconnect AI account access
                  </button>
                )}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(async () => {
                    const next = await agentRequest<AgentAccess>(
                      "/settings",
                      token,
                      "PUT",
                      { ...settings, api_key: apiKey || undefined },
                      controller.current.signal,
                    );
                    if (!alive.current) return;
                    setAPIKey("");
                    setAccess(next);
                    setSettings(next.settings);
                    setMessages([]);
                    setProposals([]);
                    setTraces([]);
                    setNotice(
                      "Settings saved. Conversation cleared to protect provider privacy.",
                    );
                  });
                }}
              >
                <label>
                  Model provider
                  <select
                    value={settings.provider}
                    onChange={(event) => {
                      setSettings({
                        ...settings,
                        provider: event.target
                          .value as AgentSettings["provider"],
                        model:
                          event.target.value === "starter"
                            ? caps?.starter_model || "openrouter/free"
                            : "",
                        has_key: false,
                      });
                      setAPIKey("");
                    }}
                  >
                    <option value="starter">ROTA free starter</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="openai">OpenAI</option>
                    <option value="groq">Groq</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="anthropic">Anthropic Claude</option>
                  </select>
                </label>
                {settings.provider !== "starter" && (
                  <>
                    <label>
                      Model ID
                      <input
                        required
                        value={settings.model}
                        maxLength={160}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            model: event.target.value,
                          })
                        }
                        placeholder={
                          settings.provider === "anthropic"
                            ? "Claude model ID from your Anthropic console"
                            : "Tool-capable model ID from your provider"
                        }
                      />
                    </label>
                    <label>
                      API key
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={apiKey}
                        maxLength={4096}
                        onChange={(event) => setAPIKey(event.target.value)}
                        placeholder={
                          access?.settings.has_key &&
                          access.settings.provider === settings.provider
                            ? "Saved securely · leave blank to keep"
                            : "Your provider API key"
                        }
                      />
                    </label>
                    <small>
                      Encrypted on ROTA’s server. Never saved in your browser or
                      sent in chat.
                    </small>
                  </>
                )}
                <label className="rota-ai-check">
                  <input
                    type="checkbox"
                    checked={settings.share_account_data}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        share_account_data: event.target.checked,
                      })
                    }
                  />
                  Share account tool results with my selected AI provider for
                  analysis
                </label>
                <p className="rota-ai-hint">
                  When off, private results stay in ROTA tool cards. The model
                  receives a privacy notice.
                </p>
                <label>
                  Maximum AI order size (USDC)
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    step="any"
                    required
                    value={settings.max_order_notional}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        max_order_notional: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Saved preferences
                  <textarea
                    value={settings.notes}
                    maxLength={2000}
                    onChange={(event) =>
                      setSettings({ ...settings, notes: event.target.value })
                    }
                    placeholder="Preferred markets, reporting language, trading style… Never enter secrets."
                  />
                </label>
                <button
                  className="rota-ai-primary"
                  disabled={busy || !access?.authenticated}
                >
                  Save AI settings
                </button>
              </form>
              <button
                type="button"
                className="rota-ai-primary"
                disabled={busy || !access?.authenticated}
                onClick={() =>
                  void perform(async () => {
                    const result = await agentRequest<{
                      ok: boolean;
                      model: string;
                    }>(
                      "/model/test",
                      token,
                      "POST",
                      {},
                      controller.current.signal,
                    );
                    if (alive.current)
                      setNotice(
                        `Connection verified · ${result.model || access?.settings.model}.`,
                      );
                  })
                }
              >
                Test model connection
              </button>
              <p className="rota-ai-hint">
                Tests your saved provider and model with a small API request.
                Save changes first. Provider usage charges may apply. No account
                data or trading actions are sent.
              </p>
              <details>
                <summary>
                  {caps
                    ? `${caps.tools.length} native ROTA tools`
                    : "Native tools · connect service to load"}
                </summary>
                <ul>
                  {caps?.tools.map((t) => (
                    <li key={t.function.name}>
                      <strong>{t.function.name.replaceAll("_", " ")}</strong>
                      <p>{t.function.description}</p>
                    </li>
                  ))}
                </ul>
              </details>
              <div className="rota-ai-direct">
                <strong>Use tools without model tokens</strong>
                {[
                  "market_query",
                  "positions",
                  "portfolio_risk",
                  "bot_performance",
                  "copy_overview",
                ].map((name) => (
                  <button
                    disabled={busy || !token}
                    key={name}
                    onClick={() =>
                      void perform(async () => {
                        const tr = await agentRequest<AgentTrace>(
                          "/tools",
                          token,
                          "POST",
                          {
                            name,
                            args:
                              name === "market_query"
                                ? { type: "marketSummary", limit: 10 }
                                : {},
                          },
                          controller.current.signal,
                        );
                        if (alive.current) {
                          setTraces([tr]);
                          setTab("chat");
                        }
                      })
                    }
                  >
                    {name.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
              <Link
                to={withBasePath("/portfolio/notifications")}
                onClick={close}
              >
                Open ROTA Portfolio &amp; Telegram
              </Link>
            </div>
          )}
          {tab === "tasks" && (
            <div className="rota-ai-scroll rota-ai-settings">
              <h2>Your background desk</h2>
              <p>
                Reports and alerts run on ROTA even when this page is closed.
                They use no model tokens and never place trades.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(async () => {
                    await agentRequest(
                      "/tasks",
                      token,
                      "POST",
                      task,
                      controller.current.signal,
                    );
                    await refresh(token);
                    if (alive.current) setNotice("Background task created.");
                  });
                }}
              >
                <label>
                  Task
                  <select
                    value={task.kind}
                    onChange={(event) =>
                      setTask({
                        ...task,
                        kind: event.target.value as AgentTaskInput["kind"],
                      })
                    }
                  >
                    <option value="daily_report">Daily portfolio report</option>
                    <option value="position_watch">
                      Position &amp; risk changes
                    </option>
                    <option value="price_alert">Price alert</option>
                    <option value="funding_alert">Funding alert</option>
                  </select>
                </label>
                {task.kind === "daily_report" ? (
                  <>
                    <label>
                      Report hour
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={task.hour}
                        required
                        onChange={(event) =>
                          setTask({ ...task, hour: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Timezone
                      <input
                        value={task.timezone}
                        required
                        onChange={(event) =>
                          setTask({ ...task, timezone: event.target.value })
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    Check every (minutes)
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      value={task.interval_seconds / 60}
                      required
                      onChange={(event) =>
                        setTask({
                          ...task,
                          interval_seconds: Number(event.target.value) * 60,
                        })
                      }
                    />
                  </label>
                )}
                {(task.kind === "price_alert" ||
                  task.kind === "funding_alert") && (
                  <>
                    <label>
                      Symbol
                      <input
                        required
                        value={task.symbol || ""}
                        placeholder="PERP_BTC_USDC"
                        onChange={(event) =>
                          setTask({
                            ...task,
                            symbol: event.target.value.toUpperCase(),
                          })
                        }
                      />
                    </label>
                    <label>
                      Condition
                      <select
                        value={task.direction}
                        onChange={(event) =>
                          setTask({
                            ...task,
                            direction: event.target.value as "above" | "below",
                          })
                        }
                      >
                        <option value="above">At or above</option>
                        <option value="below">At or below</option>
                      </select>
                    </label>
                    <label>
                      {task.kind === "funding_alert"
                        ? "Funding fraction (0.0001 = 0.01%)"
                        : "Price (USDC)"}
                      <input
                        type="number"
                        step="any"
                        required
                        value={task.threshold}
                        onChange={(event) =>
                          setTask({
                            ...task,
                            threshold: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <label className="rota-ai-check">
                  <input
                    type="checkbox"
                    checked={task.notify}
                    onChange={(event) =>
                      setTask({ ...task, notify: event.target.checked })
                    }
                  />
                  Deliver to my verified ROTA Telegram
                </label>
                <button
                  className="rota-ai-primary"
                  disabled={busy || !access?.read_authorized}
                >
                  Create background task
                </button>
                {!access?.read_authorized && (
                  <small>
                    Connect your account in Settings to create tasks.
                  </small>
                )}
              </form>
              {tasks.map((t) => (
                <article className="rota-ai-task" key={t.id}>
                  <strong>
                    {t.kind.replaceAll("_", " ")} {t.symbol}
                  </strong>
                  <small>
                    {t.enabled
                      ? `Next: ${new Date(t.next_run).toLocaleString()}`
                      : "Paused"}
                  </small>
                  {t.last_error && <p>{t.last_error}</p>}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await agentRequest(
                          `/tasks/${t.id}`,
                          token,
                          "PATCH",
                          { enabled: !t.enabled },
                          controller.current.signal,
                        );
                        await refresh(token);
                      })
                    }
                  >
                    {t.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await agentRequest(
                          `/tasks/${t.id}`,
                          token,
                          "DELETE",
                          undefined,
                          controller.current.signal,
                        );
                        await refresh(token);
                      })
                    }
                  >
                    Delete
                  </button>
                </article>
              ))}
              <button
                disabled={busy || !access?.authenticated}
                onClick={() => void perform(() => refresh(token))}
              >
                Refresh reports &amp; actions
              </button>
              {records
                .slice()
                .reverse()
                .map((record, index) => (
                  <details className="rota-ai-result" key={index}>
                    <summary>Report / action {records.length - index}</summary>
                    <pre>{json(record)}</pre>
                  </details>
                ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
