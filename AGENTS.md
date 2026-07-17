# AGENTS.md — Kimi Copilot Provider

VS Code extension that registers **Kimi K2/K2.7 Code and K3** models as custom `LanguageModelChatProvider` for GitHub Copilot Chat. Proxies chat requests to the Kimi API via SSE streaming.

## Quick Reference

| Task | Command |
|---|---|
| Compile (once) | `npm run compile` |
| Compile (watch) | `npm run watch` |
| Lint | `npm run lint` |
| Fast unit tests (plain Node, no Extension Host) | `npm run test:unit` |
| Full tests (Extension Host) | `npm test` |
| Launch extension | `F5` (Extension Development Host) |
| Package .vsix | `npx @vscode/vsce package --no-dependencies` |

## Supported Models

| Picker ID | API Model | Context | Notes |
|---|---|---|---|
| `kimi-k2.7-code` | `kimi-k2.7-code` | 256K / 32K | Default coding model, thinking required |
| `kimi-k2.7-code-highspeed` | `kimi-k2.7-code-highspeed` | 256K / 32K | Faster output (~180 T/s) |
| `kimi-k2.6` | `kimi-k2.6` | 256K / 32K | Multimodal + thinking |
| `kimi-k2.5` | `kimi-k2.5` | 256K / 32K | Multimodal + thinking |
| `kimi-k3` | `kimi-k3` | 1M / 32K | Frontier MoE, always-on reasoning, multimodal — set endpoint to `https://api.moonshot.ai/v1/chat/completions` |

## Architecture

```
src/
├── config.ts      # ConfigurationManager: settings + SecretStorage API key
├── extension.ts   # activate(): registers provider and commands
├── models.ts      # Model registry + LanguageModelChatInformation mapping
├── provider.ts    # KimiChatProvider implements LanguageModelChatProvider
└── types.ts       # Shared API and model types
```

Provider implements 3 mandatory methods of `LanguageModelChatProvider<T>`:
1. **`provideLanguageModelChatInformation`** — returns `LanguageModelChatInformation[]` (model metadata)
2. **`provideLanguageModelChatResponse`** — streams response via `Progress<LanguageModelResponsePart>` callback
3. **`provideTokenCount`** — estimates token count

Kimi API: `POST https://api.moonshot.ai/v1/chat/completions`, auth via `Bearer sk-...`, SSE `data:` streaming.
Response format: OpenAI-compatible `{"choices":[{"delta":{"content":"..."}}]}` with `data: [DONE]` terminator.

Source layout (post-refactor):

```
src/
├── config.ts      # ConfigurationManager: settings + SecretStorage API keys
├── extension.ts   # activate(): registers provider and commands
├── models.ts      # Model registry + LanguageModelChatInformation mapping
├── provider.ts    # KimiChatProvider + message/tool/request conversion (vscode-bound)
├── usageMath.ts   # Pure pricing/cost/format math (no vscode — plain-Node testable)
├── usage.ts       # UsageTracker (status bar, daily aggregation) — re-exports usageMath
├── tokenize.ts    # Pure CJK-aware token estimator (no vscode)
├── retry.ts       # Pure retry/backoff helpers (no vscode)
├── warnings.ts    # Pure context-fill + cache-miss threshold logic (no vscode)
├── thinking.ts    # LanguageModelThinkingPart shim (runtime reflection)
└── types.ts       # Shared API and model types
```

Pure modules (`usageMath`, `tokenize`, `retry`, `warnings`) deliberately avoid importing
`vscode` so they can be unit-tested in plain Node without the Extension Host.

## Guardrail Warnings (1.5.3)

Two non-blocking, per-session-de-duplicated warnings (settings under `kimi3Copilot.*`):

- **Context fill** — `contextFillWarning(promptTokens, maxInputTokens, threshold)` fires when the
  actual prompt tokens reach `contextWarnThreshold` (default `0.8`) of the input budget. Kimi
  publishes no official degradation point; 80% is the chosen default. Note: **Copilot Chat trims
  history to `maxInputTokens` itself** — there is no server-side context compression for BYOK.
- **Cache miss** — `cacheMissWarning(totalPromptTokens, totalCachedTokens, threshold)` fires when
  the daily miss rate exceeds `cacheMissWarnThreshold` (default `0.8`), after a 10K-token warm-up.

Both warn once per threshold-bucket via `showWarningOnce` in `provider.ts` and log to the output
channel. Toggle with `warnOnContextFill` / `warnOnCacheMiss`.

## Per-Model Configuration

Use `kimi3Copilot.modelConfigs` to override settings per picker model. Example:

```json
{
  "kimi3Copilot.modelConfigs": {
    "kimi-k2.7-code": {
      "maxInputTokens": 256000,
      "maxOutputTokens": 32768,
      "temperature": 1.0,
      "topP": 0.95,
      "presencePenalty": 0.0,
      "frequencyPenalty": 0.0,
      "thinking": { "type": "enabled" }
    }
  }
}
```

Precedence: per-model config > global setting > hard-coded model default.

## K2.7 API Constraints

- `temperature` is fixed at `1.0` by the API; any other value errors.
- `top_p` is fixed at `0.95` by the API; any other value errors.
- `presence_penalty` and `frequency_penalty` are fixed at `0.0`.
- `thinking` defaults to `{ "type": "enabled" }` and cannot be disabled for K2.7 Code.
- `tool_choice` only supports `"auto"` or `"none"`.

## Conventions

- **`languageModelChatProviders` contribution required** — declare in `package.json` → `contributes.languageModelChatProviders` with `vendor` + `displayName`. Without this, the provider won't be recognized.
- **Vendor must match everywhere**: `package.json` contribution `.vendor` === 1st arg to `registerLanguageModelChatProvider()` === `"kimi3-copilot"`.
- **Settings prefix**: All user-facing settings use the `kimi3Copilot.*` namespace.
- **VS Code API version**: Targets `^1.93.0` engines.

## Key Gotchas

1. **Model won't appear in chat until user enables it**: Chat → model picker → "Manage Models" → find provider → ✅ check models.
2. **`provideLanguageModelChatInformation` always returns models** — even without an API key it returns the list with a warning `statusIcon`, so `options.silent` never triggers a credential prompt.
3. **Debug logs**: Output panel → "Kimi3 Copilot" channel (created via `createOutputChannel(..., { log: true })`).
4. **Token counting** is a heuristic (`estimateTokens` in `tokenize.ts`): CJK chars × 1.5, Latin ÷ 4, biased slightly high so Copilot truncates before the API limit. Kimi doesn't expose a tokenizer.
5. **`onDidChangeLanguageModelChatInformation`**: Fire this event when models change (e.g., API key added/removed) so VS Code re-queries.
6. **K3/K2.7 thinking history**: `convertMessages` captures `reasoning_content` from prior assistant turns and echoes it back — required for K3 reasoning continuity.
7. **K3** uses `reasoning_effort: 'max'` (not `thinking`) and fixed `top_p: 0.95`; K2.7 forces `top_p: 0.95` and `thinking: { type: 'enabled', keep: 'all' }`.

## Official References

- [Language Model Chat Provider API Guide](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
- [Chat Model Provider Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-model-provider-sample)
- [Language Model API Guide](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [VS Code lm API Reference](https://code.visualstudio.com/api/references/vscode-api#lm)
- [Kimi K2.7 Code Quickstart](https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart)
- [Kimi Models](https://platform.kimi.ai/docs/models)
