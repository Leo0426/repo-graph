import { findingVerdicts } from './external-findings.js';
import type { findingReport } from './external-findings.js';
import { HttpError } from './http-error.js';

type Report = ReturnType<typeof findingReport>;
type PullRequest = { owner: string; repo: string; number: number };
const maxCommentBytes = 60_000;
const maxResponseBytes = 512 * 1024;

export function githubPullRequest(owner: string, repo: string, number: number): PullRequest {
    if (!/^[a-z\d][a-z\d-]{0,38}$/i.test(owner)) throw new HttpError(400, 'INVALID_OWNER');
    if (!/^[a-z\d._-]{1,100}$/i.test(repo) || repo === '.' || repo === '..') throw new HttpError(400, 'INVALID_REPO');
    return { owner, repo, number };
}

function githubApi() {
    const token = process.env.REPOGRAPH_GITHUB_TOKEN?.trim();
    if (!token) throw new HttpError(502, 'GITHUB_COMMENT_NOT_CONFIGURED');
    const base = URL.parse(process.env.REPOGRAPH_GITHUB_API_BASE_URL?.trim() || 'https://api.github.com');
    if (!base || base.username || base.password || base.search || base.hash
        || (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1'))) {
        throw new HttpError(502, 'GITHUB_COMMENT_NOT_CONFIGURED');
    }
    return { token, base };
}

function commentBody(reports: Report[]) {
    const counts = findingVerdicts.flatMap(verdict => {
        const count = reports.filter(item => item.report.verdict === verdict).length;
        return count ? [`${verdict} × ${count}`] : [];
    });
    const sections = reports.map(item => item.markdown.replace(/^# External finding\n/, '### External finding\n'));
    const body = ['## RepoGraph SAST triage', '', ...(reports.length
        ? [`**${reports.length} findings** · ${counts.join(' · ')}`, '', ...sections]
        : ['No findings to review.'])].join('\n').replaceAll('@', '&#64;');
    if (Buffer.byteLength(body) > maxCommentBytes) throw new HttpError(413, 'GITHUB_COMMENT_TOO_LARGE');
    return body;
}

async function readCommentUrl(response: Response, base: URL, target: PullRequest) {
    if (!response.body) throw new HttpError(502, 'GITHUB_COMMENT_UNCONFIRMED');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxResponseBytes) throw new HttpError(502, 'GITHUB_COMMENT_UNCONFIRMED');
            chunks.push(value);
        }
        const json = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
        const url = typeof json?.html_url === 'string' ? URL.parse(json.html_url) : null;
        const host = base.hostname === 'api.github.com' ? 'github.com' : base.hostname;
        const repo = `/${target.owner}/${target.repo}`.toLowerCase();
        const path = url?.pathname.toLowerCase();
        if (url?.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.search
            && (path === `${repo}/pull/${target.number}` || path === `${repo}/issues/${target.number}`)
            && /^#issuecomment-\d+$/.test(url.hash)) return url.href;
        throw new HttpError(502, 'GITHUB_COMMENT_UNCONFIRMED');
    } catch {
        throw new HttpError(502, 'GITHUB_COMMENT_UNCONFIRMED');
    } finally {
        void reader.cancel().catch(() => undefined);
    }
}

export async function publishGithubTriage(target: PullRequest, reports: Report[], authorize: () => void, client: AbortSignal) {
    const { token, base } = githubApi();
    const body = commentBody(reports);
    const repo = base.href.replace(/\/$/, '') + `/repos/${target.owner}/${target.repo}`;
    const signal = AbortSignal.any([client, AbortSignal.timeout(15_000)]);
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
    const exchange = async (url: string, method: 'GET' | 'POST', payload?: string) => {
        try {
            return await fetch(url, { method, headers: payload ? { ...headers, 'Content-Type': 'application/json' } : headers,
                body: payload, signal, redirect: 'manual' });
        } catch {
            // A failed POST may have reached GitHub, so it is never retried here.
            throw new HttpError(502, method === 'POST' ? 'GITHUB_COMMENT_UNCONFIRMED' : 'GITHUB_PR_CHECK_FAILED');
        }
    };
    const pull = await exchange(`${repo}/pulls/${target.number}`, 'GET');
    void pull.body?.cancel().catch(() => undefined);
    if (pull.status === 404) throw new HttpError(404, 'GITHUB_PR_NOT_FOUND');
    if (pull.status !== 200) throw new HttpError(502, 'GITHUB_PR_CHECK_FAILED');
    authorize();
    const response = await exchange(`${repo}/issues/${target.number}/comments`, 'POST', JSON.stringify({ body }));
    if (response.status !== 201) {
        void response.body?.cancel().catch(() => undefined);
        throw new HttpError(502, response.status >= 500 ? 'GITHUB_COMMENT_UNCONFIRMED' : 'GITHUB_COMMENT_FAILED');
    }
    return readCommentUrl(response, base, target);
}
