import { z } from 'zod';
import { providerText } from './model-providers.js';
import type { ModelProvider, ModelProviders, ProviderConnection } from './model-providers.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT = 4;
const object = z.record(z.string(), z.unknown());
const modelId = providerText(200);
const tokens = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ollamaOutput = z.object({ message: z.object({ content: z.string() }), done_reason: z.string().optional(),
    prompt_eval_count: tokens.optional(), eval_count: tokens.optional() });
const chatOutput = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }),
    finish_reason: z.string().nullish() })).min(1), usage: z.object({ prompt_tokens: tokens, completion_tokens: tokens }).nullish() });
const anthropicOutput = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    stop_reason: z.string().nullish(), usage: z.object({ input_tokens: tokens, output_tokens: tokens }).optional() });

export class GenerationError extends Error {}

interface GenerationRequest {
    system: string;
    user: string;
    schema?: Record<string, unknown>;
    maxOutputTokens?: number;
    maxEstimatedCostUsd?: number;
    signal?: AbortSignal;
}

interface RawCompletion { text: string; inputTokens: number | null; outputTokens: number | null }

function headers(connection: ProviderConnection) {
    const result: Record<string, string> = { Accept: 'application/json' };
    if (connection.protocol === 'ANTHROPIC') {
        result['anthropic-version'] = '2023-06-01';
        if (connection.apiKey) result['x-api-key'] = connection.apiKey;
    } else if (connection.apiKey) result.Authorization = 'Bearer ' + connection.apiKey;
    return result;
}

async function exchange(connection: ProviderConnection, path: string, signal: AbortSignal, remaining: number, body?: string) {
    const requestHeaders = headers(connection);
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    const response = await fetch(connection.baseUrl + path, { method: body === undefined ? 'GET' : 'POST',
        headers: requestHeaders, body, redirect: 'manual', signal });
    if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        throw new GenerationError(response.status >= 300 && response.status < 400
            ? 'PROVIDER_REDIRECT_BLOCKED' : 'PROVIDER_HTTP_' + response.status);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > remaining) {
                void reader.cancel().catch(() => undefined);
                throw new GenerationError('PROVIDER_RESPONSE_TOO_LARGE');
            }
            chunks.push(value);
        }
        let json: unknown;
        try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
        catch { throw new GenerationError('INVALID_PROVIDER_RESPONSE'); }
        const parsed = object.safeParse(json);
        if (!parsed.success || Object.hasOwn(parsed.data, 'error')) throw new GenerationError('INVALID_PROVIDER_RESPONSE');
        return { data: parsed.data, size };
    } finally { reader.releaseLock(); }
}

function readCompletion(connection: ProviderConnection, response: Record<string, unknown>): RawCompletion {
    let result: RawCompletion | undefined;
    let stop: string | null | undefined;
    if (connection.protocol === 'OLLAMA') {
        const parsed = ollamaOutput.safeParse(response);
        if (parsed.success) {
            const data = parsed.data;
            result = { text: data.message.content, inputTokens: data.prompt_eval_count ?? null, outputTokens: data.eval_count ?? null };
            stop = data.done_reason;
        }
    } else if (connection.protocol === 'ANTHROPIC') {
        const parsed = anthropicOutput.safeParse(response);
        if (parsed.success) {
            const data = parsed.data;
            result = { text: data.content.filter(block => block.type === 'text').map(block => block.text ?? '').join(''),
                inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null };
            stop = data.stop_reason;
        }
    } else {
        const parsed = chatOutput.safeParse(response);
        if (parsed.success) {
            const data = parsed.data;
            result = { text: data.choices[0].message.content ?? '', inputTokens: data.usage?.prompt_tokens ?? null,
                outputTokens: data.usage?.completion_tokens ?? null };
            stop = data.choices[0].finish_reason;
        }
    }
    if (stop === 'length' || stop === 'max_tokens') throw new GenerationError('PROVIDER_OUTPUT_TRUNCATED');
    if (!result?.text.trim()) throw new GenerationError('INVALID_PROVIDER_RESPONSE');
    if (connection.apiKey) result.text = result.text.replaceAll(connection.apiKey, '[redacted]');
    return result;
}

function cost(config: ModelProvider, inputTokens: number | null, outputTokens: number | null) {
    if (config.inputUsdPerMillionTokens === null || config.outputUsdPerMillionTokens === null
        || inputTokens === null || outputTokens === null) return null;
    return (inputTokens * config.inputUsdPerMillionTokens + outputTokens * config.outputUsdPerMillionTokens) / 1_000_000;
}

export class GenerationGateway {
    private running = 0;

    constructor(private readonly providers: ModelProviders) {}

    session() {
        const config = this.providers.current();
        const resolved = config.enabled ? this.providers.resolve(config.id) : null;
        return {
            configuration: Object.freeze(resolved?.config ?? config),
            complete: (request: GenerationRequest) => {
                if (!resolved) throw new GenerationError('GENERATION_DISABLED');
                return this.complete(resolved.config, resolved.apiKey, request);
            }
        };
    }

