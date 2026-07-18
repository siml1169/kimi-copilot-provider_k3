import * as vscode from 'vscode';
import { ConfigurationManager } from './config';
import { MODELS, toChatInfo, getModelCapabilities, getMaxOutputTokens, getModelDefaults } from './models';
import { UsageTracker, type UsageRecord, formatUsageSummary } from './usage';
import { createThinkingPart, isThinkingPartLike, getThinkingPartValue } from './thinking';
import { jitteredBackoff, isRetryableNetworkError, isRetryableStatus, sleep } from './retry';
import { estimateTokens } from './tokenize';
import { contextFillWarning, cacheMissWarning, type ThresholdWarning } from './warnings';
import { classifyRequestKind, isReportableContextRequest } from './requestKind';
import { SessionContextTracker } from './context-tracker';
import type { KimiMessage, KimiTool, KimiToolCall, KimiRequest, KimiStreamChunk, KimiContentPart, ModelConfigOverride } from './types';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';

// ═══════════════════════════════════════════════════════════════════════
// Provider class — implements the non-generic LanguageModelChatProvider
// ═══════════════════════════════════════════════════════════════════════

export class KimiChatProvider implements vscode.LanguageModelChatProvider {

    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

    readonly outputChannel: vscode.LogOutputChannel;
    private readonly disposables: vscode.Disposable[] = [];
    private usageTracker: UsageTracker | undefined;
    private lastModelId: string | undefined;

    constructor(private readonly configManager: ConfigurationManager) {
        this.outputChannel = vscode.window.createOutputChannel('Kimi3 Copilot', { log: true });

        // Watch for API key / config changes and refresh the model picker.
        this.disposables.push(
            configManager.onDidChange(() => {
                this.outputChannel.info('Configuration changed, refreshing model picker');
                this._onDidChange.fire();
            }),
        );
    }

    /** Track the current model for K3 switch detection. */
    private trackModelSwitch(modelId: string): void {
        const wasK3 = this.lastModelId?.startsWith('kimi-k3');
        const isK3 = modelId.startsWith('kimi-k3');

        if (isK3 && this.lastModelId !== undefined && !wasK3) {
            this.outputChannel.warn(
                '⚠️ Switched to K3 mid-session. K3 requires full thinking history; ' +
                'quality may be unstable without prior reasoning_content. ' +
                'Consider starting a fresh chat for best results.',
            );
            vscode.window.showWarningMessage(
                '⚠️ Switched to K3 mid-session. K3 requires full thinking history — ' +
                'quality may be unstable. Consider starting a fresh chat.',
                'Dismiss',
            );
        }

        this.lastModelId = modelId;
    }

    /** Attach the usage tracker (called from extension.ts). */
    setUsageTracker(tracker: UsageTracker): void {
        this.usageTracker = tracker;
    }

    /** Force Copilot Chat to re-query model information. */
    refreshModelPicker(): void {
        this._onDidChange.fire();
    }

    // ── Model information ──────────────────────────────────────────

