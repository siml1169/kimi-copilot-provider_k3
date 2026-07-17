import * as vscode from 'vscode';

/**
 * Shim for the proposed `vscode.LanguageModelThinkingPart` API.
 *
 * VS Code's Copilot Chat only renders the collapsible "Thinking" section when
 * a provider reports reasoning via `LanguageModelThinkingPart`. That class is
 * still a proposed API and therefore absent from the stable `@types/vscode`
 * typings, but the runtime constructor IS present in recent stable builds
 * (the bundled Copilot Chat extension uses it for BYOK providers).
 *
 * This shim constructs the real class when it exists at runtime and falls back
 * to a plain `LanguageModelTextPart` otherwise, so reasoning content is never
 * lost — it just renders inline on older VS Code versions.
 */

interface ThinkingPartCtor {
    new (value: string | string[], id?: string, metadata?: { readonly [key: string]: unknown }): unknown;
}

const ThinkingPartImpl: ThinkingPartCtor | undefined = (
    vscode as unknown as { LanguageModelThinkingPart?: ThinkingPartCtor }
).LanguageModelThinkingPart;

/** Whether the runtime supports the dedicated thinking part type. */
export const supportsThinkingPart = ThinkingPartImpl !== undefined;

/**
 * Create a response part carrying chain-of-thought text.
 *
 * Mirrors the approach used by other working providers (e.g. the DeepSeek V4
 * chat extension): emit the real `LanguageModelThinkingPart` via reflection
 * when the constructor exists, and fall back to a `LanguageModelTextPart`
 * otherwise so the content still appears inline on older VS Code builds.
 *
 * Construction is guarded: if the host rejects the proposed part at runtime,
 * we degrade to a text part rather than letting the stream fail.
 */
export function createThinkingPart(value: string): vscode.LanguageModelResponsePart {
    if (ThinkingPartImpl) {
        try {
            return new ThinkingPartImpl(value) as vscode.LanguageModelResponsePart;
        } catch {
            // Host rejected the proposed part — fall through to text.
        }
    }
    return new vscode.LanguageModelTextPart(value);
}