    private async bounded<T>(timeoutMs: number, cancelled: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>) {
        if (cancelled?.aborted) throw new GenerationError('PROVIDER_CANCELLED');
        if (this.running >= MAX_CONCURRENT) throw new GenerationError('PROVIDER_BUSY');
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = cancelled ? AbortSignal.any([cancelled, timeout]) : timeout;
        this.running++;
        try { return await operation(signal); }
        catch (error) {
            if (cancelled?.aborted) throw new GenerationError('PROVIDER_CANCELLED');
            if (timeout.aborted) throw new GenerationError('PROVIDER_TIMEOUT');
            throw error instanceof GenerationError ? error : new GenerationError('PROVIDER_UNAVAILABLE');
        } finally { this.running--; }
    }

    private async complete(config: ModelProvider, apiKey: string, request: GenerationRequest) {
        const { protocol, model } = config;
        const outputLimit = Math.min(config.maxOutputTokens, request.maxOutputTokens ?? config.maxOutputTokens);
        const system = request.schema ? request.system + '\nReturn JSON matching this schema: ' + JSON.stringify(request.schema) : request.system;
        const user = { role: 'user', content: request.user };
        const messages = [{ role: 'system', content: system }, user];
        const base = { model, stream: false };
        const estimatedCost = cost(config, Buffer.byteLength(system) + Buffer.byteLength(request.user) + 32, outputLimit);
        if (estimatedCost !== null && request.maxEstimatedCostUsd !== undefined && estimatedCost > request.maxEstimatedCostUsd) {
            throw new GenerationError('PROVIDER_COST_LIMIT');
        }
        const body = JSON.stringify(protocol === 'OLLAMA' ? { ...base, messages, format: request.schema,
            options: { temperature: 0, num_predict: outputLimit } } : protocol === 'ANTHROPIC'
            ? { ...base, system, messages: [user], max_tokens: outputLimit }
            : { ...base, messages, [protocol === 'OPENAI' ? 'max_completion_tokens' : 'max_tokens']: outputLimit });
        if (Buffer.byteLength(body) > MAX_BYTES) throw new GenerationError('PROVIDER_REQUEST_TOO_LARGE');
        const route = protocol === 'OLLAMA' ? '/api/chat' : protocol === 'ANTHROPIC' ? '/messages' : '/chat/completions';
        const connection = { protocol, timeoutMillis: config.timeoutMillis, baseUrl: config.baseUrl, apiKey };
        return this.bounded(config.timeoutMillis, request.signal, async signal => {
            const { data } = await exchange(connection, route, signal, MAX_BYTES, body);
            const response = readCompletion(connection, data);
            return { ...response, model, costUsd: cost(config, response.inputTokens, response.outputTokens) };
        });
    }

    async test(id: string, signal?: AbortSignal) {
        const { config, apiKey } = this.providers.resolve(id);
        try {
            await this.complete(config, apiKey, { system: 'This request checks the model connection.', user: 'Reply with OK.',
                maxOutputTokens: 128, signal });
            return { connected: true, message: 'PROVIDER_CONNECTED' };
        } catch (error) {
            if (!(error instanceof GenerationError)) throw error;
            return { connected: false, message: error.message };
        }
    }

    async models(connection: ProviderConnection, cancelled?: AbortSignal) {
        return this.bounded(connection.timeoutMillis, cancelled, async signal => {
            const ids = new Set<string>();
            const cursors = new Set<string>();
            let after: string | undefined;
            let remaining = MAX_BYTES;
            for (let page = 0; page < 20; page++) {
                const query = new URLSearchParams({ limit: '1000' });
                if (after) query.set('after_id', after);
                const path = connection.protocol === 'OLLAMA' ? '/api/tags' : connection.protocol === 'ANTHROPIC' ? '/models?' + query : '/models';
                const { data, size } = await exchange(connection, path, signal, remaining);
                remaining -= size;
                const entries = connection.protocol === 'OLLAMA' ? data.models : data.data;
                if (!Array.isArray(entries)) throw new GenerationError('INVALID_PROVIDER_RESPONSE');
                for (const entry of entries) {
                    const id = modelId.safeParse(connection.protocol === 'OLLAMA' ? entry?.name : entry?.id);
                    if (!id.success || (connection.apiKey && id.data.includes(connection.apiKey))) throw new GenerationError('INVALID_PROVIDER_RESPONSE');
                    ids.add(id.data);
                    if (ids.size > 5000) throw new GenerationError('PROVIDER_MODEL_LIMIT');
                }
                if (connection.protocol !== 'ANTHROPIC' || data.has_more !== true) return [...ids].sort();
                const cursor = modelId.safeParse(data.last_id);
                if (!entries.length || !cursor.success || cursors.has(cursor.data)) throw new GenerationError('INVALID_PROVIDER_PAGINATION');
                cursors.add(cursor.data);
                after = cursor.data;
            }
            throw new GenerationError('PROVIDER_MODEL_LIMIT');
        });
    }
}