    async provideLanguageModelChatInformation(
        options: vscode.PrepareLanguageModelChatModelOptions,
        _token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelChatInformation[]> {
        // Always return models — the `silent` flag means "don't prompt for credentials",
        // not "don't report models". The official sample ignores it entirely.
        const hasApiKey = !!(await this.configManager.getApiKey());
        // Per-model configuration (e.g. the Context Size tier picked in the model
        // picker). Not in the stable typings — read defensively.
        const configuration = (options as { configuration?: Record<string, unknown> }).configuration;
        return MODELS.map((model) =>
            toChatInfo(model, hasApiKey, this.configManager.getModelConfig(model.id), configuration),
        );
    }

    // ── Chat response ──────────────────────────────────────────────

    async provideLanguageModelChatResponse(
        modelInfo: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken,
    ): Promise<void> {
        this.trackModelSwitch(modelInfo.id);
        await this.doChatRequest(modelInfo, messages, options, progress, token);
    }

    /**
     * Sends a lightweight completion request to verify connectivity and credentials.
     * This is exposed for the "Test Connection" command.
     */
    async testConnection(modelId?: string, token?: vscode.CancellationToken): Promise<void> {
        const targetModel = modelId ?? this.configManager.getModel();
        const modelInfo = MODELS.find((m) => m.id === targetModel);
        if (!modelInfo) {
            throw new vscode.LanguageModelError(`Unknown model: ${targetModel}`);
        }

        const fakeProgress: vscode.Progress<vscode.LanguageModelResponsePart> = {
            report: () => { /* no-op */ },
        };

        const cts = new vscode.CancellationTokenSource();
        try {
            await this.doChatRequest(
                toChatInfo(modelInfo, true, this.configManager.getModelConfig(modelInfo.id)),
                [vscode.LanguageModelChatMessage.User('ping')],
                { toolMode: vscode.LanguageModelChatToolMode.Auto },
                fakeProgress,
                token ?? cts.token,
                { testMode: true },
            );
        } finally {
            cts.dispose();
        }
    }

    private async doChatRequest(
        modelInfo: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken,
        extras?: { testMode?: boolean },
    ): Promise<void> {
        const apiKey = await this.configManager.getEffectiveApiKey(modelInfo.id);
        if (!apiKey) {
            const isK3 = modelInfo.id.startsWith('kimi-k3');
            throw new vscode.LanguageModelError(
                isK3
                    ? 'K3 API key is not configured. Run "Kimi Copilot: Set K3 API Key" or "Kimi Copilot: Set API Key".'
                    : 'Kimi API key is not configured. Run "Kimi Copilot: Set API Key".',
            );
        }

        const isK3 = modelInfo.id.startsWith('kimi-k3');
        const endpoint = isK3
            ? this.configManager.getK3Endpoint()
            : this.configManager.getEndpoint() || DEFAULT_ENDPOINT;
        const enableStreaming = extras?.testMode ? false : this.configManager.getEnableStreaming();
        const timeout = this.configManager.getTimeout();

        const { request, tools } = buildKimiRequest({
            modelInfo,
            messages,
            options,
            configManager: this.configManager,
            enableStreaming,
            testMode: extras?.testMode,
        });

        // ── Context guard ──────────────────────────────────────────
        // Estimate the session token count before sending and block if
        // we're about to overflow the context window.
        if (!extras?.testMode) {
            const ctxTracker = new SessionContextTracker({
                maxInputTokens: modelInfo.maxInputTokens,
                warningThreshold: this.configManager.getContextWarnThreshold(),
                errorThreshold: this.configManager.getContextErrorThreshold(),
            });
            const ctxEstimate = ctxTracker.estimate(request.messages);
            this.outputChannel.info(
                `Context estimate: ~${ctxEstimate.tokens.toLocaleString('en-US')} / ${ctxEstimate.limit.toLocaleString('en-US')} tokens (${Math.round(ctxEstimate.ratio * 100)}% — ${ctxEstimate.status})`,
            );
            this.usageTracker?.setContextStats(ctxEstimate);

            if (ctxEstimate.status === 'exceeded' || ctxEstimate.status === 'critical') {
                const guidance =
                    ctxEstimate.status === 'exceeded'
                        ? 'Start a new chat session, run "/compact", or remove files from the context.'
                        : 'The context is almost full. Consider starting a new chat session or running "/compact" soon.';
                throw new vscode.LanguageModelError(
                    `Kimi context ${ctxEstimate.status}: ~${ctxEstimate.tokens.toLocaleString('en-US')} / ${ctxEstimate.limit.toLocaleString('en-US')} tokens (${Math.round(ctxEstimate.ratio * 100)}%).\n\n${guidance}`,
                );
            }
        }

        this.outputChannel.info(
            `→ ${request.messages.length} messages + ${tools?.length ?? 0} tools → ${endpoint} (model: ${request.model})`,
        );

        const startTime = Date.now();
        try {
            const response = await this.fetchWithRetry(
                endpoint,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`,
                        Accept: enableStreaming ? 'text/event-stream' : 'application/json',
                    },
                    body: JSON.stringify(request),
                },
                timeout,
                token,
            );

            if (!response.ok) {
                const errText = await response.text().catch(() => 'unknown');
                const retryAfter = response.headers.get('Retry-After');
                throw this.toLanguageModelError(response.status, errText, endpoint, retryAfter);
            }

            // Effective context budget for the fill warning: honor a user-selected
            // Context Size tier from the model picker (defensive read — the field is
            // not in the stable typings yet).
            const modelConfiguration = (options as { modelConfiguration?: Record<string, unknown> })
                .modelConfiguration;
            const pickedContextSize = modelConfiguration?.['contextSize'];
            const contextBudget =
                typeof pickedContextSize === 'number' && pickedContextSize > 0
                    ? Math.min(modelInfo.maxInputTokens, Math.floor(pickedContextSize))
                    : modelInfo.maxInputTokens;

            if (enableStreaming) {
                const usage = await streamSSEResponse(response, progress, token, this.outputChannel);
                this.recordUsage(usage, request.model, contextBudget);
                if (usage && usage.prompt_tokens > 0 && !extras?.testMode) {
                    tryReportNativeUsage(progress, messages, options, usage, this.outputChannel);
                }
            } else {
                const usage = await completeResponse(response, progress, this.outputChannel);
                this.recordUsage(usage, request.model, contextBudget);
                if (usage && usage.prompt_tokens > 0 && !extras?.testMode) {
                    tryReportNativeUsage(progress, messages, options, usage, this.outputChannel);
                }
            }

            this.outputChannel.info(`← completed in ${Date.now() - startTime}ms`);
        } catch (err) {
            this.outputChannel.error('Request failed', err);
            if (err instanceof vscode.LanguageModelError) {
                throw err;
            }
            const message = err instanceof Error ? err.message : String(err);
            // Improve network-related diagnostics
            if (message.includes('fetch failed') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
                throw new vscode.LanguageModelError(
                    `Unable to reach Kimi API at ${endpoint}. Check your network connection and endpoint configuration.`,
                    { cause: err },
                );
            }
            if (message.includes('aborted') || message.includes('AbortError')) {
                throw new vscode.LanguageModelError(
                    'Kimi API request was cancelled or timed out.',
                    { cause: err },
                );
            }
            throw new vscode.LanguageModelError(message, { cause: err });
        }
    }

    // ── Usage tracking ──────────────────────────────────────────────

    /** Record token usage from a completed request and log the summary. */
    private recordUsage(
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number } | undefined,
        modelId: string,
        maxInputTokens?: number,
    ): void {
        if (!usage || usage.prompt_tokens === 0) return;

        const record: UsageRecord = {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            cachedTokens: usage.cached_tokens ?? 0,
            totalTokens: usage.total_tokens,
            model: modelId,
            timestamp: Date.now(),
        };

        this.usageTracker?.record(record);
        this.outputChannel.info(`📊 ${formatUsageSummary(record)}`);

        // Quality/cost guardrails.
        this.maybeWarnContextFill(usage.prompt_tokens, maxInputTokens, modelId);
        this.maybeWarnCacheMiss();

        // Opportunistically refresh balance after each request (silent, debounced).
        void this.refreshBalance(true);
    }

    // ── Guardrail warnings (context fill + cache miss) ─────────────

    /** Notification keys already shown this session, to avoid spam. */
    private readonly shownWarnings = new Set<string>();

    private maybeWarnContextFill(promptTokens: number, maxInputTokens: number | undefined, modelName: string): void {
        if (!this.configManager.getWarnOnContextFill() || !maxInputTokens) return;
        const w = contextFillWarning(promptTokens, maxInputTokens, this.configManager.getContextWarnThreshold(), modelName);
        this.showWarningOnce(w);
    }

    private maybeWarnCacheMiss(): void {
        if (!this.configManager.getWarnOnCacheMiss()) return;
        const stats = this.usageTracker?.getStats();
        if (!stats) return;
        const w = cacheMissWarning(
            stats.totalPromptTokens,
            stats.totalCachedTokens,
            this.configManager.getCacheMissWarnThreshold(),
        );
        this.showWarningOnce(w);
    }

    private showWarningOnce(w: ThresholdWarning | null): void {
        if (!w || this.shownWarnings.has(w.key)) return;
        this.shownWarnings.add(w.key);

        if (w.severity === 'warning') {
            this.outputChannel.warn(`⚠️ ${w.message}`);
        } else {
            this.outputChannel.info(`ℹ️ ${w.message}`);
        }
        // Surface to the user without blocking the chat flow.
        vscode.window.showWarningMessage(`Kimi: ${w.message}`, 'Dismiss').then(
            () => { /* dismissed */ },
            () => { /* ignored */ },
        );
    }

    private lastBalanceFetch = 0;
    private static readonly BALANCE_DEBOUNCE_MS = 30_000;

    /**
     * Fetch current balance from Kimi API and update the status bar.
     * Debounced — parallel chat requests fire at most one call per 30s.
     *
     * @param silent When true, suppress the transient status-bar ack.
     *               Used by the auto-refresh-after-chat path.
     */
    public async refreshBalance(silent = false): Promise<void> {
        const tracker = this.usageTracker;
        if (!tracker) return;

        // Debounce: parallel chat requests would otherwise fire N concurrent calls.
        const now = Date.now();
        if (now - this.lastBalanceFetch < KimiChatProvider.BALANCE_DEBOUNCE_MS) {
            return;
        }
        this.lastBalanceFetch = now;

        try {
            // Use the main key for balance; the command has no model context.
            const apiKey = await this.configManager.getApiKey();
            if (!apiKey) {
                this.outputChannel.debug('Balance fetch skipped: no API key available');
                return;
            }

            const baseUrl = this.configManager.getBaseUrl();
            const response = await fetch(`${baseUrl}/v1/users/me/balance`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                this.outputChannel.warn(
                    `Balance fetch failed (HTTP ${response.status})${body ? `: ${body.slice(0, 200)}` : ''} — status bar will show estimated cost instead`,
                );
                return;
            }

            const data = (await response.json()) as {
                data?: { available_balance?: number };
            };
            const balance = data?.data?.available_balance;
            if (balance !== undefined) {
                tracker.setBalance(balance);
                if (!silent) {
                    // Flash a transient ack next to the status bar so the user
                    // sees the result immediately even if the click closed the
                    // hover popup (matches DeepSeek V4 behaviour).
                    void vscode.window.setStatusBarMessage(
                        `$(check) Kimi balance: $${balance.toFixed(2)}`,
                        4000,
                    );
                }
            } else {
                this.outputChannel.warn(
                    'Balance fetch returned no available_balance field — status bar will show estimated cost instead',
                );
            }
        } catch (err) {
            this.outputChannel.warn(
                `Balance fetch error: ${err instanceof Error ? err.message : String(err)} — status bar will show estimated cost instead`,
            );
        }
    }

    // ── Token counting ─────────────────────────────────────────────

    async provideTokenCount(
        _model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        _token: vscode.CancellationToken,
    ): Promise<number> {
        if (typeof text === 'string') {
            return estimateTokens(text);
        }
        return estimateTokens(extractTextContent(text));
    }

    // ── Cleanup ────────────────────────────────────────────────────

    dispose(): void {
        this.outputChannel.dispose();
        this._onDidChange.dispose();
        this.disposables.forEach((d) => d.dispose());
        this.disposables.length = 0;
    }

    // ── Fetch with timeout, retry and cancellation ─────────────────

    private async fetchWithRetry(
        url: string,
        init: RequestInit,
        timeoutMs: number,
        token: vscode.CancellationToken,
        attempt = 1,
        maxRetries = 3,
        deadlineMs?: number,
    ): Promise<Response> {
        // Overall budget: don't retry forever. Default = 3× per-request timeout.
        if (deadlineMs === undefined) {
            deadlineMs = Date.now() + timeoutMs * maxRetries;
        }

        // Check cancellation before each attempt.
        if (token.isCancellationRequested) {
            throw new vscode.LanguageModelError('Request was cancelled.');
        }
        if (Date.now() >= deadlineMs) {
            throw new vscode.LanguageModelError('Kimi API request exceeded its overall retry budget.');
        }

        let response: Response;
        try {
            response = await this.fetchWithTimeout(url, init, timeoutMs, token);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isRetryableNetworkError(message) && attempt < maxRetries && Date.now() < deadlineMs) {
                const delay = jitteredBackoff(attempt);
                this.outputChannel.warn(
                    `Network error, retrying in ${delay}ms (attempt ${attempt}/${maxRetries}): ${message}`,
                );
                await sleep(delay);
                return this.fetchWithRetry(url, init, timeoutMs, token, attempt + 1, maxRetries, deadlineMs);
            }

            throw err;
        }

        // Retry on HTTP 429 (rate limit) and 5xx (server errors).
        if (isRetryableStatus(response.status) && attempt < maxRetries && Date.now() < deadlineMs) {
            // Honor Retry-After header if present.
            let delay = jitteredBackoff(attempt);
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
                const seconds = parseInt(retryAfter, 10);
                if (!isNaN(seconds) && seconds > 0) {
                    delay = Math.min(seconds * 1000, 30000);
                }
            }

            // Drain the body so the connection can be reused.
            await response.text().catch(() => { /* ignore */ });

            this.outputChannel.warn(
                `HTTP ${response.status}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
            );
            await sleep(delay);
            return this.fetchWithRetry(url, init, timeoutMs, token, attempt + 1, maxRetries, deadlineMs);
        }

        return response;
    }

    private async fetchWithTimeout(
        url: string,
        init: RequestInit,
        timeoutMs: number,
        token: vscode.CancellationToken,
    ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const disposables: vscode.Disposable[] = [];
        disposables.push(token.onCancellationRequested(() => controller.abort()));

        try {
            return await fetch(url, { ...init, signal: controller.signal });
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                throw new Error(`Kimi API request timed out after ${timeoutMs}ms or was cancelled.`);
            }
            throw err;
        } finally {
            clearTimeout(timeout);
            disposables.forEach((d) => d.dispose());
        }
    }

