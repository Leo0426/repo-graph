// Disposable Wiki prototype. Three reading layouts on /?view=wiki&variant=A|B|C.
import type { CodeUnit } from './source.js';
import type { SummaryDocument, WikiSummaries } from './wiki.js';
import type { SummaryCitation } from './wiki-facts.js';
import { bindLanguageSwitch, preferredLanguage, setDocumentLanguage } from './web-locale.js';

type WikiNode = ReturnType<WikiSummaries['tree']>[number];
type ReadingMode = 'document' | 'outline' | 'sources';
type Citation = SummaryCitation & { excerpt?: string[] };
type Section = { title: string; body: string; citation?: number };

const variants = ['A', 'B', 'C'] as const;
const messages = {
    title: ['Repository Wiki · RepoGraph Prototype', '仓库 Wiki · RepoGraph 原型'],
    openWorkbench: ['Open RepoGraph workbench', '打开 RepoGraph 工作台'], wikiToolbar: ['Wiki toolbar', 'Wiki 工具栏'],
    toggleOutline: ['Toggle outline', '切换目录'], previousSection: ['Previous section', '上一节'], nextSection: ['Next section', '下一节'],
    findWiki: ['Find in Wiki', '搜索 Wiki'], largerText: ['Larger reading text', '放大阅读字号'], copyLink: ['Copy preview link', '复制预览链接'],
    documentOutline: ['Document outline', '文档目录'], sourceReferences: ['Source references', '源码引用'],
    readingView: ['Reading view', '阅读视图'], document: ['Document', '正文'], outline: ['Outline', '目录'], sources: ['Sources', '源码'],
    variants: ['Prototype variants', '原型布局'], previousVariant: ['Previous variant', '上一种布局'], nextVariant: ['Next variant', '下一种布局'],
    layoutStudy: ['Layout study', '布局预览'], findPlaceholder: ['Find a section or source…', '搜索章节或源码…'], closeSearch: ['Close search', '关闭搜索'],
    A: ['Editorial', '编辑版式'], B: ['Reading focus', '专注阅读'], C: ['Evidence desk', '证据工作台'],
    preview: ['Preview document', '预览文档'], noIndexedWiki: ['Preview · No indexed Wiki yet', '预览 · 暂无已索引的 Wiki'],
    signInRequired: ['Preview · Sign in to load your Wiki', '预览 · 登录后加载 Wiki'], unavailable: ['Preview · Wiki unavailable', '预览 · Wiki 暂不可用'],
    indexedWiki: ['Indexed Wiki', '已索引的 Wiki'], wikiDocument: ['Wiki document', 'Wiki 文档'], wikiLabel: ['RepoGraph Wiki', 'RepoGraph Wiki'],
    wikiModule: ['Repository Wiki / Module', '仓库 Wiki / 模块'], wikiArchitecture: ['Repository Wiki / Architecture', '仓库 Wiki / 架构'],
    version: ['Version', '版本'], partialSummary: ['Partial summary', '部分摘要'], indexedSummary: ['Indexed summary', '索引摘要'],
    cover: ['Three frosted glass plates linked by points and thin traces', '由节点和细线连接的三块磨砂玻璃板'],
    showSource: ['Show source', '查看源码'], missingInfo: ['Missing information', '缺失信息'],
    noSources: ['This document has no source references.', '本文档暂无源码引用。'], onThisPage: ['On this page', '本页目录'],
    noMatches: ['No matching sections or sources.', '未找到匹配的章节或源码。'],
    documentUnavailable: ['Could not open that Wiki document', '无法打开该 Wiki 文档'],
    copied: ['Preview link copied', '已复制预览链接'], copyFailed: ['Copy the preview URL from the address bar', '请从地址栏复制预览链接']
} as const;
type Message = keyof typeof messages;
let language = preferredLanguage();
function t(key: Message) { return messages[key][language === 'zh' ? 1 : 0]; }
const glyphs: Record<string, string> = {
    graph: '<path d="m7 7 10 3M7 7l3 11m7-8-7 8"/><circle cx="5.5" cy="5.5" r="2.5"/><circle cx="18.5" cy="10.5" r="2.5"/><circle cx="10" cy="19" r="2.5"/>',
    sidebar: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14m-4-10h2m-2 3h2"/>',
    left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
    share: '<path d="M12 15V3m-4 4 4-4 4 4M8 10H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/>',
    document: '<path d="M6 3h8l4 4v14H6zm8 0v5h4M9 12h6m-6 4h6"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-14-4 16"/>',
    arrow: '<path d="M6 18 18 6M8 6h10v10"/>', close: '<path d="m6 6 12 12m0-12L6 18"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zm0 18v-9m8-4.5L12 12 4 7.5"/>',
    link: '<path d="m9 15 6-6m-5-2 2-2a4 4 0 0 1 6 6l-2 2m-2 4-2 2a4 4 0 0 1-6-6l2-2"/>'
};
const sectionIcons = ['document', 'layers', 'graph', 'link'];
const demo = {
    title: 'Repository architecture',
    lede: 'From source files to a queryable code graph. A field guide to the indexing pipeline and the evidence behind each answer.',
    sections: [
        { title: 'Overview', body: 'RepoGraph turns a source tree into a local map of symbols and relationships. It records each symbol alongside its file and line range, so a reader can follow an answer back to the code.' },
        { title: 'Indexing pipeline', body: 'The repository index stores parsed files and their symbols in SQLite. A project’s first scan builds the index. Later scans compare file content and refresh the records for changed paths.', citation: 0 },
        { title: 'Graph retrieval', body: 'Graph retrieval starts with matching symbols, then follows relationships such as callers and callees. The selected project defines the scope of the search.', citation: 1 },
        { title: 'Source evidence', body: 'Context packs bring together source excerpts and their references within a character budget. Each reference gives the reader a concrete location to check.', citation: 2 }
    ] satisfies Section[],
    citations: [
        { qualifiedName: 'RepositoryIndex', filePath: 'src/index.ts', startLine: 60, endLine: 63,
            excerpt: ['export class RepositoryIndex {', '    private readonly jobs = new Set<Promise<IndexStatus>>();',
                '    private readonly graph: CodeGraph;', '    private readonly vectors: VectorIndex;'] },
        { qualifiedName: 'graphRag', filePath: 'src/retrieval.ts', startLine: 52, endLine: 55,
            excerpt: ['export async function graphRag(repository: RepositoryIndex, query: string, options: GraphRagOptions, signal?: AbortSignal) {',
                '    const { projectId, language, noTest, limit, depth } = options;', '    const omittedReasons: string[] = [];',
                '    const candidates = new Map<string, RankedUnit>();'] },
        { qualifiedName: 'contextPack', filePath: 'src/retrieval.ts', startLine: 141, endLine: 145,
            excerpt: ['export function contextPack(', '    query: string, taskType: string, budget: number, retrieval: Awaited<ReturnType<typeof graphRag>>',
                ') {', '    const { results, seedCount, keywordSeedCount, callGraphExpanded, impactExpanded } = retrieval;',
                '    const omittedReasons = [...retrieval.omittedReasons];'] }
    ] satisfies Citation[]
};
const chineseDemo = {
    title: '仓库架构',
    lede: '从源文件到可查询的代码图谱。了解索引流程，以及每个答案背后的证据。',
    sections: [
        { title: '概览', body: 'RepoGraph 将源码目录转化为本地符号和关系图谱。每个符号都记录文件及行号范围，便于将结论追溯到源码。' },
        { title: '索引流程', body: '仓库索引在 SQLite 中保存已解析的文件和符号。第一次扫描建立索引，后续扫描比较文件内容，只刷新发生变更的路径。', citation: 0 },
        { title: '图谱检索', body: '图谱检索从匹配的符号开始，再沿调用方与被调用方等关系展开。所选仓库限定检索范围。', citation: 1 },
        { title: '源码证据', body: '证据包在字符预算内汇集源码片段及其引用。每条引用都指向可核查的具体位置。', citation: 2 }
    ] satisfies Section[]
};

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const windowPane = byId('prototype');
const paper = byId('paper');
const searchDialog = byId<HTMLDialogElement>('search-dialog');
const searchField = byId<HTMLInputElement>('search-field');
const narrowViewport = matchMedia('(max-width: 590px)');
const initialParams = new URLSearchParams(location.search);
const project = initialParams.get('project');
let variant = variants.find(key => key === initialParams.get('variant')) ?? 'A';
let mode: ReadingMode = 'document';
let outlineOpen = true;
let sectionIndex = 0;
let sourceIndex = 0;
let wiki: SummaryDocument | undefined;
let tree: WikiNode[] = [];
let dataLabel: Message = 'preview';
let toastMessage: Message | undefined;
let currentExcerpt: { source: Citation; start: number; lines: string[] } | undefined;
let sourceLoad: AbortController | undefined;
let documentLoad: AbortController | undefined;
let toastTimer: number | undefined;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', label = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (label) element.textContent = label;
    return element;
}

