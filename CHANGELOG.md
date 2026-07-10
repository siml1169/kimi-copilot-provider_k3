# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added ESLint configuration using `typescript-eslint`.
- Added GitHub Actions CI workflow for build and lint checks.
- Added per-model `modelConfigs` overrides (temperature, topP, max tokens, system prompt, tool calling, etc.).
- Added `kimiCopilot.modelIdOverrides` setting to remap picker model IDs to custom API model IDs.
- Added secure API key storage via VS Code SecretStorage with plain-text fallback for migration.
- Added `Kimi Copilot: Test Connection` command.
- Added `Kimi Copilot: Edit Model Configuration` command.

### Changed
- Updated model registry to Kimi K2.x series: `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.6`, `kimi-k2.5`.
- README updated to reflect the current model lineup and settings.
- Improved SSE streaming and non-streaming response handling.
- Improved error mapping for Kimi API HTTP status codes and network failures.

### Deprecated
- `kimiCopilot.apiKey` plain-text setting is deprecated; use the `Kimi Copilot: Set API Key` command instead.

### Fixed
- Tool calling conversion now correctly accumulates streamed tool call deltas.
- System prompt is only prepended when the request does not already contain one.

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
