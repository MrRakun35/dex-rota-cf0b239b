import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useAccount, useConfig, useKeyStore } from "@orderly.network/hooks";
import { withBasePath } from "@/utils/base-path";
import { getRuntimeConfig } from "@/utils/runtime-config";
import { sealTradingKey } from "./credentials";
import {
  AUTH,
  getAssistantUrl,
  isAssistantMessage,
  isPublicKeyMessage,
} from "./protocol";
import "./assistant.css";

type Status = "idle" | "consent" | "waiting" | "sealing" | "sent" | "error";

export default function RotaAssistant() {
  const { state } = useAccount();
  const network = useConfig("networkId");
  if (getRuntimeConfig("VITE_ROTA_AI_ENABLED") === "false") return null;
  // Discard the embedded account session on wallet, subaccount or network changes.
  return (
    <AssistantSession key={`${state.address}:${state.accountId}:${network}`} />
  );
}

function AssistantSession() {
  const { state } = useAccount();
  const keyStore = useKeyStore();
  const brokerId = useConfig<string>("brokerId");
  const networkId = useConfig<"mainnet" | "testnet">("networkId");
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const consentButton = useRef<HTMLButtonElement>(null);
  const phase = useRef<Status>("idle");
  const actionId = useRef<string>();
  const generation = useRef(0);
  const usedNonces = useRef(new Set<string>());
  const service = useMemo(() => {
    try {
      return { url: getAssistantUrl(), error: "" };
    } catch {
      return { url: null, error: "ROTA AI service configuration is invalid." };
    }
  }, []);
  const url = service.url;
  const enabled =
    getRuntimeConfig("VITE_ROTA_AI_TRADING_AUTHORIZATION") !== "false";
  const connected = !!state.address && !!state.accountId;

  function updateStatus(next: Status) {
    phase.current = next;
    setStatus(next);
  }
  function close() {
    if (["consent", "waiting", "sealing"].includes(phase.current)) {
      post({
        type: AUTH.ERROR,
        message: "Authorization cancelled.",
        actionId: actionId.current,
      });
    }
    generation.current++;
    updateStatus("idle");
    setOpen(false);
    launcher.current?.focus();
  }
  function post(data: Record<string, unknown>) {
    if (url) frame.current?.contentWindow?.postMessage(data, url.origin);
  }
  function requestConsent(id?: string) {
    if (
      phase.current === "waiting" ||
      phase.current === "sealing" ||
      phase.current === "consent"
    )
      return;
    if (!enabled || !connected || !ready) {
      const message = !enabled
        ? "AI trading authorization is disabled."
        : !connected
          ? "Connect your wallet and enable trading on ROTA first."
          : "Wait for the assistant to load.";
      setError(message);
      updateStatus("error");
      post({ type: AUTH.ERROR, message, actionId: id });
      return;
    }
    actionId.current = id;
    setError("");
    updateStatus("consent");
  }
  function cancelConsent() {
    post({
      type: AUTH.ERROR,
      message: "Authorization cancelled.",
      actionId: actionId.current,
    });
    updateStatus("idle");
  }
  function authorize() {
    if (phase.current !== "consent" || !url) return;
    updateStatus("waiting");
    post({
      type: AUTH.REQUEST,
      scope: "trade-only",
      actionId: actionId.current,
    });
  }

  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  useEffect(() => {
    if (status === "consent") consentButton.current?.focus();
  }, [status]);
  useEffect(() => {
    if (!started || ready) return;
    const timeout = window.setTimeout(() => setSlow(true), 20000);
    return () => window.clearTimeout(timeout);
  }, [started, ready, reload]);
  useEffect(() => {
    if (status !== "waiting" && status !== "sealing") return;
    const timeout = window.setTimeout(() => {
      generation.current++;
      phase.current = "error";
      setStatus("error");
      setError("Connection timed out. Please try again.");
    }, 30000);
    return () => window.clearTimeout(timeout);
  }, [status]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
    // close only uses stable refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  useEffect(() => {
    if (!url || !open) return;
    async function receive(event: MessageEvent) {
      if (!isAssistantMessage(event, url!.origin, frame.current?.contentWindow))
        return;
      const data = event.data as Record<string, unknown>;
      if (data.type === "starchild_close_panel") {
        close();
        return;
      }
      if (
        data.type === AUTH.TRIGGER &&
        (data.actionId === undefined || typeof data.actionId === "string")
      ) {
        requestConsent(data.actionId as string | undefined);
        return;
      }
      if (phase.current !== "waiting" || !isPublicKeyMessage(data)) return;
      if (
        (data.actionId !== undefined && data.actionId !== actionId.current) ||
        usedNonces.current.has(data.nonce)
      )
        return;
      usedNonces.current.add(data.nonce);
      updateStatus("sealing");
      const attempt = generation.current;
      try {
        if (
          !enabled ||
          !state.address ||
          !state.accountId ||
          !brokerId ||
          (networkId !== "mainnet" && networkId !== "testnet")
        ) {
          throw new Error("Connect your ROTA trading account first.");
        }
        const key = keyStore.getOrderlyKey(state.address);
        if (!key)
          throw new Error(
            "Enable trading on ROTA before connecting AI trading.",
          );
        const ciphertext = await sealTradingKey(data.pubKey, key.secretKey);
        if (attempt !== generation.current) return;
        post({
          type: AUTH.RESULT,
          nonce: data.nonce,
          ciphertext,
          accountId: state.accountId,
          brokerId,
          networkId,
          actionId: actionId.current,
        });
        updateStatus("sent");
      } catch {
        if (attempt !== generation.current) return;
        const message =
          "AI trading could not be connected. Check your wallet and try again.";
        setError(message);
        updateStatus("error");
        post({ type: AUTH.ERROR, message, actionId: actionId.current });
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
    // Handlers read live SDK state; refs guard repeated and cancelled requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    url,
    open,
    ready,
    enabled,
    state.address,
    state.accountId,
    keyStore,
    brokerId,
    networkId,
  ]);

  function retry() {
    generation.current++;
    updateStatus("idle");
    setError("");
    setReady(false);
    setSlow(false);
    setReload((value) => value + 1);
  }

  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="rota-ai-launcher"
        aria-label="Open ROTA AI"
        aria-expanded={open}
        aria-controls="rota-ai-panel"
        onClick={() => {
          if (open) close();
          else {
            setStarted(true);
            setOpen(true);
          }
        }}
      >
        <Sparkles size={19} />
        <span>ROTA AI</span>
      </button>
      {started && (
        <section
          id="rota-ai-panel"
          className="rota-ai-panel"
          hidden={!open}
          role="dialog"
          aria-label="ROTA AI assistant"
        >
          <header className="rota-ai-header">
            <img
              src={withBasePath("/rota-logo-32.svg")}
              alt=""
              width="32"
              height="32"
            />
            <div>
              <strong>
                ROTA <span>AI</span>
              </strong>
              <small>Your trading copilot</small>
            </div>
            <button type="button" onClick={retry} aria-label="Reload assistant">
              <RotateCcw size={16} />
            </button>
            <button
              ref={closeButton}
              type="button"
              onClick={close}
              aria-label="Close ROTA AI"
            >
              <X size={20} />
            </button>
          </header>
          <div className="rota-ai-context">
            <span>
              <i className={connected ? "is-connected" : ""} />
              {connected ? "ROTA account connected" : "Market research"}
            </span>
            <Link to="/intelligence" onClick={close}>
              Intelligence <ArrowUpRight size={13} />
            </Link>
          </div>
          {status === "consent" && (
            <div className="rota-ai-consent">
              <strong>
                <ShieldCheck size={17} /> Connect AI trading
              </strong>
              <p>
                Allow the AI service at <b>{url?.hostname}</b> to receive your
                encrypted Orderly trading key and use its existing permissions
                to access your account and place or cancel orders.
              </p>
              <small>
                You can revoke this key in Portfolio → API Keys. Encryption
                protects the transfer; the AI service can decrypt and use the
                key.
              </small>
              <div>
                <button type="button" onClick={cancelConsent}>
                  Cancel
                </button>
                <button
                  ref={consentButton}
                  type="button"
                  className="is-primary"
                  onClick={authorize}
                >
                  Allow AI trading
                </button>
              </div>
            </div>
          )}
          {(error || service.error) && (
            <p className="rota-ai-error" role="alert">
              {error || service.error}
            </p>
          )}
          {(status === "waiting" ||
            status === "sealing" ||
            status === "sent") && (
            <p className="rota-ai-status" role="status">
              {status === "sent"
                ? "Encrypted connection sent. Check the assistant for confirmation."
                : "Connecting your trading account…"}
            </p>
          )}
          <div className="rota-ai-chat">
            {!ready && url && (
              <div className="rota-ai-loading" role="status">
                <Sparkles size={24} />
                <strong>
                  {slow
                    ? "The assistant is taking longer to load"
                    : "Opening ROTA AI…"}
                </strong>
                <span>
                  {slow
                    ? "Check your connection and try reloading."
                    : "Research markets. Review positions. Plan your next move."}
                </span>
                {slow && (
                  <button type="button" onClick={retry}>
                    Try again
                  </button>
                )}
              </div>
            )}
            {url && (
              <iframe
                key={reload}
                ref={frame}
                src={url.toString()}
                title="ROTA AI chat"
                onLoad={() => {
                  setReady(true);
                  setSlow(false);
                }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                allow="clipboard-write"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
          </div>
          <footer className="rota-ai-footer">
            <span>
              <ShieldCheck size={13} />
              {networkId === "testnet" ? "Testnet" : "Mainnet"}
            </span>
            <button
              type="button"
              disabled={
                !enabled ||
                !ready ||
                status === "consent" ||
                status === "waiting" ||
                status === "sealing"
              }
              onClick={() => requestConsent()}
            >
              Connect AI trading
            </button>
          </footer>
        </section>
      )}
    </>
  );
}
