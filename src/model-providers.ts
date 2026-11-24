import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { HttpError } from './http-error.js';
import type { IdentityDirectory } from './identity.js';
import { ProviderSecrets } from './provider-secrets.js';

export const DEFAULT_PROVIDER = 'legacy-ollama';
const MAX_PROVIDERS = 100;
const protocol = z.enum(['OLLAMA', 'OPENAI', 'OPENAI_COMPATIBLE', 'ANTHROPIC']);
export type GenerationProtocol = z.infer<typeof protocol>;
const control = /[\u0000-\u001f\u007f-\u009f]/;
export const providerText = (max: number) => z.string().refine(text => !control.test(text)).pipe(z.string().trim().min(1).max(max));
const endpoint = providerText(500);
const timeout = z.number().int().min(1000).max(600_000);
const price = z.number().min(0).max(1_000_000).nullish();
const credential = z.object({ protocol, baseUrl: endpoint,
    apiKey: z.string().max(8192).regex(/^[\x20-\x7e]*$/).nullish().transform(value => value?.trim() ?? ''),
    clearApiKey: z.boolean().default(false), timeoutMillis: timeout });
export const providerInput = credential.extend({ name: providerText(100), model: providerText(200),
    enabled: z.boolean(), maxOutputTokens: z.number().int().min(1).max(65_536),
    inputUsdPerMillionTokens: price, outputUsdPerMillionTokens: price
}).refine(input => (input.inputUsdPerMillionTokens == null) === (input.outputUsdPerMillionTokens == null));
export const discoveryInput = credential.extend({ providerId: z.string().max(70).nullish() });
export const ollamaSettingsInput = z.object({ enabled: z.boolean(), baseUrl: endpoint, model: providerText(200) });

export interface ModelProvider {
    id: string;
    name: string;
    protocol: GenerationProtocol;
    baseUrl: string;
    model: string;
    enabled: boolean;
    selected: boolean;
    apiKeyConfigured: boolean;
    timeoutMillis: number;
    maxOutputTokens: number;
    updatedAt: string;
    inputUsdPerMillionTokens: number | null;
    outputUsdPerMillionTokens: number | null;
}

export interface ProviderConnection { protocol: GenerationProtocol; baseUrl: string; timeoutMillis: number; apiKey: string }

