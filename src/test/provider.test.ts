import * as assert from 'assert';
import * as vscode from 'vscode';
import { convertMessages, convertTools, extractTextContent } from '../provider';
import type { KimiTool } from '../types';

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
});
