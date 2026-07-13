# Kimi Copilot Provider

VS Code extension that registers **Kimi K2/K2.7 Code** models as a custom language model provider for GitHub Copilot Chat. Proxies chat requests to the Kimi API via SSE streaming.

## Supported Models

| Picker ID | API Model | Context | Notes |
|---|---|---|---|
| `kimi-k2.7-code` | `kimi-k2.7-code` | 256K / 32K | Default coding model, thinking required |
| `kimi-k2.7-code-highspeed` | `kimi-k2.7-code-highspeed` | 256K / 32K | Faster output (~180 T/s) |
| `kimi-k2.6` | `kimi-k2.6` | 256K / 32K | Multimodal + thinking |
| `kimi-k2.5` | `kimi-k2.5` | 256K / 32K | Multimodal + thinking |

## How It Works

The extension implements the `vscode.lm.LanguageModelChatProvider` API (stabilized in VS Code 1.93+) and forwards chat requests to the Kimi API:

```
POST https://api.kimi.com/coding/v1/chat/completions
```

Kimi's API is OpenAI-compatible and supports SSE streaming.

## Setup

### 1. Install dependencies and compile

```bash
npm install
npm run compile
```

### 2. Configure API Key

Run **Kimi Copilot: Set API Key** from the Command Palette (`Ctrl+Shift+P`) and paste your Kimi API key.

Or open VS Code Settings (`Ctrl+,`) and search for `kimiCopilot`:

| Setting | Default | Description |
|---|---|---|
| `kimiCopilot.model` | `kimi-k2.7-code` | Default Kimi model ID used in chat |
| `kimiCopilot.endpoint` | `https://api.kimi.com/coding/v1/chat/completions` | API endpoint |
| `kimiCopilot.baseUrl` | `https://api.kimi.com` | Base URL for the Kimi API |
| `kimiCopilot.temperature` | `1.0` | Sampling temperature (fixed at 1.0 by Kimi K2.7 API) |
| `kimiCopilot.maxTokens` | `0` | Max output tokens (`0` = model default) |
| `kimiCopilot.topP` | `0.95` | Fixed to 0.95 by Kimi K2.7 API |
| `kimiCopilot.systemPrompt` | (see `config.ts`) | System prompt sent with every request |
| `kimiCopilot.modelConfigs` | `{}` | Per-model overrides for parameters |

### 3. Press F5 to Launch

Press `F5` in VS Code to start the Extension Development Host. The Kimi provider will be available to Copilot Chat.

## Architecture

```
src/
├── config.ts      # ConfigurationManager: settings + SecretStorage API key
├── extension.ts   # activate(): registers provider and commands
├── models.ts      # Model registry + LanguageModelChatInformation mapping
├── provider.ts    # KimiChatProvider implements LanguageModelChatProvider
├── types.ts       # Shared API and model types
└── test/          # Unit tests
```

Provider implements the 3 mandatory methods of `LanguageModelChatProvider`:
1. **`provideLanguageModelChatInformation`** — returns model metadata
2. **`provideLanguageModelChatResponse`** — streams response via `Progress<LanguageModelResponsePart>`
3. **`provideTokenCount`** — estimates token count

## Enabling the Model

1. Open Chat in VS Code
2. Click the model picker → **Manage Models**
3. Find **Kimi Copilot Provider** → ✅ check the desired model

## Management Commands

- **Kimi Copilot: Set API Key** — store API key securely in SecretStorage
- **Kimi Copilot: Select Default Model** — choose the default model
- **Kimi Copilot: Edit Model Configuration** — per-model JSON overrides
- **Kimi Copilot: Test Connection** — verify connectivity and credentials
- **Kimi Copilot: Open Settings** — open settings directly

## Development

| Task | Command |
|---|---|
| Compile (once) | `npm run compile` |
| Compile (watch) | `npm run watch` |
| Launch extension | `F5` (Extension Development Host) |
| Package .vsix | `npx @vscode/vsce package --no-dependencies` |
| Run tests | `npm test` |
| Format code | `npm run format` |

## Requirements

- VS Code **1.93.0** or higher
- Node.js 18+
- Active Kimi API key

## Official References

- [Language Model Chat Provider API Guide](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
- [Chat Model Provider Sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-model-provider-sample)
- [Language Model API Guide](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [VS Code lm API Reference](https://code.visualstudio.com/api/references/vscode-api#lm)
- [Kimi K2.7 Code Quickstart](https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart)
- [Kimi Models](https://platform.kimi.ai/docs/models)

## License

MIT