    // ── Error mapping ───────────────────────────────────────────────

    private toLanguageModelError(
        status: number,
        body: string,
        endpoint?: string,
        retryAfter?: string | null,
    ): vscode.LanguageModelError {
        const epSuffix = endpoint ? ` [${endpoint}]` : '';
        const retryHint = retryAfter ? ` Retry after ${retryAfter}s.` : '';

        switch (status) {
            case 401:
                return new vscode.LanguageModelError(
                    `Invalid Kimi API key (401)${epSuffix}. Run "Kimi Copilot: Set API Key" to update.`,
                );
            case 403:
                return new vscode.LanguageModelError(
                    `Access denied (403)${epSuffix}. Check your API key permissions.`,
                );
            case 429:
                return new vscode.LanguageModelError(
                    `Kimi API rate limit exceeded (429)${epSuffix}.${retryHint} Check https://platform.kimi.ai/console/api-keys`,
                );
            case 500:
            case 502:
            case 503:
                return new vscode.LanguageModelError(
                    `Kimi API server error (${status})${epSuffix}.${retryHint} Retry later.`,
                );
            default:
                return new vscode.LanguageModelError(
                    `Kimi API error ${status}${epSuffix}: ${body.slice(0, 300)}`,
                );
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers — message conversion
// ═══════════════════════════════════════════════════════════════════════

function roleToString(role: vscode.LanguageModelChatMessageRole): string {
    switch (role) {
        case vscode.LanguageModelChatMessageRole.User:
            return 'user';
        case vscode.LanguageModelChatMessageRole.Assistant:
            return 'assistant';
        default:
            return 'user';
    }
}

export function extractTextContent(
    msg: vscode.LanguageModelChatMessage | vscode.LanguageModelChatRequestMessage,
): string {
    const parts: string[] = [];
    for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            parts.push(part.value);
        } else if (part instanceof vscode.LanguageModelPromptTsxPart) {
            parts.push(typeof part.value === 'string' ? part.value : JSON.stringify(part.value));
        }
    }
    return parts.join('\n');
}

/** Convert a binary image part to a Kimi image_url content part. */
function toImageContentPart(part: vscode.LanguageModelDataPart): KimiContentPart | undefined {
    const mime = part.mimeType || 'image/png';
    if (!mime.startsWith('image/')) return undefined;
    let binary = '';
    const bytes = part.data;
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return {
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${Buffer.from(binary, 'binary').toString('base64')}` },
    };
}

export function convertMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
): KimiMessage[] {
    const result: KimiMessage[] = [];

    for (const message of messages) {
        const role = roleToString(message.role);
        let content = '';
        let reasoning = '';
        const contentParts: KimiContentPart[] = [];
        let sawImage = false;
        const toolCalls: KimiToolCall[] = [];
        const toolResults: Array<{ callId: string; content: string }> = [];

        for (const part of message.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                content += part.value;
                contentParts.push({ type: 'text', text: part.value });
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push({
                    id: part.callId,
                    type: 'function',
                    function: {
                        name: part.name,
                        arguments: JSON.stringify(part.input),
                    },
                });
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                const toolContentParts: string[] = [];
                for (const item of part.content) {
                    if (item instanceof vscode.LanguageModelTextPart) {
                        toolContentParts.push(item.value);
                    } else if (item instanceof vscode.LanguageModelPromptTsxPart) {
                        toolContentParts.push(
                            typeof item.value === 'string' ? item.value : JSON.stringify(item.value),
                        );
                    }
                }
                toolResults.push({
                    callId: part.callId,
                    content: toolContentParts.length > 0 ? toolContentParts.join('\n') : JSON.stringify(part.content),
                });
            } else if (part instanceof vscode.LanguageModelDataPart) {
                const img = toImageContentPart(part);
                if (img) {
                    sawImage = true;
                    contentParts.push(img);
                }
            } else if (isThinkingPartLike(part)) {
                // K3/K2.7: capture prior reasoning so it can be echoed back.
                reasoning += getThinkingPartValue(part);
            }
        }

        if (role === 'assistant') {
            if (content || toolCalls.length > 0 || reasoning) {
                const msg: KimiMessage = {
                    role: 'assistant',
                    content: content || '',
                };
                if (reasoning) {
                    msg.reasoning_content = reasoning;
                }
                if (toolCalls.length > 0) {
                    msg.tool_calls = toolCalls;
                }
                result.push(msg);
            }
        } else {
            if (sawImage) {
                // User message containing images → use multipart content array.
                // Ensure there's at least one text part so the payload is valid.
                const parts = contentParts.some((p) => p.type === 'text')
                    ? contentParts
                    : [{ type: 'text', text: '' } as KimiContentPart, ...contentParts];
                result.push({ role: 'user', content: parts });
            } else if (content) {
                result.push({ role: role as 'user' | 'assistant', content });
            }
        }

        // Tool result messages follow their associated assistant message
        for (const tr of toolResults) {
            result.push({
                role: 'tool',
                content: tr.content,
                tool_call_id: tr.callId,
            });
        }
    }

    return result;
}

export function convertTools(
    toolCallingCapability: boolean | undefined,
    tools: readonly vscode.LanguageModelChatTool[] | undefined,
): KimiTool[] | undefined {
    if (!toolCallingCapability || !tools || tools.length === 0) {
        return undefined;
    }

    return tools.map((tool) => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as Record<string, unknown> | undefined,
        },
    }));
}

// ═══════════════════════════════════════════════════════════════════════
// Request building (pure — exported for testing)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Resolves the effective reasoning effort from Copilot Chat's Thinking
 * Effort picker UI. The value flows through either `modelOptions` (the
 * picker's own state) or `modelConfiguration`/`configuration` (the
 * per-model config json-schema form).
 *
 * Precedence: UI picker > per-model config > model default > 'max'.
 * Only used for reasoning-capable models (K3).
 */
export function resolveReasoningEffortFromOptions(
	options: Record<string, unknown> | undefined,
): 'low' | 'high' | 'max' | undefined {
	if (!options) return undefined;

	// The Thinking Effort picker writes to `modelOptions.reasoning_effort`
	// (stable API) or `modelConfiguration.reasoningEffort` (proposed API).
	const modelOptions = (options as { modelOptions?: Record<string, unknown> }).modelOptions;
	if (modelOptions?.reasoning_effort) {
		return normalizeEffort(String(modelOptions.reasoning_effort));
	}

	const ext = options as {
		modelConfiguration?: Record<string, unknown>;
		configuration?: Record<string, unknown>;
	};
	const configured = ext.modelConfiguration?.reasoningEffort ?? ext.configuration?.reasoningEffort;
	if (typeof configured === 'string') {
		return normalizeEffort(configured);
	}

	return undefined;
}

function normalizeEffort(value: string): 'low' | 'high' | 'max' {
	const v = value.toLowerCase();
	if (v === 'low' || v === 'none') return 'low';
	if (v === 'high' || v === 'medium') return 'high';
	return 'max'; // 'max', 'ultra', or unknown → max
}

export interface BuildRequestContext {
    modelInfo: vscode.LanguageModelChatInformation;
    messages: readonly vscode.LanguageModelChatRequestMessage[];
    options: vscode.ProvideLanguageModelChatResponseOptions;
    configManager: ConfigurationManager;
    enableStreaming: boolean;
    testMode?: boolean;
}

/**
 * Build the Kimi API request payload. Pure with respect to the provided
 * context (no network or I/O), so it can be unit-tested directly.
 *
 * Precedence: per-model config > global setting > hard-coded model default.
 */
export function buildKimiRequest(ctx: BuildRequestContext): { request: KimiRequest; tools: KimiTool[] | undefined } {
    const { modelInfo, messages, options, configManager, enableStreaming, testMode } = ctx;
    const isK3 = modelInfo.id.startsWith('kimi-k3');
    const modelName = configManager.getApiModelId(modelInfo.id);
    const modelConfig: ModelConfigOverride = configManager.getModelConfig(modelInfo.id);
    const modelDefaults = getModelDefaults(modelInfo.id);

    const temperature =
        modelConfig.temperature ??
        configManager.getTemperature() ??
        modelDefaults?.temperature ??
        1.0;
    const topP =
        modelConfig.topP ?? configManager.getTopP() ?? modelDefaults?.topP ?? 0.95;
    const presencePenalty =
        modelConfig.presencePenalty ?? configManager.getPresencePenalty(modelInfo.id) ?? 0.0;
    const frequencyPenalty =
        modelConfig.frequencyPenalty ?? configManager.getFrequencyPenalty(modelInfo.id) ?? 0.0;
    const thinking =
        modelConfig.thinking ?? configManager.getThinking(modelInfo.id) ?? modelDefaults?.thinking;

    const maxTokensSetting = configManager.getMaxTokens(modelInfo.id);
    const maxOutputTokens = modelConfig.maxOutputTokens ?? getMaxOutputTokens(modelInfo.id);
    const maxTokens = maxTokensSetting > 0 ? maxTokensSetting : maxOutputTokens;

    const systemPrompt = configManager.getSystemPrompt(modelInfo.id);
    const capabilities = getModelCapabilities(modelInfo.id);
    const toolCallingEnabled = modelConfig.toolCalling ?? capabilities?.toolCalling ?? false;

    const allMessages = convertMessages(messages);
    if (!allMessages.some((m) => m.role === 'system')) {
        allMessages.unshift({ role: 'system', content: systemPrompt });
    }

    const request: KimiRequest = {
        model: modelName,
        messages: allMessages,
        stream: enableStreaming,
        temperature,
        top_p: topP,
        max_completion_tokens: testMode ? 1 : maxTokens,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
        stream_options: enableStreaming ? { include_usage: true } : undefined,
    };

    if (isK3) {
        // K3: always-on reasoning via reasoning_effort, not thinking.
        // Precedence: Copilot Chat UI picker → per-model config → model default → 'max'.
        const uiEffort = resolveReasoningEffortFromOptions(options as unknown as Record<string, unknown>);
        request.reasoning_effort = uiEffort ?? modelConfig.reasoningEffort ?? modelDefaults?.reasoning_effort ?? 'max';
        // K3 fixed top_p.
        request.top_p = 0.95;
    } else if (thinking) {
        request.thinking = thinking;
    }

    // K2.7 API requires top_p: 0.95 exactly — enforce even if user overrides.
    if (modelInfo.id.startsWith('kimi-k2.7')) {
        request.top_p = modelDefaults?.topP ?? 0.95;
    }

    // Convert tools if the model supports tool calling.
    const tools = convertTools(toolCallingEnabled, options.tools);
    if (tools && tools.length > 0) {
        request.tools = tools;
        // K3 supports "required"; K2.x does not. Use "auto" by default and let
        // Copilot Chat's tool orchestration drive multi-turn behaviour.
        request.tool_choice = toolCallingEnabled ? 'auto' : 'none';
    }

    return { request, tools };
}

// ═══════════════════════════════════════════════════════════════════════
// Non-streaming response
// ═══════════════════════════════════════════════════════════════════════

async function completeResponse(
    response: Response,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    outputChannel: vscode.LogOutputChannel,
): Promise<KimiStreamChunk['usage']> {
    const data = (await response.json()) as {
        choices: Array<{
            message?: {
                role?: string;
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: KimiToolCall[];
            };
            finish_reason: string | null;
        }>;
        usage?: KimiStreamChunk['usage'];
    };

    const message = data.choices[0]?.message;
    if (!message) {
        outputChannel.warn('Empty response from Kimi API');
        return data.usage;
    }

    // Show chain-of-thought (reasoning_content) before the final answer
    if (message.reasoning_content) {
        progress.report(createThinkingPart(message.reasoning_content));
    }

    if (message.content) {
        progress.report(new vscode.LanguageModelTextPart(message.content));
    }

    if (message.tool_calls) {
        for (const call of message.tool_calls) {
            progress.report(
                new vscode.LanguageModelToolCallPart(
                    call.id,
                    call.function.name,
                    safeParseArgs(call.function.arguments),
                ),
            );
        }
    }
    return data.usage;
}

// ═══════════════════════════════════════════════════════════════════════
// Native context-window gauge reporting
// ═══════════════════════════════════════════════════════════════════════

/**
 * Report token usage to GitHub Copilot Chat's NATIVE context-window
 * indicator via a `usage` data part. Only reports for real conversation
 * turns; auxiliary requests (chat-title, todo-tracker, etc.) are skipped.
 *
 * Mechanism mirrors the upstream DeepSeek V4 provider (v0.3.7).
 */
function tryReportNativeUsage(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: vscode.ProvideLanguageModelChatResponseOptions,
	usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number },
	outputChannel: vscode.LogOutputChannel,
): void {
	try {
		const firstText = extractFirstMessageText(messages);
		const latestUserText = extractLatestUserText(messages);
		const toolNames = (options.tools ?? []).map((t) => t.name);
		const kind = classifyRequestKind(firstText, latestUserText, toolNames);
		const reportable = isReportableContextRequest(kind);

		outputChannel.debug(
			`[ctxusage] kind=${kind} prompt=${usage.prompt_tokens} reported=${reportable}`,
		);

		if (reportable) {
			progress.report(
				vscode.LanguageModelDataPart.json(
					{
						prompt_tokens: usage.prompt_tokens,
						completion_tokens: usage.completion_tokens,
						total_tokens: usage.total_tokens,
						prompt_tokens_details:
							usage.cached_tokens !== undefined
								? { cached_tokens: usage.cached_tokens }
								: undefined,
					},
					'usage',
				),
			);
		}
	} catch (e) {
		// Best-effort; don't break the chat flow for reporting failures.
		outputChannel.debug(
			`[ctxusage] report failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

/** Extract the concatenated text from the first message (typically the system prompt). */
function extractFirstMessageText(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
	if (messages.length === 0) return '';
	return messageText(messages[0]);
}

/** Extract the concatenated text from the last User-role message. */
function extractLatestUserText(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === vscode.LanguageModelChatMessageRole.User) {
			return messageText(messages[i]);
		}
	}
	return '';
}

function messageText(m: vscode.LanguageModelChatRequestMessage): string {
	let text = '';
	for (const part of m.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		}
	}
	return text;
}