export function normalizeEndpoint(raw: string) {
    try {
        if (!/^https?:\/\/[^/]/i.test(raw) || /[\\?#\s]/u.test(raw)) throw new Error();
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.port === '0' || url.username || url.password) throw new Error();
        return url.origin + url.pathname.replace(/\/+$/, '');
    } catch { throw new HttpError(400, 'INVALID_PROVIDER_ENDPOINT'); }
}

function profile(row: Record<string, unknown>): ModelProvider {
    const { encrypted_key, selected, ...value } = row;
    return { ...JSON.parse(String(value.payload)), selected: !!selected, apiKeyConfigured: !!encrypted_key } as ModelProvider;
}

export function providerBinding(config: Pick<ModelProvider, 'id' | 'protocol' | 'baseUrl'>) {
    return JSON.stringify([config.id, config.protocol, config.baseUrl]);
}

export class ModelProviders {
    private readonly secrets: ProviderSecrets;

    constructor(private readonly db: DatabaseSync, private readonly audit: Pick<IdentityDirectory, 'record'>, keyPath: string | null) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS model_provider (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, selected INTEGER NOT NULL CHECK(selected IN (0,1)),
                encrypted_key TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS model_provider_selected ON model_provider(selected) WHERE selected = 1;
        `);
        const encrypted = db.prepare("SELECT * FROM model_provider WHERE encrypted_key <> ''").all();
        this.secrets = new ProviderSecrets(keyPath, process.env.REPOGRAPH_PROVIDER_ENCRYPTION_KEY, encrypted.length > 0);
        for (const row of encrypted) this.secrets.decrypt(providerBinding(profile(row)), String(row.encrypted_key));
        const initial = { id: DEFAULT_PROVIDER, name: 'Ollama', protocol: 'OLLAMA', baseUrl: 'http://localhost:11434',
            model: 'qwen3:8b', enabled: false, timeoutMillis: 180_000, maxOutputTokens: 4096, updatedAt: new Date().toISOString(),
            inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 };
        db.prepare(`INSERT INTO model_provider SELECT ?, ?, 1, '', ? WHERE NOT EXISTS (SELECT 1 FROM model_provider)`)
            .run(initial.id, initial.name, JSON.stringify(initial));
    }

    private row(id: string) {
        const row = this.db.prepare('SELECT * FROM model_provider WHERE id = ?').get(id);
        if (!row) throw new HttpError(404, 'PROVIDER_NOT_FOUND');
        return row;
    }

    private write<T>(operation: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const value = operation();
            this.db.exec('COMMIT');
            return value;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    list() { return this.db.prepare('SELECT * FROM model_provider ORDER BY name, id').all().map(profile); }
    get(id: string) { return profile(this.row(id)); }

    current() {
        const row = this.db.prepare('SELECT * FROM model_provider WHERE selected = 1').get();
        if (!row) throw new Error('Missing selected model provider');
        return profile(row);
    }

    save(actor: string, id: string | null, input: z.infer<typeof providerInput>) {
        const { apiKey, clearApiKey, ...fields } = input;
        const baseUrl = normalizeEndpoint(fields.baseUrl);
        const replacing = apiKey.length > 0;
        if (replacing && clearApiKey) throw new HttpError(400, 'CONFLICTING_PROVIDER_CREDENTIAL_CHANGE');
        return this.write(() => {
            const row = id ? this.row(id) : undefined;
            if (!row && Number(this.db.prepare('SELECT count(*) AS n FROM model_provider').get()?.n) >= MAX_PROVIDERS) {
                throw new HttpError(409, 'PROVIDER_LIMIT_REACHED');
            }
            const previous = row ? profile(row) : undefined;
            let secret = String(row?.encrypted_key ?? '');
            const config = { ...fields, id: id ?? randomUUID(), baseUrl, updatedAt: new Date().toISOString(),
                inputUsdPerMillionTokens: fields.inputUsdPerMillionTokens ?? null,
                outputUsdPerMillionTokens: fields.outputUsdPerMillionTokens ?? null };
            if (secret && !replacing && !clearApiKey && (previous?.baseUrl !== baseUrl || previous.protocol !== config.protocol)) {
                throw new HttpError(400, 'PROVIDER_CREDENTIAL_CHANGE_REQUIRED');
            }
            if (replacing) secret = this.secrets.encrypt(providerBinding(config), apiKey);
            else if (clearApiKey) secret = '';
            this.db.prepare(`INSERT INTO model_provider VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name, encrypted_key=excluded.encrypted_key, payload=excluded.payload`)
                .run(config.id, config.name, Number(previous?.selected ?? false), secret, JSON.stringify(config));
            this.audit.record(actor, id ? 'PROVIDER_UPDATED' : 'PROVIDER_CREATED', config.id, '');
            return this.get(config.id);
        });
    }

    select(actor: string, id: string) {
        return this.write(() => {
            const config = this.get(id);
            if (!config.enabled) throw new HttpError(409, 'PROVIDER_DISABLED');
            this.db.prepare('UPDATE model_provider SET selected = 0 WHERE selected = 1').run();
            this.db.prepare('UPDATE model_provider SET selected = 1 WHERE id = ?').run(id);
            this.audit.record(actor, 'PROVIDER_SELECTED', id, '');
            return this.get(id);
        });
    }

    remove(actor: string, id: string) {
        return this.write(() => {
            if (this.get(id).selected) throw new HttpError(409, 'PROVIDER_SELECTED');
            this.db.prepare('DELETE FROM model_provider WHERE id = ?').run(id);
            this.audit.record(actor, 'PROVIDER_DELETED', id, '');
            return { deleted: true };
        });
    }

    resolve(id: string) {
        const row = this.row(id);
        const config = profile(row);
        const apiKey = row.encrypted_key ? this.secrets.decrypt(providerBinding(config), String(row.encrypted_key)) : '';
        return { config, apiKey };
    }

    draft(input: z.infer<typeof discoveryInput>): ProviderConnection {
        const { providerId, protocol, clearApiKey, timeoutMillis } = input;
        const baseUrl = normalizeEndpoint(input.baseUrl);
        let apiKey = input.apiKey;
        if (apiKey && clearApiKey) throw new HttpError(400, 'CONFLICTING_PROVIDER_CREDENTIAL_CHANGE');
        if (providerId) {
            const saved = this.get(providerId);
            if (!apiKey && !clearApiKey && saved.apiKeyConfigured) {
                if (saved.protocol !== protocol || saved.baseUrl !== baseUrl) throw new HttpError(400, 'PROVIDER_CREDENTIAL_CHANGE_REQUIRED');
                apiKey = this.resolve(providerId).apiKey;
            }
        }
        return { baseUrl, protocol, apiKey, timeoutMillis: Math.min(timeoutMillis, 30_000) };
    }
}
