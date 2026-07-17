/**
 * Classify an incoming Copilot Chat request by its system-prompt prefix so we
 * can tell a real conversation turn from the many small AUXILIARY requests
 * Copilot routes through the selected model — chat-title generation, progress
 * messages, todo tracking, prompt categorization, git branch/commit messages,
 * rename suggestions, etc.
 *
 * Why this matters: we report token usage to Copilot's NATIVE context-window
 * indicator via a `usage` data part (see provider.ts). Copilot fires those
 * auxiliary requests through the model too — notably a `chat-title` request
 * right after the FIRST turn — and each carries only a few hundred tokens.
 * If we reported their usage, they'd clobber the indicator, resetting the
 * displayed context to ~0% even though the real conversation is large. So
 * we only report usage for the kinds that represent the real conversation
 * (`main-agent` and the `background` catch-all, which covers ordinary ask-mode
 * turns).
 *
 * Pure (vscode-free) so it is unit-testable.
 */
/** Request classification. */
export type RequestKind = 'main-agent' | 'background' | 'chat-title' | 'todo-tracker' | 'prompt-categorizer' | 'settings-resolver' | 'inline-progress-message' | 'git-branch-name' | 'git-commit-message' | 'rename-suggestions' | 'terminal-steering' | 'unknown';
/**
 * Classify a request from its first message text (the system prompt), the
 * latest user message text, and the advertised tool names.
 */
export declare function classifyRequestKind(firstText: string, latestUserText: string, toolNames: readonly string[]): RequestKind;
/**
 * Whether a request's token usage should drive the native context-window
 * indicator. Only real conversation turns qualify: `main-agent` (agent-mode
 * turns) and `background` (the catch-all that covers ordinary ask-mode chat).
 * Every recognised auxiliary kind — and the empty `unknown` — is excluded.
 */
export declare function isReportableContextRequest(kind: RequestKind): boolean;
