# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-07-17 (K3 Fork)

### Added
- **Chain-of-thought display** — `reasoning_content` from K2.7, K2.6, K2.5, and K3 now streams inline before the final answer in Copilot Chat (both streaming and non-streaming).
- **K3-specific system prompt** — default constraining prompt that channels K3's architectural reasoning with transparency (explain before structural changes, present trade-offs, surface unexpected issues). Overridable via `kimi3Copilot.systemPrompt` or `modelConfigs`.
- **Mid-session K3 switch warning** — tracks the last-used model and warns when switching to K3 mid-session, since K3 requires full thinking history for stable multi-turn conversations.

### Changed
- K3 system prompt replaced restrictive "don't do anything unprompted" with collaborative "explain before structural changes" approach.
- README updated to reflect reasoning display, K3 prompt behavior, and model switch warning.

## [1.4.3] - 2026-07-17 (K3 Fork)

### Added
- **Kimi K3 model support** with `reasoning_effort: "max"` (replaces `thinking` for K3).
- **Separate K3 API key** — `Kimi3 Copilot: Set K3 API Key` command and `SecretStorage` entry; falls back to main key when absent.
- **Separate K3 endpoint** — `kimi3Copilot.k3Endpoint` setting for independent K3 endpoint override.
- **Usage & cost tracking** — new `src/usage.ts` module captures `usage.prompt_tokens`, `usage.completion_tokens`, `usage.cached_tokens` from every API response.
- **Status bar balance display** — fetches `GET /v1/users/me/balance` after each request and shows live account balance; falls back to estimated cost before first fetch.
- **Daily usage aggregation** — persists today's tokens, cost, cache hit rate in `workspaceState`; resets at midnight.
- **`Kimi3 Copilot: Show Usage Stats`** command — opens today's stats as a Markdown report.
- **`Kimi3 Copilot: Reset Usage Stats`** command.
- **`stream_options: {include_usage: true}`** added to all streaming requests so usage is captured from real chat traffic (not just test connection).
- **K3 dynamic tool message type** (`KimiK3DynamicToolMessage`) added to `types.ts`.
- **`stop`, `prompt_cache_key`, `safety_identifier`, `stream_options`** fields added to `KimiRequest`.
- **`json_schema` structured output** support added to `response_format`.
- `name` and `partial` fields added to `KimiMessage` (Partial Mode support).
- Test Connection command now shows a progress notification with model, endpoint, and key source; failure offers **Show Details** and **Open Settings** buttons.

### Changed
- **Extension renamed** to `kimi3-copilot-provider` / **Kimi3 Copilot Provider** for marketplace publication.
- **All command IDs** renamed from `kimi-copilot.*` to `kimi3-copilot.*`.
- **All settings** renamed from `kimiCopilot.*` to `kimi3Copilot.*`.
- **All SecretStorage keys** renamed from `kimiCopilot.*` to `kimi3Copilot.*`.
- **Provider vendor** renamed from `kimi-copilot` to `kimi3-copilot`.
- **All endpoints migrated** from `api.kimi.com` to `api.moonshot.ai` (official Moonshot platform).
- **`max_tokens` → `max_completion_tokens`** — updated to use the non-deprecated field name.
- **K2.7 `thinking` default** corrected to `{type: "enabled", keep: "all"}` (Preserved Thinking always on).
- **K3 `top_p`** corrected to `0.95` (fixed per API docs).
- **K3 pricing** set to official rates: input (cache miss) $3.00/1M, output $15.00/1M, input (cache hit) $0.30/1M.
- `tool_choice` type widened to include object form `{type: "function", function: {name: "…"}}` (K3-only: `required` also supported).
- `kimiCopilot.apiKey` deprecated plain-text fallback removed; SecretStorage is now the only key store.
- HTTP-level 429/5xx retry now handled at fetch level (not just on thrown exceptions); respects `Retry-After` header.
- Icon updated to indigo/violet gradient with K3 badge.
- README fully rewritten to reflect new name, features, commands, settings, pricing, and API compliance notes.

### Fixed
- **`cached_tokens` field name** corrected from `prompt_cache_hit_tokens` to `cached_tokens` (actual API response field).
- Usage tracking now works during streaming (required `stream_options.include_usage: true`).

## [1.3.0] - 2026-07-10

### Added
- Added support for `kimi-k2.7-code-highspeed` model.
- Added `toolCalling` capability flag per model.

### Changed
- Refactored configuration into `ConfigurationManager`.

## [1.3.0] - 2026-07-10

### Added
- Added support for `kimi-k2.7-code-highspeed` model.
- Added `toolCalling` capability flag per model.

### Changed
- Refactored configuration into `ConfigurationManager`.

## [1.2.0] - 2026-07-09

### Added
- Introduced `kimiCopilot.modelConfigs` per-model overrides.

## [1.1.0] - 2026-07-08

### Changed
- Migrated API key storage from plain-text settings to SecretStorage.

## [1.0.0] - 2026-07-07

### Added
- Initial release with `kimi-k2.7-code` support.
- SSE streaming response support.
- Basic model picker integration for GitHub Copilot Chat.