// ═══════════════════════════════════════════════════════════════════════
// SSE streaming — OpenAI-compatible
// ═══════════════════════════════════════════════════════════════════════

async function streamSSEResponse(
    response: Response,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    outputChannel: vscode.LogOutputChannel,
): Promise<KimiStreamChunk['usage']> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body from Kimi API');
    }

    const decoder = new TextDecoder('utf-8');
    let lastUsage: KimiStreamChunk['usage'] | undefined;
    let buffer = '';
    const pendingToolCalls = new Map<
        number,
        { id: string; name: string; args: string }
    >();

    const emitPendingToolCalls = (): void => {
        if (pendingToolCalls.size === 0) {
            return;
        }
        for (const call of pendingToolCalls.values()) {
            if (call.id && call.name) {
                progress.report(
                    new vscode.LanguageModelToolCallPart(
                        call.id,
                        call.name,
                        safeParseArgs(call.args),
                    ),
                );
            }
        }
        pendingToolCalls.clear();
    };

    try {
        while (true) {
            if (token.isCancellationRequested) {
                await reader.cancel();
                return;
            }

            let readResult: ReadableStreamReadResult<Uint8Array>;
            try {
                readResult = await reader.read();
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') {
                    outputChannel.warn('SSE stream aborted');
                    return;
                }
                throw err;
            }

            const { done, value } = readResult;
            if (done) {
                emitPendingToolCalls();
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) {
                    continue;
                }

                const payload = trimmed.slice(5).trim();
                if (payload === '[DONE]') {
                    emitPendingToolCalls();
                    return lastUsage;
                }

                try {
                    const parsed = JSON.parse(payload) as KimiStreamChunk;

                    // Capture usage from the final chunk
                    if (parsed.usage) {
                        lastUsage = parsed.usage;
                    }

                    const delta = parsed.choices[0]?.delta;
                    if (!delta) {
                        continue;
                    }

                    // Text content
                    if (delta.content) {
                        progress.report(new vscode.LanguageModelTextPart(delta.content));
                    }

                    // Chain-of-thought (reasoning_content) — render as a Thinking part
                    if (delta.reasoning_content) {
                        progress.report(createThinkingPart(delta.reasoning_content));
                    }

                    // Tool calls (accumulate across chunks)
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            let existing = pendingToolCalls.get(tc.index);
                            if (!existing) {
                                existing = { id: '', name: '', args: '' };
                                pendingToolCalls.set(tc.index, existing);
                            }

                            if (tc.id) {
                                existing.id = tc.id;
                            }
                            if (tc.function?.name) {
                                existing.name += tc.function.name;
                            }
                            if (tc.function?.arguments) {
                                existing.args += tc.function.arguments;
                            }
                        }
                    }

                    // Emit completed tool calls on finish
                    if (parsed.choices[0].finish_reason) {
                        emitPendingToolCalls();
                    }
                } catch (parseErr) {
                    outputChannel.warn('Skipping malformed SSE chunk', parseErr);
                }
            }
        }
    } finally {
        try {
            reader.releaseLock();
        } catch {
            /* already released */
        }
    }
    return lastUsage;
}

function safeParseArgs(args: string): Record<string, unknown> {
    try {
        return JSON.parse(args) as Record<string, unknown>;
    } catch {
        return {};
    }
}
