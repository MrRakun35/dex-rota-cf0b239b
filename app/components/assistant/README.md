# ROTA AI

Native ROTA component mounted inside `OrderlyProvider`. Uses ROTA theme tokens,
branding, account state, broker and network directly. No external plugin package,
extra React root or global credential registry. The chat mounts on first open and
survives navigation and close/reopen. Wallet, subaccount and network changes
discard the embedded session.

## Service and configuration

The upstream repository supplies an iframe client, not the AI backend. Research,
chat, login and agent execution still run at `https://iamstarchild.com`. Its embed
protocol requires `source=orderly-plugin` and `pluginVersion=1.4.0`; `hideLogo=1`
requests suppression of the service header brand. The live unauthenticated login
screen still displays the service branding. A custom service logo URL is omitted
because the service could not render the localhost logo in browser verification.
Cross-origin chat content cannot be restyled
by ROTA. Full ownership of that content requires a compatible ROTA AI service.

Runtime settings in `public/config.js` (build-time fallback in `.env`):

| Setting                              | Default                    | Purpose                                       |
| ------------------------------------ | -------------------------- | --------------------------------------------- |
| `VITE_ROTA_AI_ENABLED`               | `true`                     | Set `false` to remove the assistant           |
| `VITE_ROTA_AI_URL`                   | `https://iamstarchild.com` | HTTPS service with the same embed protocol    |
| `VITE_ROTA_AI_TRADING_AUTHORIZATION` | `true`                     | Set `false` for research without key transfer |

## Authorization

The chat trigger and ROTA connect button require explicit consent in the ROTA
panel. The service receives the existing SDK trading key, sealed using RSA-OAEP
SHA-256, and can decrypt and use it. The protocol's `trade-only` label does not
restrict an existing key's permissions; the UI describes that accurately. No new
wallet key or Orderly permission is created. Closing/reloading does not revoke a
key already received by the service. Revoke it through API key management.

Messages require the configured origin and exact iframe window. Public keys are
processed only after consent during a pending request. Reused nonces, duplicate,
unsolicited, mismatched and late responses are ignored. Timeout, close, reload
and unmount invalidate pending encryption. `sent` means the response was posted,
not that the backend confirmed authorization. The upstream protocol has no
confirmation message; users check the chat for that confirmation.

## Provenance and checks

Adapted from [starchild-orderly-plugin](https://github.com/Starchild-ai-agent/starchild-orderly-plugin),
commit `1d3df00ec539e81be0922241229c3cd45830b924`, version 1.4.0.
The upstream MIT notice is preserved in `LICENSE.starchild`.
The deployed public notice is `public/licenses/starchild-orderly-plugin.txt`.

`npm test -- app/components/assistant` verifies consent, origin/window validation,
account changes, cancellation, timeout, response correlation and real RSA sealing.
Live service login and trading authorization require a browser wallet and an
account on the remote service. Automated tests do not execute real trades.
