import { setTimeout as backoff } from 'node:timers/promises';
import { z } from 'zod';
import { defaultModelPool, providerText } from './model-providers.js';
import type { FrozenModelProvider, ModelProvider, ModelProviders, ProviderConnection } from './model-providers.js';
import type { ModelUsage, ModelUsageSample, ModelUse } from './model-usage.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT = defaultModelPool.maxConcurrent;
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

class TransientProviderError extends GenerationError {
    constructor(status: number, readonly delayMs: number) { super('PROVIDER_HTTP_' + status); }
}

interface GenerationRequest {
    system: string;
    user: string;
    schema?: Record<string, unknown>;
    maxOutputTokens?: number;
    maxEstimatedCostUsd?: number;
    signal?: AbortSignal;
    attribution?: ModelUse;
    beforeRetry?: () => boolean;
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
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 429 || response.status === 503) {
            const retryAfter = response.headers.get('Retry-After')?.trim();
            const suppliedDelay = retryAfter ? /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now() : 0;
            throw new TransientProviderError(response.status, Number.isNaN(suppliedDelay) ? 200 : Math.max(200, suppliedDelay));
        }
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

function countedUsage(config: ModelProvider, data: Record<string, unknown>): ModelUsageSample {
    const usage = config.protocol === 'OLLAMA' ? data : object.safeParse(data.usage).data;
    const fields = config.protocol === 'OLLAMA' ? ['prompt_eval_count', 'eval_count']
        : config.protocol === 'ANTHROPIC' ? ['input_tokens', 'output_tokens'] : ['prompt_tokens', 'completion_tokens'];
    const [inputTokens, outputTokens] = fields.map(field => tokens.safeParse(usage?.[field]).data ?? null);
    return { inputTokens, outputTokens, costUsd: cost(config, inputTokens, outputTokens) };
}

export class GenerationGateway {
    private running = 0;
    private readonly observations = new Map<string, { revision: string; time: number; failure: string | null }>();

    constructor(private readonly providers: ModelProviders, private readonly usage: ModelUsage) {}

    session() {
        return this.resume(this.providers.freeze());
    }

    freeze() { return this.providers.freeze(); }
    closedBackgroundPools() { return this.usage.closedBackgroundPools(); }

    availability() {
        const config = this.providers.current();
        const sample = this.observations.get(config.id);
        const current = sample?.revision === config.updatedAt && Date.now() - sample.time < 300_000 ? sample : undefined;
        const status = !config.enabled ? 'disabled' : !current ? 'unverified' : current.failure ? 'unavailable' : 'available';
        return { status, running: this.running, capacity: MAX_CONCURRENT,
            checkedAt: config.enabled && current ? new Date(current.time).toISOString() : null,
            reason: config.enabled ? current?.failure ?? null : null };
    }

    private observe(config: ModelProvider, failure: string | null) {
        this.observations.delete(config.id);
        this.observations.set(config.id, { revision: config.updatedAt, time: Date.now(), failure });
        if (this.observations.size > 100) this.observations.delete(this.observations.keys().next().value!);
    }

    resume(frozen: FrozenModelProvider) {
        const { config, apiKey } = this.providers.resolveFrozen(frozen);
        return {
            configuration: Object.freeze(config),
            complete: (request: GenerationRequest) => {
                if (!config.enabled) throw new GenerationError('GENERATION_DISABLED');
                return this.complete(config, apiKey, frozen.encryptedKey, request);
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

    private async complete(config: ModelProvider, apiKey: string, encryptedKey: string, request: GenerationRequest) {
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
        const deadline = Date.now() + config.timeoutMillis;
        try {
            return await this.sendCompletion(config, encryptedKey, request, connection, route, body, config.timeoutMillis);
        } catch (error) {
            if (!(error instanceof TransientProviderError) || !request.beforeRetry || error.delayMs > 1000
                || deadline - Date.now() < error.delayMs + 100
                || (estimatedCost !== null && request.maxEstimatedCostUsd !== undefined && 2 * estimatedCost > request.maxEstimatedCostUsd)) throw error;
            try { await backoff(error.delayMs, undefined, { signal: request.signal }); }
            catch { throw new GenerationError('PROVIDER_CANCELLED'); }
            const remaining = deadline - Date.now();
            if (remaining < 100 || !request.beforeRetry()) throw error;
            return this.sendCompletion(config, encryptedKey, request, connection, route, body, remaining);
        }
    }

    private async sendCompletion(config: ModelProvider, encryptedKey: string, request: GenerationRequest, connection: ProviderConnection,
        route: string, body: string, timeout: number) {
        let invocation: string | undefined;
        let measured: ModelUsageSample | undefined;
        try {
            const result = await this.bounded(timeout, request.signal, async signal => {
                signal.throwIfAborted();
                const permit = this.usage.send({ ...config, timeoutMillis: timeout }, encryptedKey, request.attribution);
                if (!permit.id) throw new GenerationError(permit.reason);
                invocation = permit.id;
                const { data } = await exchange(connection, route, signal, MAX_BYTES, body);
                measured = countedUsage(config, data);
                const response = readCompletion(connection, data);
                return { ...response, model: config.model, costUsd: cost(config, response.inputTokens, response.outputTokens) };
            });
            if (invocation) this.usage.settle(invocation, null, measured);
            this.observe(config, null);
            return result;
        } catch (error) {
            if (invocation) this.usage.settle(invocation, error instanceof GenerationError ? error.message : 'MODEL_SETTLEMENT_FAILED', measured);
            if (error instanceof GenerationError && !error.message.startsWith('HOSTED_') && !['PROVIDER_CANCELLED', 'PROVIDER_BUSY', 'PROVIDER_POOL_BUSY',
                'PROVIDER_POOL_WINDOW_CLOSED', 'PROVIDER_ACCESS_CHANGED', 'PROVIDER_OUTPUT_TRUNCATED'].includes(error.message)) {
                this.observe(config, error.message);
            }
            throw error;
        }
    }

    async test(id: string, signal?: AbortSignal, actorId?: string) {
        const frozen = this.providers.freeze(id);
        const { config, apiKey } = this.providers.resolveFrozen(frozen);
        try {
            await this.complete(config, apiKey, frozen.encryptedKey, { system: 'This request checks the model connection.', user: 'Reply with OK.',
                maxOutputTokens: 128, signal, attribution: { capability: 'PROVIDER_TEST', actorId } });
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
