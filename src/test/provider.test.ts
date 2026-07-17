import * as assert from 'assert';
import * as vscode from 'vscode';
import { convertMessages, convertTools, extractTextContent, buildKimiRequest } from '../provider';
import { ConfigurationManager } from '../config';
import { toChatInfo, MODELS } from '../models';
import type { KimiTool, KimiMessage } from '../types';

suite('provider helpers', () => {
    suite('convertMessages', () => {
        test('converts a single user message', () => {
            const messages = [vscode.LanguageModelChatMessage.User('hello')];
            const result = convertMessages(messages);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].role, 'user');
            assert.strictEqual(result[0].content, 'hello');
        });

        test('converts an assistant message with tool calls', () => {
            const messages = [
                vscode.LanguageModelChatMessage.Assistant([
                    new vscode.LanguageModelTextPart('Thinking...'),
                    new vscode.LanguageModelToolCallPart('call-1', 'getWeather', { city: 'Paris' }),
                ]),
            ];

            const result = convertMessages(messages);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].role, 'assistant');
            assert.strictEqual(result[0].content, 'Thinking...');
            assert.deepStrictEqual(result[0].tool_calls, [
                {
                    id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'getWeather',
                        arguments: JSON.stringify({ city: 'Paris' }),
                    },
                },
            ]);
        });

        test('converts tool result parts', () => {
            const messages = [
                vscode.LanguageModelChatMessage.User([
                    new vscode.LanguageModelToolResultPart('call-1', [
                        new vscode.LanguageModelTextPart('Sunny'),
                    ]),
                ]),
            ];

            const result = convertMessages(messages);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].role, 'tool');
            assert.strictEqual(result[0].content, 'Sunny');
            assert.strictEqual(result[0].tool_call_id, 'call-1');
        });
    });

    suite('convertTools', () => {
        test('returns undefined when tool calling is disabled', () => {
            const result = convertTools(false, [
                { name: 'tool1', description: 'desc', inputSchema: {} },
            ] as vscode.LanguageModelChatTool[]);
            assert.strictEqual(result, undefined);
        });

        test('returns undefined for empty tools', () => {
            const result = convertTools(true, []);
            assert.strictEqual(result, undefined);
        });

        test('converts tools to Kimi format', () => {
            const schema = { type: 'object', properties: {} };
            const tools = [
                { name: 'tool1', description: 'first tool', inputSchema: schema },
            ] as vscode.LanguageModelChatTool[];
            const result = convertTools(true, tools);

            const expected: KimiTool[] = [
                {
                    type: 'function',
                    function: {
                        name: 'tool1',
                        description: 'first tool',
                        parameters: schema,
                    },
                },
            ];
            assert.deepStrictEqual(result, expected);
        });
    });

    suite('extractTextContent', () => {
        test('extracts text from string message', () => {
            const msg = vscode.LanguageModelChatMessage.User('hello world');
            assert.strictEqual(extractTextContent(msg), 'hello world');
        });

        test('returns empty string for empty content', () => {
            const msg = vscode.LanguageModelChatMessage.User([]);
            assert.strictEqual(extractTextContent(msg), '');
        });
    });

    suite('K3 thinking history', () => {
        test('assistant reasoning parts are echoed back as reasoning_content', () => {
            // Simulate an assistant message that carries a thinking part
            // (as Copilot Chat would when replaying conversation history).
            const thinkingPart = { value: 'let me reason about this' };
            const messages = [
                vscode.LanguageModelChatMessage.Assistant([
                    thinkingPart as unknown as vscode.LanguageModelTextPart,
                    new vscode.LanguageModelTextPart('final answer'),
                ]),
            ];

            const result = convertMessages(messages);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].role, 'assistant');
            assert.strictEqual(result[0].content, 'final answer');
            assert.strictEqual(result[0].reasoning_content, 'let me reason about this');
        });

        test('user messages never get reasoning_content', () => {
            const messages = [vscode.LanguageModelChatMessage.User('hello')];
            const result = convertMessages(messages);
            assert.strictEqual(result[0].reasoning_content, undefined);
        });
    });

    suite('image input', () => {
        test('user message with image becomes multipart content', () => {
            const img = new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3, 4]), 'image/png');
            const messages = [
                vscode.LanguageModelChatMessage.User([
                    new vscode.LanguageModelTextPart('what is this?'),
                    img,
                ]),
            ];

            const result = convertMessages(messages);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].role, 'user');
            const content = result[0].content;
            assert.ok(Array.isArray(content), 'content should be an array for image messages');
            const arr = content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
            assert.ok(arr.some((p) => p.type === 'text'));
            const imgPart = arr.find((p) => p.type === 'image_url');
            assert.ok(imgPart, 'should contain an image_url part');
            assert.ok(imgPart!.image_url!.url.startsWith('data:image/png;base64,'));
        });

        test('text-only user message stays a plain string', () => {
            const messages = [vscode.LanguageModelChatMessage.User('plain')];
            const result = convertMessages(messages);
            assert.strictEqual(typeof result[0].content, 'string');
        });
    });

    suite('buildKimiRequest', () => {
        const makeConfig = (overrides: Partial<Record<string, unknown>> = {}): ConfigurationManager => {
            // Stub SecretStorage — buildKimiRequest never touches secrets.
            const secrets = {
                get: async () => undefined,
                store: async () => undefined,
                delete: async () => undefined,
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
            } as unknown as vscode.SecretStorage;
            const cm = new ConfigurationManager(secrets);
            // Patch the config getter to return our overrides via a fake.
            const values: Record<string, unknown> = {
                temperature: 1.0,
                topP: 0.95,
                maxTokens: 0,
                modelConfigs: {},
                systemPrompt: 'sys',
                ...overrides,
            };
            Object.defineProperty(cm, 'config', {
                get: () => ({
                    get: <T,>(key: string, def?: T) => (key in values ? (values[key] as T) : def),
                }),
            });
            return cm;
        };

        const modelInfo = (id: string): vscode.LanguageModelChatInformation =>
            ({
                id,
                name: id,
                family: 'kimi',
                version: id,
                maxInputTokens: 256000,
                maxOutputTokens: 32768,
                capabilities: { toolCalling: true, imageInput: false },
            }) as vscode.LanguageModelChatInformation;

        const baseOptions: vscode.ProvideLanguageModelChatResponseOptions = {
            toolMode: vscode.LanguageModelChatToolMode.Auto,
        };

        test('K3 gets reasoning_effort and fixed top_p, no thinking field', () => {
            const { request } = buildKimiRequest({
                modelInfo: modelInfo('kimi-k3'),
                messages: [vscode.LanguageModelChatMessage.User('hi')],
                options: baseOptions,
                configManager: makeConfig(),
                enableStreaming: true,
            });
            assert.strictEqual(request.reasoning_effort, 'max');
            assert.strictEqual(request.top_p, 0.95);
            assert.strictEqual(request.thinking, undefined);
            assert.strictEqual(request.stream, true);
        });

        test('K2.7 enforces top_p 0.95 and thinking enabled', () => {
            const { request } = buildKimiRequest({
                modelInfo: modelInfo('kimi-k2.7-code'),
                messages: [vscode.LanguageModelChatMessage.User('hi')],
                options: baseOptions,
                configManager: makeConfig({ topP: 0.5 }), // user override should be overridden
                enableStreaming: true,
            });
            assert.strictEqual(request.top_p, 0.95);
            assert.deepStrictEqual(request.thinking, { type: 'enabled', keep: 'all' });
        });

        test('testMode forces max_completion_tokens to 1 and disables streaming', () => {
            const { request } = buildKimiRequest({
                modelInfo: modelInfo('kimi-k3'),
                messages: [vscode.LanguageModelChatMessage.User('ping')],
                options: baseOptions,
                configManager: makeConfig(),
                enableStreaming: false,
                testMode: true,
            });
            assert.strictEqual(request.max_completion_tokens, 1);
            assert.strictEqual(request.stream, false);
        });

        test('prepends a system message when none present', () => {
            const { request } = buildKimiRequest({
                modelInfo: modelInfo('kimi-k3'),
                messages: [vscode.LanguageModelChatMessage.User('hi')],
                options: baseOptions,
                configManager: makeConfig({ systemPrompt: 'custom sys' }),
                enableStreaming: true,
            });
            const first = (request.messages as KimiMessage[])[0];
            assert.strictEqual(first.role, 'system');
            assert.strictEqual(first.content, 'custom sys');
        });
    });

    suite('toChatInfo — Session Info / context-size integration', () => {
        const k3 = MODELS.find((m) => m.id === 'kimi-k3')!;

        test('exposes a Context Size configuration schema', () => {
            const info = toChatInfo(k3, true) as unknown as {
                configurationSchema?: { properties?: Record<string, { default?: unknown; enum?: unknown[] }> };
            };
            const prop = info.configurationSchema?.properties?.['contextSize'];
            assert.ok(prop, 'contextSize schema property should exist');
            assert.strictEqual(prop!.default, k3.maxInputTokens);
            assert.ok(Array.isArray(prop!.enum));
            assert.ok((prop!.enum as number[]).includes(k3.maxInputTokens));
        });

        test('full window is the default; K3 offers a 256K tier', () => {
            const info = toChatInfo(k3, true) as unknown as {
                configurationSchema?: { properties?: Record<string, { enum?: unknown[] }> };
            };
            const tiers = info.configurationSchema?.properties?.['contextSize']?.enum as number[];
            assert.deepStrictEqual(tiers, [1048576, 262144]);
        });

        test('respects a user-picked smaller contextSize tier', () => {
            const info = toChatInfo(k3, true, undefined, { contextSize: 262144 });
            assert.strictEqual(info.maxInputTokens, 262144);
        });

        test('ignores invalid or oversized contextSize values', () => {
            assert.strictEqual(
                toChatInfo(k3, true, undefined, { contextSize: 999999999 }).maxInputTokens,
                k3.maxInputTokens,
            );
            assert.strictEqual(
                toChatInfo(k3, true, undefined, { contextSize: -5 }).maxInputTokens,
                k3.maxInputTokens,
            );
            assert.strictEqual(
                toChatInfo(k3, true, undefined, { contextSize: 'big' }).maxInputTokens,
                k3.maxInputTokens,
            );
        });

        test('modelConfigs maxInputTokens override stays authoritative for tiers', () => {
            const info = toChatInfo(k3, true, { maxInputTokens: 131072 }) as unknown as {
                maxInputTokens: number;
                configurationSchema?: { properties?: Record<string, { default?: unknown; enum?: unknown[] }> };
            };
            assert.strictEqual(info.maxInputTokens, 131072);
            const prop = info.configurationSchema?.properties?.['contextSize'];
            assert.strictEqual(prop!.default, 131072);
            // 131072/4 = 32768 < 65536 → no smaller tier offered
            assert.deepStrictEqual(prop!.enum, [131072]);
        });
    });
});
