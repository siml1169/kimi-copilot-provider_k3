# Kimi Copilot Provider (K3 Fork)

> **Fork** of [DimQ1/kimi-copilot-provider](https://github.com/DimQ1/kimi-copilot-provider) adding **Kimi K3** support, Moonshot API endpoints, usage/cost tracking, and balance display.

VS Code extension that registers **Kimi K2, K2.7, and K3** models as a custom language model provider for GitHub Copilot Chat. Proxies chat requests to the Moonshot API via SSE streaming with real-time cost and cache hit tracking.

## Supported Models

| Picker ID | Context | Notes | Input / Output / Cached |
|---|---|---|---|
| `kimi-k2.7-code` | 256K / 32K | Coding model, thinking always on | $0.50 / $1.00 / $0.25 per 1M |
| `kimi-k2.7-code-highspeed` | 256K / 32K | ~180 T/s output variant | $0.50 / $1.00 / $0.25 per 1M |
| `kimi-k2.6` | 256K / 32K | Multimodal + thinking | $0.50 / $1.00 / $0.25 per 1M |
| `kimi-k2.5` | 256K / 32K | Multimodal + thinking | $0.50 / $1.00 / $0.25 per 1M |
| `kimi-k3` | 1M / 32K | Frontier MoE, always-on reasoning, multimodal — may need separate K3 API key | $3.00 / $15.00 / $0.30 per 1M |

> K3 pricing from [platform.kimi.ai/docs/pricing/chat-k3](https://platform.kimi.ai/docs/pricing/chat-k3).

## How It Works

The extension implements the `vscode.lm.LanguageModelChatProvider` API (VS Code 1.93+) and forwards chat requests to the Moonshot API:

```
POST https://api.moonshot.ai/v1/chat/completions
```

- All models share the same endpoint; no manual endpoint switching needed
- Streaming uses `stream_options: {include_usage: true}` to capture token usage from every response
- After each call the extension fetches `GET /v1/users/me/balance` and shows it in the status bar

## Setup

### 1. Build from source

```bash
npm install
npm run compile
# or press F5 to launch the Extension Development Host
```

### 2. Install the pre-built .vsix

```
Ctrl+Shift+P → Extensions: Install from VSIX... → kimi-copilot-provider-*.vsix
```

### 3. Set your API key

```
Ctrl+Shift+P → Kimi Copilot: Set API Key
```

For **Kimi K3**, get a key from [platform.kimi.ai/console/api-keys](https://platform.kimi.ai/console/api-keys). If your account doesn't have K3 access yet, set a separate K3 key:

```
Ctrl+Shift+P → Kimi Copilot: Set K3 API Key
```

When a K3 key is set it takes priority for K3 requests and falls back to the main key when absent.

### 4. Enable the model in Chat

1. Open Chat in VS Code
2. Click the model picker → **Manage Models**
3. Find **Kimi Copilot Provider (K3 Fork)** → ✅ check the desired model

## Settings

| Setting | Default | Description |
|---|---|---|
| `kimiCopilot.model` | `kimi-k2.7-code` | Default model used in chat |
| `kimiCopilot.endpoint` | `https://api.moonshot.ai/v1/chat/completions` | Chat completions endpoint |
| `kimiCopilot.k3Endpoint` | _(empty)_ | Override endpoint for K3 only; leave empty to use main endpoint |
| `kimiCopilot.baseUrl` | `https://api.moonshot.ai` | Base URL (used for balance fetch) |
| `kimiCopilot.temperature` | `1.0` | Sampling temperature (model-dependent; fixed at 1.0 for K2.7/K3) |
| `kimiCopilot.maxTokens` | `0` | Max completion tokens (`0` = model default) |
| `kimiCopilot.topP` | `0.95` | Top-p sampling (fixed at 0.95 for K2.7/K3) |
| `kimiCopilot.systemPrompt` | (see `config.ts`) | System prompt prepended to every request |
| `kimiCopilot.timeout` | `60000` | Request timeout in ms |
| `kimiCopilot.enableStreaming` | `true` | Enable SSE streaming |
| `kimiCopilot.modelConfigs` | `{}` | Per-model JSON overrides (temperature, topP, maxOutputTokens, systemPrompt, toolCalling, etc.) |
| `kimiCopilot.modelIdOverrides` | `{}` | Remap picker model IDs to custom API model IDs |

## Cost & Usage Tracking

After every API call the status bar shows your **live account balance** (fetched from `GET /v1/users/me/balance`):

```
⚡ Kimi: $49.58
```

Hover for a tooltip with today's aggregated stats:

| Metric | Source |
|---|---|
| Balance | Real-time API call |
| Requests | Counted per response |
| Input / Output tokens | From `usage.prompt_tokens` / `usage.completion_tokens` |
| Cached tokens | From `usage.cached_tokens` (cache hit → $0.30/1M vs $3.00/1M for K3) |
| Cache hit rate | `cached_tokens / prompt_tokens × 100%` |
| Estimated cost | Per-model pricing table, cached vs uncached input |

Stats reset at midnight and persist across VS Code restarts via `workspaceState`.

## Commands

| Command | Description |
|---|---|
| **Kimi Copilot: Set API Key** | Store main API key in SecretStorage |
| **Kimi Copilot: Set K3 API Key** | Store separate K3 API key (optional) |
| **Kimi Copilot: Select Default Model** | Pick the default model |
| **Kimi Copilot: Edit Model Configuration** | Per-model JSON overrides |
| **Kimi Copilot: Test Connection** | Verify endpoint + key with a live request; shows model, endpoint, and key source |
| **Kimi Copilot: Show Usage Stats** | Open today's usage report as a Markdown document |
| **Kimi Copilot: Reset Usage Stats** | Reset today's counters |
| **Kimi Copilot: Open Settings** | Open `kimiCopilot` settings |

## Architecture

```
src/
├── config.ts      # ConfigurationManager: settings, SecretStorage keys (main + K3)
├── extension.ts   # activate(): provider, usage tracker, command registration
├── models.ts      # Model registry with per-model capabilities and defaults
├── provider.ts    # KimiChatProvider: request building, retry, usage capture
├── types.ts       # Shared API types (KimiRequest, KimiMessage, KimiUsage, …)
├── usage.ts       # UsageTracker: cost calculation, status bar, daily aggregation
└── test/          # Unit tests
```

Provider implements the 3 mandatory methods of `LanguageModelChatProvider`:
1. **`provideLanguageModelChatInformation`** — returns model metadata
2. **`provideLanguageModelChatResponse`** — streams response via `Progress<LanguageModelResponsePart>`
3. **`provideTokenCount`** — estimates token count

## API Compliance Notes

| Feature | Behaviour |
|---|---|
| K2.7 `thinking` | Always `{type: "enabled", keep: "all"}` — cannot be disabled |
| K2.6 `thinking` | `{type: "enabled"}` by default; can be disabled |
| K3 reasoning | `reasoning_effort: "max"` (replaces `thinking`) |
| `temperature` / `top_p` | Fixed by API for all K2.x/K3 models; not sent explicitly |
| `presence_penalty` / `frequency_penalty` | Fixed at 0 for K2.x/K3; not sent explicitly |
| `max_completion_tokens` | Used (not deprecated `max_tokens`) |
| `stream_options` | `{include_usage: true}` always set when streaming |
| `tool_choice` | `auto`/`none`/`required` or `{type:"function",function:{name:"…"}}` — `required` is K3-only |

## Development

| Task | Command |
|---|---|
| Compile (once) | `npm run compile` |
| Compile (watch) | `npm run watch` |
| Launch extension | `F5` (Extension Development Host) |
| Package .vsix | `npx @vscode/vsce package --no-dependencies` |
| Run tests | `npm test` |
| Lint | `npm run lint` |
| Format | `npm run format` |

## Requirements

- VS Code **1.93.0** or higher
- Node.js 18+
- Active Moonshot API key from [platform.kimi.ai/console/api-keys](https://platform.kimi.ai/console/api-keys)

## Official References

- [Moonshot API Overview](https://platform.kimi.ai/docs/api/overview)
- [Chat Completions API](https://platform.kimi.ai/docs/api/chat)
- [K3 Pricing](https://platform.kimi.ai/docs/pricing/chat-k3)
- [K3 Tool Calling Best Practices](https://platform.kimi.ai/docs/guide/kimi-k3-tool-calling-best-practice)
- [Model Parameter Reference](https://platform.kimi.ai/docs/api/models-overview)
- [Check Balance API](https://platform.kimi.ai/docs/api/balance)
- [Kimi K2.7 Code Quickstart](https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart)
- [VS Code Language Model Chat Provider](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)

## License

MIT
