# Native ROTA AI

`RotaAssistant.tsx` is ROTA's local chat, model settings, tools, action-confirmation and Tasks UI. It uses the existing Orderly provider account and `/v1/agent` on the configured ROTA backend. There is no iframe or dependency on Starchild's service.

Users start with the backend-configured free tier and may connect their account and save their own OpenRouter/OpenAI/Groq/Gemini provider/model. API keys are sent only through the encrypted backend settings flow and cleared from component memory on close/save; they are never persisted in the browser. Session tokens are isolated by wallet/account/network and expire in 24 hours. Account change unmounts and aborts pending work.

Account reads require a separate read-only Orderly authorization. Trading uses another explicit read/trading authorization. Model tool calls create pending proposals; an explicit click confirms one. Private results are local cards unless the user opts to share them with their selected model. Persistent reports and alerts require no model tokens.

`VITE_ROTA_AI_ENABLED=false` hides the assistant. `VITE_ROTA_AI_TRADING_AUTHORIZATION=false` disables the UI's trading authorization button. Backend policies remain authoritative. The previous `VITE_ROTA_AI_URL` is removed.

Deploy the companion backend at the same time. See `backend/docs/rota-ai.md` for operator starter configuration, optional ROTA-owned Ollama model, data retention, execution controls and current capability boundaries. A missing starter runtime displays unavailable; the UI does not simulate a model response.

Historical Starchild MIT notices remain under this directory/public licenses for prior integration provenance. Runtime imports do not use that plugin.
