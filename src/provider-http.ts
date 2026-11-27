import type { IncomingMessage, ServerResponse } from 'node:http';
import { agentRunIdPattern } from './agent-runs.js';
import { GenerationError } from './generation.js';
import type { GenerationGateway } from './generation.js';
import { readPayload } from './http-body.js';
import { HttpError, send } from './http-error.js';
import { DEFAULT_PROVIDER, discoveryInput, ollamaSettingsInput, providerInput } from './model-providers.js';
import type { ModelProvider, ModelProviders } from './model-providers.js';

const ADMIN = '/api/v1/admin/model-providers';
const LEGACY = '/api/v1/agent-settings/llm';
const CAPABILITIES = '/api/v1/capabilities/generation';
const MAX_BODY = 64 * 1024;

function legacy({ enabled, protocol, baseUrl, model, updatedAt }: ModelProvider) {
    return { enabled, protocol, baseUrl, model, updatedAt };
}

export async function handleProviders(request: IncomingMessage, response: ServerResponse, path: string,
    providers: ModelProviders, gateway: GenerationGateway, actor: string, authorizeAdmin: () => void, cancelOnClose: () => AbortSignal) {
    if (path === CAPABILITIES && request.method === 'GET') {
        const { enabled, protocol, model, name } = providers.current();
        send(response, 200, {
            configured: true, enabled, protocol, name, model, connectionStatus: 'NOT_CHECKED', generationStatus: 'NOT_VERIFIED'
        });
        return true;
    }
    if (path !== ADMIN && !path.startsWith(ADMIN + '/') && path !== LEGACY && path !== LEGACY + '/test') return false;
    authorizeAdmin();
    const route = request.method + ' ' + path;
    if (route === 'GET ' + ADMIN) send(response, 200, providers.list());
    else if (route === 'POST ' + ADMIN || route === 'PUT ' + LEGACY) {
        if (path === ADMIN) {
            const input = await readPayload(request, providerInput, MAX_BODY);
            authorizeAdmin();
            send(response, 201, providers.save(actor, null, input));
        } else {
            const input = await readPayload(request, ollamaSettingsInput, MAX_BODY);
            authorizeAdmin();
            const config = providers.current();
            if (config.protocol !== 'OLLAMA') throw new HttpError(409, 'MANAGE_SELECTED_PROVIDER');
            send(response, 200, legacy(providers.save(actor, config.id, { ...config, ...input, apiKey: '', clearApiKey: false })));
        }
    } else if (route === 'POST ' + ADMIN + '/models' || route === 'POST ' + LEGACY + '/test') {
        const input = path === ADMIN + '/models' ? await readPayload(request, discoveryInput, MAX_BODY)
            : { ...await readPayload(request, ollamaSettingsInput, MAX_BODY), protocol: 'OLLAMA' as const, providerId: null,
                apiKey: '', clearApiKey: false, timeoutMillis: 10_000 };
        authorizeAdmin();
        if (response.destroyed) return true;
        const connection = providers.draft(input);
        let models: string[];
        try { models = await gateway.models(connection, cancelOnClose()); }
        catch (error) {
            if (!(error instanceof GenerationError)) throw error;
            if (response.destroyed) return true;
            authorizeAdmin();
            if (path === LEGACY + '/test') send(response, 200, { reachable: false, modelAvailable: false, message: error.message, models: [] });
            else throw new HttpError(502, error.message);
            return true;
        }
        if (response.destroyed) return true;
        authorizeAdmin();
        if ('model' in input) {
            const model = input.model;
            const modelAvailable = typeof model === 'string' && (models.includes(model) || models.includes(model + ':latest'));
            send(response, 200, { reachable: true, modelAvailable, models, message: modelAvailable ? 'PROVIDER_CONNECTED' : 'PROVIDER_MODEL_NOT_FOUND' });
        } else send(response, 200, { models });
    } else if (route === 'GET ' + LEGACY) send(response, 200, legacy(providers.current()));
    else if (path.startsWith(ADMIN + '/')) {
        const [id, action, extra] = path.slice(ADMIN.length + 1).split('/');
        if ((id !== DEFAULT_PROVIDER && !agentRunIdPattern.test(id)) || extra !== undefined) return false;
        if (!action && request.method === 'PUT') {
            const input = await readPayload(request, providerInput, MAX_BODY);
            authorizeAdmin();
            send(response, 200, providers.save(actor, id, input));
        } else if (!action && request.method === 'DELETE') send(response, 200, providers.remove(actor, id));
        else if (action === 'select' && request.method === 'POST') send(response, 200, providers.select(actor, id));
        else if (action === 'test' && request.method === 'POST') {
            const result = await gateway.test(id, cancelOnClose(), actor);
            if (!response.destroyed) { authorizeAdmin(); send(response, 200, result); }
        } else return false;
    } else return false;
    return true;
}
