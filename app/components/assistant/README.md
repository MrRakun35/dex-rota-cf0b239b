# Native ROTA AI

`RotaAssistant.tsx` is ROTA's local chat, model settings, tools, action-confirmation and Tasks UI. It uses the existing Orderly provider account and `/v1/agent` on the configured ROTA backend. There is no iframe or dependency on Starchild's service.

Users start with the backend-configured free tier and may connect their account and save their own OpenRouter/OpenAI/Groq/Gemini/Anthropic Claude provider/model. API keys are sent only through the encrypted backend settings flow and cleared from component memory on close/save; they are never persisted in the browser. Session tokens are isolated by wallet/account/network and expire in 24 hours. Account change unmounts and aborts pending work.

Account reads require a separate read-only Orderly authorization. Trading uses another explicit read/trading authorization. Model tool calls create pending proposals; an explicit click confirms one. Private results are local cards unless the user opts to share them with their selected model. Persistent reports and alerts require no model tokens.

`VITE_ROTA_AI_ENABLED=false` hides the assistant. `VITE_ROTA_AI_TRADING_AUTHORIZATION=false` disables the UI's trading authorization button. Backend policies remain authoritative. The previous `VITE_ROTA_AI_URL` is removed.

Deploy the companion backend at the same time. See `backend/docs/rota-ai.md` for operator starter configuration, optional ROTA-owned Ollama model, data retention, execution controls and current capability boundaries. A missing starter runtime displays unavailable; the UI does not simulate a model response.

Historical Starchild MIT notices remain under this directory/public licenses for prior integration provenance. Runtime imports do not use that plugin.

## Provider connection checks and guide

Anthropic Claude uses the native Messages API with `x-api-key`, `anthropic-version: 2023-06-01`, native tool definitions, `tool_use` and grouped `tool_result` blocks. Other BYOK providers use their documented OpenAI-compatible Chat Completions endpoints. Provider response bodies and keys are never returned in errors.

After saving settings, use **Test model connection** (`POST /v1/agent/model/test`). The authenticated, rate-limited probe sends only a short synthetic message, no account data, no tools, and saves no chat history. It checks the saved key/model response; provider token charges may apply, and it does not certify every model's tool-calling capability. Mock provider integration tests validate request/response contracts; real credential/model compatibility must be checked with this button and an actual research prompt.

The `/rota-ai` guide is in the main menu after Rewards and before custom links such as AlgoBotApp. Example buttons open the local assistant and prefill a draft; they never send messages or execute actions automatically. The same examples are available in the chat's Tool shortcuts list. Portfolio & Telegram links target `/portfolio/notifications`.

API references: [Anthropic](https://platform.claude.com/docs/en/api/messages/create), [Gemini](https://ai.google.dev/gemini-api/docs/openai), [Groq](https://console.groq.com/docs/api-reference), [OpenRouter](https://openrouter.ai/docs/guides/features/tool-calling).

The English `/rota-ai` guide uses ROTA theme CSS variables (primary purple), with examples shared by the chat shortcuts. Free starter requests are routed by the backend across operator-owned Groq/Gemini keys; no operator key is sent to the frontend. When capacity is exhausted, the chat displays the backend's temporary-unavailability message.

TradingView hides its built-in header because ROTA already provides timeframe and indicator controls above the chart. The drawing toolbar is enabled, `hide_left_toolbar_by_default` is disabled, and there is no RSI-specific default override. `patches/@orderly.network+ui-tradingview+3.2.2.patch` makes explicit feature settings override SDK defaults. The vendored chart widget no longer inserts RSI on startup. A one-time browser migration removes the old auto-inserted RSI from existing layouts; manually adding RSI afterwards remains supported. Other studies are preserved.
