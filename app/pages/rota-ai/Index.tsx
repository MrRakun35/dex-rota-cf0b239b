import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  MessageSquare,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  assistantShortcuts,
  openAssistant,
} from "@/components/assistant/shortcuts";
import { getRuntimeConfig } from "@/utils/runtime-config";
import "./guide.css";

export default function RotaAIIndex() {
  const enabled = getRuntimeConfig("VITE_ROTA_AI_ENABLED") !== "false";
  return (
    <div className="rota-ai-guide">
      <title>Rota AI · User Guide | ROTA.finance</title>
      <section className="rota-ai-guide-hero">
        <div className="rota-ai-guide-eyebrow">
          <Sparkles size={16} /> YOUR NATIVE ROTA AI ASSISTANT
        </div>
        <h1>
          Understand the market.
          <br />
          Stay on top of your portfolio.
        </h1>
        <p>
          Rota AI brings market research, your account and ROTA tools into one
          conversation. Describe what you want in your own language, review the
          results and confirm any proposed actions yourself.
        </p>
        <div className="rota-ai-guide-actions">
          <button disabled={!enabled} onClick={() => openAssistant()}>
            <MessageSquare size={16} /> Open chat
          </button>
          <button
            disabled={!enabled}
            onClick={() => openAssistant({ tab: "settings" })}
          >
            <Settings2 size={16} /> Model settings
          </button>
        </div>
        {!enabled && (
          <p>
            ROTA AI is disabled in this environment. You can still explore the
            guide below.
          </p>
        )}
      </section>
      <section className="rota-ai-guide-start">
        <h2>
          <BookOpen size={20} /> Get started in three steps
        </h2>
        <ol>
          <li>
            <strong>Choose your model.</strong> Start with ROTA free starter,
            powered by shared Groq and Gemini capacity, without entering an API
            key. If free capacity is unavailable, try again later or connect
            your own API.
          </li>
          <li>
            <strong>Connect your account.</strong> Go to Settings → Connect
            account for read-only access. An account connection is also required
            to save your own model settings. Enable account-data sharing
            separately if you want model-written portfolio analysis.
          </li>
          <li>
            <strong>Ask, then review.</strong> Try an example below or select a
            tool from the chat’s Tool shortcuts list. Examples fill an editable
            draft; they are only sent when you press Send.
          </li>
        </ol>
      </section>
      <section>
        <div className="rota-ai-guide-section-heading">
          <h2>What can you do?</h2>
          <span>Example prompts · edit and send</span>
        </div>
        <div className="rota-ai-guide-grid">
          {assistantShortcuts.map((item, index) => (
            <article className="rota-ai-guide-card" key={item.id}>
              <span className="rota-ai-guide-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <small>{item.tools}</small>
              <blockquote>{item.prompt}</blockquote>
              <button
                disabled={!enabled}
                onClick={() => openAssistant({ prompt: item.prompt })}
              >
                Try in chat <ArrowUpRight size={15} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="rota-ai-guide-grid rota-ai-guide-details">
        <article>
          <h2>Connect your own model</h2>
          <p>
            In Settings → Model provider, choose OpenRouter, OpenAI, Groq,
            Google Gemini or Anthropic Claude. Enter a tool-capable Model ID
            from your provider’s console and your API key. Select Save AI
            settings, then Test model connection to check the saved connection.
            This sends a small API request; provider usage charges may apply.
          </p>
          <p>
            Your key is encrypted on the server and never saved in browser
            storage. Never paste keys into chat. Changing providers clears the
            previous conversation. Use Saved preferences for your preferred
            markets, language and report format.
          </p>
        </article>
        <article>
          <h2>Confirmations & privacy</h2>
          <p>
            With account-data sharing off, private results appear in ROTA cards
            and are withheld from the model. Orders, Guard changes, bot controls
            and tasks created through chat first appear as proposals. Separate
            AI trading authorization, order limits, Guard checks and expiry
            rules apply to trading actions.
          </p>
          <p>
            Check the LIVE or SIMULATION label before confirming. Market intents
            become slippage-capped IOC orders and may fill partially.
            Withdrawals, transfers and automatic portfolio rebalancing are
            unavailable.
          </p>
        </article>
        <article>
          <h2>Tasks & Telegram</h2>
          <p>
            Create, pause and delete tasks in the Tasks tab, and review reports
            and action records there. Position monitoring needs account access;
            Telegram delivery needs a verified notification connection.
          </p>
          <p>
            Simple prompts: “Alert me when BTC rises above 100000 USDC.” ·
            “Alert me when ETH funding exceeds 0.01%.” · “Monitor position
            changes every hour.”
          </p>
          <Link to="/portfolio/notifications">
            Portfolio & Telegram settings →
          </Link>
        </article>
        <article>
          <h2>Use tools without model tokens</h2>
          <p>
            In Settings → Use tools without model tokens, open market summaries,
            positions, portfolio risk, bot performance and Copy Trade directly.
            Private tools require a connected account.
          </p>
          <p>
            Check source timestamps and errors in the tool cards. If both free
            providers reach their quotas or become unavailable, the assistant
            asks you to try again later or use your own API. Free requests never
            switch to your personal provider automatically.
          </p>
          <button
            disabled={!enabled}
            onClick={() => openAssistant({ tab: "tasks" })}
          >
            Open my tasks →
          </button>
        </article>
      </section>
    </div>
  );
}
