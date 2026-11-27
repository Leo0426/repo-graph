import { z } from 'zod';
import { gitRepositoryUrl } from './git-transport.js';
import type { GitCredential } from './git-transport.js';
import { HttpError } from './http-error.js';

export const hostedGitAdapter = z.enum(['GITHUB', 'GITLAB']);
export type HostedGitAdapter = z.infer<typeof hostedGitAdapter>;
export type HostedGitIdentity = { adapter: HostedGitAdapter; instance: string; upstreamId: string };
type RepositoryUrl = ReturnType<typeof gitRepositoryUrl>;

const repositoryId = z.int().positive();
const githubResponse = z.object({ id: repositoryId, clone_url: z.string() });
const gitlabResponse = z.object({ id: repositoryId, http_url_to_repo: z.string() });
const bodyLimit = 256 * 1024;

function hostedPath(adapter: HostedGitAdapter, path: string) {
    const segments = path.replace(/\.git$/, '').slice(1).split('/');
    if (segments.length < 2 || segments.some(part => !part) || (adapter === 'GITHUB' && segments.length !== 2)) {
        throw new HttpError(400, 'INVALID_HOSTED_GIT_PATH');
    }
    return adapter === 'GITHUB' ? segments.map(part => part.toLowerCase()).join('/') : segments.join('/');
}

export function sameHostedUrl(adapter: HostedGitAdapter, left: RepositoryUrl, right: RepositoryUrl) {
    return left.origin === right.origin && hostedPath(adapter, left.path) === hostedPath(adapter, right.path);
}

export function hostedGitCredential(identity: HostedGitIdentity | undefined, credential: GitCredential | undefined) {
    if (!identity || !credential || credential.username !== undefined) return credential;
    return { ...credential, username: identity.adapter === 'GITHUB' ? 'x-access-token' : 'oauth2' };
}

async function readMetadata(response: Response) {
    if (!response.body) throw new HttpError(502, 'GIT_IDENTITY_RESPONSE_INVALID');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > bodyLimit) throw new HttpError(502, 'GIT_IDENTITY_RESPONSE_INVALID');
            chunks.push(value);
        }
    } finally { await reader.cancel().catch(() => undefined); }
    try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown; }
    catch { throw new HttpError(502, 'GIT_IDENTITY_RESPONSE_INVALID'); }
}

export async function resolveHostedGit(adapter: HostedGitAdapter, remote: RepositoryUrl, credential: GitCredential | undefined,
    signal: AbortSignal) {
    const path = hostedPath(adapter, remote.path);
    const github = adapter === 'GITHUB';
    const api = github ? (remote.origin === 'https://github.com' ? 'https://api.github.com' : remote.origin + '/api/v3')
        + '/repos/' + path : remote.origin + '/api/v4/projects/' + encodeURIComponent(path);
    const deadline = AbortSignal.timeout(8000);
    try {
        const response = await fetch(api, { redirect: 'manual', signal: AbortSignal.any([signal, deadline]), headers: github
            ? { Accept: 'application/vnd.github+json', ...(credential && { Authorization: 'Bearer ' + credential.token }) }
            : { Accept: 'application/json', ...(credential && { 'PRIVATE-TOKEN': credential.token }) } });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            if (response.status >= 300 && response.status < 400) throw new HttpError(409, 'GIT_IDENTITY_REDIRECT');
            if ([401, 403, 404].includes(response.status)) throw new HttpError(409, 'GIT_IDENTITY_UNAVAILABLE');
            throw new HttpError(502, 'GIT_IDENTITY_LOOKUP_FAILED');
        }
        const payload = await readMetadata(response);
        const data = github ? githubResponse.transform(repo => ({ id: repo.id, url: repo.clone_url })).safeParse(payload)
            : gitlabResponse.transform(repo => ({ id: repo.id, url: repo.http_url_to_repo })).safeParse(payload);
        if (!data.success) throw new HttpError(502, 'GIT_IDENTITY_RESPONSE_INVALID');
        let canonical: RepositoryUrl;
        try { canonical = gitRepositoryUrl(data.data.url, new Set([remote.origin])); }
        catch { throw new HttpError(502, 'GIT_IDENTITY_RESPONSE_INVALID'); }
        if (!sameHostedUrl(adapter, remote, canonical)) throw new HttpError(409, 'GIT_IDENTITY_REDIRECT');
        return { identity: { adapter, instance: remote.origin, upstreamId: String(data.data.id) }, url: canonical.url };
    } catch (error) {
        signal.throwIfAborted();
        if (deadline.aborted) throw new HttpError(504, 'GIT_IDENTITY_LOOKUP_TIMED_OUT');
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, 'GIT_IDENTITY_LOOKUP_FAILED');
    }
}