function addIcon(element: HTMLElement, name: string) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.65');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = glyphs[name];
    element.append(svg);
    return element;
}

function icon(name: string, className = '') {
    const element = node('span', className);
    element.dataset.icon = name;
    return addIcon(element, name);
}
for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) addIcon(element, element.dataset.icon!);

function previewDocument() { return language === 'zh' ? chineseDemo : demo; }
function sections(): Section[] { return wiki ? wiki.sections : previewDocument().sections; }
function citations(): Citation[] { return wiki ? wiki.citations : demo.citations; }
function variantUrl() {
    const url = new URL(location.href);
    url.searchParams.set('variant', variant);
    if (wiki) url.searchParams.set('document', wiki.id);
    return url;
}
function plain(text: string) {
    return text.replace(/\\([\\`*_{}\[\]()#+!|~])/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function notify(message: Message) {
    const feedback = byId('feedback');
    toastMessage = message;
    feedback.textContent = t(message);
    feedback.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { feedback.hidden = true; }, 3300);
}

function outlineList() {
    const list = node('ul', 'outline-list');
    for (const [index, section] of sections().entries()) {
        const row = node('li');
        const button = node('button', 'outline-button');
        button.dataset.section = String(index);
        button.setAttribute('aria-current', index === sectionIndex ? 'location' : 'false');
        button.append(icon(sectionIcons[index % sectionIcons.length]), node('span', '', section.title));
        button.addEventListener('click', () => selectSection(index));
        row.append(button);
        list.append(row);
    }
    return list;
}

function appendOutline(container: HTMLElement) {
    if (wiki && (tree.length > 1 || !tree.some(item => item.id === wiki?.id))) {
        const select = node('select', 'wiki-picker');
        select.setAttribute('aria-label', t('wikiDocument'));
        select.append(...tree.map(item => new Option(item.name, item.id)));
        if (!tree.some(item => item.id === wiki?.id)) select.append(new Option(wiki.title, wiki.id));
        select.value = wiki.id;
        select.addEventListener('change', () => { void loadDocument(select.value, true); });
        container.append(select);
    }
    container.append(outlineList());
}

function article() {
    const content = node('article', 'article');
    const lead = node('header', 'article-lead');
    const eyebrow = node('p', 'eyebrow');
    eyebrow.append(icon('layers'), t(wiki?.level === 'PACKAGE' ? 'wikiModule' : 'wikiArchitecture'));
    const title = node('h1', '', wiki?.title ?? previewDocument().title);
    if (wiki) {
        const meta = node('p', 'article-meta');
        meta.append(node('span', '', `${t('version')} ${wiki.docVersion}`),
            node('span', '', new Date(wiki.generatedAt).toLocaleDateString(language, { dateStyle: 'medium' })),
            node('span', '', t(wiki.status === 'PARTIAL' ? 'partialSummary' : 'indexedSummary')));
        lead.append(eyebrow, title, meta);
    } else {
        lead.append(eyebrow, title, node('p', 'lede', previewDocument().lede));
    }
    content.append(lead);
    if (!wiki) {
        const figure = node('figure', 'cover');
        const cover = node('img');
        cover.src = '/wiki-prototype-cover.jpg';
        cover.alt = t('cover');
        cover.width = 1600;
        cover.height = 533;
        figure.append(cover);
        content.append(figure);
    }
    for (const [index, section] of sections().entries()) {
        const fragment = node('section');
        const heading = node('h2', '', section.title);
        heading.id = `section-${index}`;
        heading.tabIndex = -1;
        fragment.setAttribute('aria-labelledby', heading.id);
        fragment.append(heading);
        if (section.body.startsWith('- ')) {
            const list = node('ul');
            list.append(...section.body.split('\n').map(line => node('li', '', plain(line.replace(/^- /, '')))));
            fragment.append(list);
        } else {
            const paragraph = node('p', '', plain(section.body));
            if (section.citation !== undefined) {
                const reference = section.citation;
                const button = node('button', 'inline-reference', String(reference + 1));
                button.setAttribute('aria-label', `${t('showSource')} ${citations()[reference].qualifiedName}`);
                button.addEventListener('click', () => { void selectSource(reference, true); });
                paragraph.append(' ', button);
            }
            fragment.append(paragraph);
        }
        content.append(fragment);
    }
    if (wiki?.missingInfo.length) {
        const details = node('details');
        const list = node('ul');
        list.append(...wiki.missingInfo.map(reason => node('li', '', reason)));
        details.append(node('summary', '', t('missingInfo')), list);
        content.append(details);
    }
    return content;
}

function codePanel(reference: Citation) {
    const panel = node('div', 'code-panel');
    const header = node('div', 'code-header');
    const location = reference.startLine === reference.endLine ? `${reference.startLine}` : `${reference.startLine}–${reference.endLine}`;
    header.append(icon('code'), `${reference.filePath}:${location}`);
    panel.append(header);
    const excerpt = currentExcerpt?.source === reference ? currentExcerpt : undefined;
    const lines = reference.excerpt ?? excerpt?.lines;
    if (lines?.length) {
        const pre = node('pre');
        const code = node('code');
        code.append(...lines.map((text, index) => {
            const line = node('span', 'code-line');
            const number = node('span', 'line-number', String((excerpt?.start ?? reference.startLine) + index));
            number.setAttribute('aria-hidden', 'true');
            line.append(number, text);
            return line;
        }));
        pre.append(code);
        panel.append(pre);
    }
    return panel;
}

function referencePanel(full: boolean) {
    const panel = node('div', full ? 'document-index' : 'inspector-inner');
    const references = citations();
    const heading = node('div', 'inspector-heading');
    heading.append(node(full ? 'h1' : 'h2', full ? '' : 'rail-heading', t('sourceReferences')), node('span', 'source-count', references.length.toLocaleString(language)));
    panel.append(heading);
    if (!references.length) {
        panel.append(node('p', 'no-sources', t('noSources')));
        return panel;
    }
    const list = node('ul', 'source-list');
    for (const [index, reference] of references.entries()) {
        const row = node('li');
        const button = node('button', 'source-button');
        button.dataset.source = String(index);
        button.title = `${reference.qualifiedName} · ${reference.filePath}:${reference.startLine}`;
        button.setAttribute('aria-pressed', String(index === sourceIndex));
        const label = node('span');
        label.append(node('strong', 'source-name', reference.qualifiedName), node('span', 'source-path', `${reference.filePath}:${reference.startLine}`));
        button.append(icon('code', 'source-icon'), label, icon('right'));
        button.addEventListener('click', () => { void selectSource(index, false, true); });
        row.append(button);
        list.append(row);
    }
    const reference = references[sourceIndex];
    panel.append(list, codePanel(reference));
    if (wiki) {
        const link = node('a', 'workbench-link');
        link.href = workbenchUrl(wiki.projectId, reference);
        link.append(t('openWorkbench'), icon('arrow'));
        panel.append(link);
    }
    return panel;
}

function workbenchUrl(projectId: string, reference: Citation) {
    return '/?' + new URLSearchParams({ view: 'graph', project: projectId, file: reference.filePath, line: String(reference.startLine) });
}

function renderReferences(keepFocus = false) {
    const pane = mode === 'sources' ? paper : byId('inspector');
    const reference = citations()[sourceIndex];
    if (!reference) return;
    for (const button of pane.querySelectorAll<HTMLButtonElement>('[data-source]')) {
        button.setAttribute('aria-pressed', String(Number(button.dataset.source) === sourceIndex));
    }
    pane.querySelector('.code-panel')?.replaceWith(codePanel(reference));
    const link = pane.querySelector<HTMLAnchorElement>('.workbench-link');
    if (link && wiki) link.href = workbenchUrl(wiki.projectId, reference);
    if (keepFocus) {
        const active = pane.querySelector<HTMLButtonElement>(`[data-source="${sourceIndex}"]`);
        active?.focus({ preventScroll: true });
        active?.scrollIntoView({ block: 'nearest' });
    }
}

function updateSectionControls() {
    byId<HTMLButtonElement>('previous-section').disabled = sectionIndex <= 0;
    byId<HTMLButtonElement>('next-section').disabled = sectionIndex >= sections().length - 1;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-section]')) {
        button.setAttribute('aria-current', Number(button.dataset.section) === sectionIndex ? 'location' : 'false');
    }
}

function updateOutlineControl() {
    const visible = mode === 'outline' || (mode === 'document' && variant !== 'C' && outlineOpen
        && !(variant === 'A' && narrowViewport.matches));
    byId('toggle-outline').setAttribute('aria-pressed', String(visible));
}

function render() {
    windowPane.dataset.variant = variant;
    windowPane.dataset.mode = mode;
    windowPane.dataset.outline = outlineOpen ? 'open' : 'closed';
    byId('variant-label').textContent = `${variant} · ${t(variant)}`;
    byId('data-label').textContent = t(dataLabel);
    byId('document-version').textContent = wiki ? `v${wiki.docVersion}` : t('wikiLabel');
    updateOutlineControl();
    const readingModes = byId('reading-modes');
    for (const button of readingModes.querySelectorAll<HTMLButtonElement>('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
    const rail = byId('outline');
    rail.replaceChildren(node('h2', 'rail-heading', t('onThisPage')));
    appendOutline(rail);
    byId('inspector').replaceChildren(referencePanel(false));
    if (mode === 'sources') paper.replaceChildren(referencePanel(true));
    else if (mode === 'outline') {
        const index = node('div', 'document-index');
        index.append(node('h1', '', t('documentOutline')));
        appendOutline(index);
        paper.replaceChildren(index);
    } else paper.replaceChildren(article());
    paper.scrollTo({ top: 0, behavior: 'instant' });
    updateSectionControls();
}

function switchMode(next: ReadingMode) {
    if (mode === next) return;
    mode = next;
    render();
    if (next === 'document' && sectionIndex > 0) scrollToSection(sectionIndex, false);
}

function scrollToSection(index: number, focus: boolean) {
    const heading = document.getElementById(`section-${index}`);
    if (focus) heading?.focus({ preventScroll: true });
    if (index === 0) paper.scrollTo({ top: 0 });
    else heading?.parentElement?.scrollIntoView({ block: 'start' });
}

function selectSection(index: number) {
    if (index < 0 || index >= sections().length) return;
    sectionIndex = index;
    if (mode !== 'document') {
        mode = 'document';
        render();
    }
    updateSectionControls();
    scrollToSection(index, true);
}

async function readApi<T>(path: string, query: Record<string, string>, signal: AbortSignal): Promise<T> {
    const response = await fetch(`/api/v1${path}?${new URLSearchParams(query)}`, { signal, redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json() as T;
}

async function selectSource(index: number, reveal: boolean, focus = false) {
    const reference = citations()[index];
    if (!reference) return;
    sourceIndex = index;
    if (reveal && (mode !== 'document' || getComputedStyle(byId('inspector')).display === 'none')) switchMode('sources');
    renderReferences(focus || reveal);
    if (!wiki) return;
    sourceLoad?.abort();
    const controller = new AbortController();
    sourceLoad = controller;
    try {
        const unit = await readApi<CodeUnit>('/locate', { projectId: wiki.projectId, file: reference.filePath,
            line: String(reference.startLine) }, controller.signal);
        if (controller.signal.aborted || unit.qualifiedName !== reference.qualifiedName) return;
        const offset = Math.max(0, reference.startLine - unit.startLine);
        currentExcerpt = { source: reference, start: unit.startLine + offset, lines: unit.rawSource.split('\n').slice(offset, offset + 12) };
        renderReferences();
    } catch {
        // The original citation remains available if the current index has moved on.
    }
}

function changeVariant(direction: number) {
    variant = variants[(variants.indexOf(variant) + direction + variants.length) % variants.length];
    history.replaceState(null, '', variantUrl());
    render();
    if (mode === 'document' && sectionIndex > 0) scrollToSection(sectionIndex, false);
}

function renderSearch() {
    const query = searchField.value.toLocaleLowerCase(language).trim();
    const results = byId('search-results');
    results.replaceChildren();
    for (const [index, section] of sections().entries()) {
        if (!`${section.title} ${section.body}`.toLocaleLowerCase(language).includes(query)) continue;
        const button = node('button', 'outline-button');
        button.append(icon('document'), node('span', '', section.title));
        button.addEventListener('click', () => { searchDialog.close(); selectSection(index); });
        results.append(button);
    }
    if (query) for (const [index, reference] of citations().entries()) {
        if (!`${reference.qualifiedName} ${reference.filePath}`.toLocaleLowerCase(language).includes(query)) continue;
        const button = node('button', 'outline-button');
        button.append(icon('code'), node('span', '', reference.qualifiedName));
        button.addEventListener('click', () => { searchDialog.close(); void selectSource(index, true); });
        results.append(button);
    }
    if (!results.childElementCount) results.append(node('p', '', t('noMatches')));
}

function openSearch() {
    if (searchDialog.open) return;
    searchField.value = '';
    renderSearch();
    searchDialog.showModal();
    searchField.focus();
}

async function loadDocument(requested: string | null, replaceUrl: boolean) {
    if (!project) return;
    documentLoad?.abort();
    const controller = new AbortController();
    documentLoad = controller;
    try {
        tree = await readApi<WikiNode[]>('/summaries/tree', { projectId: project }, controller.signal);
        const id = requested && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requested) ? requested : tree[0]?.id;
        if (!id) {
            dataLabel = 'noIndexedWiki';
            render();
            return;
        }
        const document = await readApi<SummaryDocument>(`/summaries/${id}`, { projectId: project }, controller.signal);
        if (controller.signal.aborted || document.projectId !== project) return;
        sourceLoad?.abort();
        currentExcerpt = undefined;
        wiki = document;
        sectionIndex = 0;
        sourceIndex = 0;
        dataLabel = 'indexedWiki';
        if (replaceUrl) history.replaceState(null, '', variantUrl());
        render();
        void selectSource(0, false);
    } catch (error) {
        if (controller.signal.aborted) return;
        if (wiki) notify('documentUnavailable');
        else {
            dataLabel = error instanceof Error && error.message === '401' ? 'signInRequired' : 'unavailable';
            render();
        }
    }
}

byId('previous-variant').addEventListener('click', () => changeVariant(-1));
byId('next-variant').addEventListener('click', () => changeVariant(1));
byId('previous-section').addEventListener('click', () => selectSection(sectionIndex - 1));
byId('next-section').addEventListener('click', () => selectSection(sectionIndex + 1));
narrowViewport.addEventListener('change', updateOutlineControl);
byId('toggle-outline').addEventListener('click', () => {
    if (variant === 'C' || mode !== 'document' || (variant === 'A' && narrowViewport.matches)) {
        switchMode(mode === 'outline' ? 'document' : 'outline');
    } else {
        outlineOpen = !outlineOpen;
        windowPane.dataset.outline = outlineOpen ? 'open' : 'closed';
        updateOutlineControl();
    }
});
for (const button of byId('reading-modes').querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
    button.addEventListener('click', () => switchMode(button.dataset.mode as ReadingMode));
}
byId('text-size').addEventListener('click', () => {
    const large = windowPane.dataset.large !== 'true';
    windowPane.dataset.large = String(large);
    byId('text-size').setAttribute('aria-pressed', String(large));
});
byId('copy-link').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(variantUrl().href);
        notify('copied');
    } catch { notify('copyFailed'); }
});
byId('open-search').addEventListener('click', openSearch);
byId('close-search').addEventListener('click', () => searchDialog.close());
searchField.addEventListener('input', renderSearch);
searchField.addEventListener('keydown', event => {
    if (event.key === 'Enter') byId('search-results').querySelector('button')?.click();
});
document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
    }
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || searchDialog.open
        || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]'))) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        changeVariant(event.key === 'ArrowLeft' ? -1 : 1);
    }
});

function localize() {
    setDocumentLanguage(language);
    document.title = t('title');
    for (const item of document.querySelectorAll<HTMLElement>('[data-text], [data-aria], [data-title], [data-placeholder]')) {
        if (item.dataset.text) item.textContent = t(item.dataset.text as Message);
        if (item.dataset.aria) item.setAttribute('aria-label', t(item.dataset.aria as Message));
        if (item.dataset.title) item.title = t(item.dataset.title as Message);
        if (item.dataset.placeholder) item.setAttribute('placeholder', t(item.dataset.placeholder as Message));
    }
    if (toastMessage) byId('feedback').textContent = t(toastMessage);
}

bindLanguageSwitch(next => {
    language = next;
    const position = paper.scrollTop;
    localize();
    render();
    paper.scrollTop = position;
    if (searchDialog.open) renderSearch();
});
localize();
render();
if (project) void loadDocument(initialParams.get('document'), false);
