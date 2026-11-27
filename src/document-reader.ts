type ReadingMode = 'document' | 'outline' | 'sources';

export interface ReaderSource {
    label: string;
    location: string;
    filename?: string;
    description?: string;
    href?: string;
    open?: () => void;
    excerpt?: (signal: AbortSignal) => Promise<{ firstLine: number; lines: string[] } | undefined>;
}

interface ReaderSection {
    title: string;
    content: HTMLElement;
    references?: number[];
}

interface ReaderDocument {
    id: string;
    title: string;
    introduction?: string;
    metadata?: string;
    link?: string;
    sections: ReaderSection[];
    references: ReaderSource[];
}

interface ToolbarControls {
    storage: HTMLElement;
    picker: HTMLElement;
    actions: HTMLElement;
}

const modes = ['document', 'outline', 'sources'] as const;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

function button(label: string, action: () => void, visibleLabel = label) {
    const control = make('button', '', visibleLabel);
    control.type = 'button';
    if (visibleLabel !== label) {
        control.setAttribute('aria-label', label);
        control.title = label;
    }
    control.addEventListener('click', action);
    return control;
}

export class DocumentReader {
    private model?: ReaderDocument;
    private mode: ReadingMode = 'document';
    private section = 0;
    private reference = 0;
    private scrollTop = 0;
    private outlineOpen = true;
    private large = false;
    private sourceRequest?: AbortController;
    private paper?: HTMLElement;
    private outline?: HTMLElement;
    private references?: HTMLElement;
    private preview?: HTMLElement;
    private dialog?: HTMLDialogElement;
    private focusSearch?: HTMLInputElement;
    private headings: HTMLElement[] = [];
    private outlineItems: HTMLButtonElement[] = [];
    private sourceItems: HTMLButtonElement[] = [];
    private readonly resize = new ResizeObserver(() => this.syncView());
    private controls?: { previous: HTMLButtonElement; next: HTMLButtonElement; outline: HTMLButtonElement;
        modes: HTMLButtonElement[] };

    constructor(private readonly root: HTMLElement, private readonly t: (key: string) => string,
        private readonly toolbarControls?: ToolbarControls) {}

    suspend() {
        this.sourceRequest?.abort();
        this.sourceRequest = undefined;
        if (this.dialog?.open) this.dialog.close();
    }

    clear() {
        this.suspend();
        this.resize.disconnect();
        this.model = undefined;
        const controls = this.toolbarControls;
        if (controls) controls.storage.append(controls.picker, controls.actions);
        this.root.replaceChildren();
    }

    show(model: ReaderDocument) {
        this.suspend();
        if (this.model?.id !== model.id) {
            this.mode = 'document';
            this.section = this.reference = this.scrollTop = 0;
        } else if (this.mode === 'document' && this.paper?.getClientRects().length) {
            this.scrollTop = this.paper.scrollTop;
        }
        this.model = model;
        const { t } = this;
        const toolbar = make('header', 'document-toolbar');
        const capsule = make('div', 'document-capsule');
        capsule.setAttribute('role', 'group');
        capsule.setAttribute('aria-label', t('readerToolbar'));
        const outline = button(t('readerToggleOutline'), () => this.toggleOutline(), '');
        const outlineIcon = make('span', 'icon-panel');
        outlineIcon.setAttribute('aria-hidden', 'true');
        outline.append(outlineIcon);
        const previous = button(t('readerPrevious'), () => this.openSection(this.section - 1), '‹');
        const next = button(t('readerNext'), () => this.openSection(this.section + 1), '›');
        const search = button(t('readerSearch'), () => this.openSearch());
        search.className = 'document-search-trigger';
        const searchIcon = make('span', 'icon-search');
        searchIcon.setAttribute('aria-hidden', 'true');
        search.setAttribute('aria-label', t('readerSearch'));
        search.replaceChildren(searchIcon, make('span', 'document-search-label', t('readerSearch')),
            make('kbd', 'shortcut', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'));
        search.setAttribute('aria-haspopup', 'dialog');
        search.setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
        capsule.append(outline, previous, next, search);
        const actions = make('div', 'document-actions');
        const textSize = button(t('readerLargerText'), () => {
            this.large = !this.large;
            this.root.dataset.largeText = String(this.large);
            textSize.setAttribute('aria-pressed', String(this.large));
        }, 'Aa');
        textSize.setAttribute('aria-pressed', String(this.large));
        actions.append(textSize);
        const feedback = make('p', 'document-feedback');
        feedback.setAttribute('role', 'status');
        const link = model.link;
        if (link) {
            let feedbackTimer: number | undefined;
            const copy = button(t('readerCopyLink'), async () => {
                try {
                    await navigator.clipboard.writeText(new URL(link, location.href).href);
                    feedback.textContent = t('readerCopied');
                } catch {
                    feedback.textContent = t('readerCopyFailed');
                }
                window.clearTimeout(feedbackTimer);
                feedbackTimer = window.setTimeout(() => { feedback.textContent = ''; }, 4000);
            }, '');
            const icon = make('span', 'icon-link');
            icon.setAttribute('aria-hidden', 'true');
            copy.append(icon);
            actions.append(copy);
        }
        if (this.toolbarControls) {
            toolbar.append(this.toolbarControls.picker);
            actions.append(this.toolbarControls.actions);
        }
        toolbar.append(capsule, actions, feedback);

        const layout = make('div', 'document-layout');
        const paper = this.paper = make('article', 'document-paper');
        paper.setAttribute('aria-labelledby', this.root.id + '-title');
        paper.tabIndex = 0;
        const article = make('div', 'document-article');
        const title = make('h2', 'document-title', model.title);
        title.id = this.root.id + '-title';
        article.append(title);
        if (model.introduction) article.append(make('p', 'document-lede', model.introduction));
        if (model.metadata) article.append(make('p', 'document-metadata', model.metadata));
        this.headings = model.sections.map(({ title, content, references }, i) => {
            const section = make('section', 'document-section');
            const heading = make('h3', '', title);
            heading.id = this.root.id + '-section-' + i;
            heading.tabIndex = -1;
            section.setAttribute('aria-labelledby', heading.id);
            section.append(heading, content);
            if (references?.length) {
                const links = make('div', 'document-inline-references');
                for (const index of references) {
                    const reference = model.references[index];
                    if (reference) links.append(button(t('readerShowSource') + ' ' + reference.label,
                        () => this.openReference(index, true), String(index + 1)));
                }
                section.append(links);
            }
            article.append(section);
            return heading;
        });
        paper.append(article);
        paper.addEventListener('scroll', () => this.followReading());
        this.outline = make('nav', 'document-outline');
        this.outline.id = this.root.id + '-outline';
        this.outline.setAttribute('aria-label', t('readerOutline'));
        outline.setAttribute('aria-controls', this.outline.id);
        const list = make('ol', 'document-outline-list');
        this.outlineItems = model.sections.map(({ title }, i) => {
            const item = make('li', '');
            const entry = button(title, () => this.openSection(i));
            item.append(entry);
            list.append(item);
            return entry;
        });
        this.outline.append(make('h3', 'document-rail-title', t('readerOutline')), list);
        this.references = make('aside', 'document-sources');
        this.references.setAttribute('aria-label', t('readerSources'));
        this.references.append(make('h3', 'document-rail-title', t('readerSources')));
        const sources = make('ol', 'document-source-list');
        this.sourceItems = model.references.map((reference, index) => {
            const entry = make('li', '');
            const pick = button('', () => this.openReference(index, false));
            pick.append(make('span', 'document-reference-number', String(index + 1)),
                make('strong', 'document-reference-label', reference.label),
                make('span', 'document-reference-location mono', reference.location));
            pick.title = reference.location;
            entry.append(pick);
            sources.append(entry);
            return pick;
        });
        this.preview = make('div', 'document-source-preview');
        if (model.references.length) this.references.append(sources, this.preview);
        else this.references.append(make('p', 'document-cue', t('readerNoSources')));
        layout.append(this.outline, paper, this.references);

        const footer = make('footer', 'document-footer');
        const segmented = make('div', 'document-segments');
        segmented.setAttribute('role', 'group');
        segmented.setAttribute('aria-label', t('readerMode'));
        const labels = [t('readerDocument'), t('readerOutline'), t('readerSources')];
        const viewControls = modes.map((mode, i) => button(labels[i], () => this.switchMode(mode)));
        segmented.append(...viewControls);
        footer.append(segmented);
        this.controls = { previous, next, outline, modes: viewControls };
        this.dialog = this.makeSearch(model);
        this.root.replaceChildren(toolbar, layout, footer, this.dialog);
        this.root.dataset.largeText = String(this.large);
        this.syncView();
        this.resize.observe(this.root);
        if (this.mode === 'document') paper.scrollTop = this.scrollTop;
        this.renderSource();
    }

    openSearch() {
        if (!this.dialog || !this.focusSearch || !this.root.getClientRects().length) return false;
        if (!this.dialog.open) this.dialog.showModal();
        this.focusSearch.focus();
        return true;
    }

    private makeSearch(model: ReaderDocument) {
        const dialog = make('dialog', 'document-search');
        const form = make('form', 'document-search-bar');
        form.method = 'dialog';
        const label = make('label', 'sr-only', this.t('readerSearch'));
        const input = this.focusSearch = make('input', '');
        input.id = this.root.id + '-search';
        input.type = 'search';
        input.placeholder = this.t('readerSearchPlaceholder');
        label.htmlFor = input.id;
        label.id = input.id + '-label';
        dialog.setAttribute('aria-labelledby', label.id);
        const icon = make('span', 'icon-search');
        icon.setAttribute('aria-hidden', 'true');
        form.append(label, icon, input, button(this.t('close'), () => dialog.close(), 'Esc'));
        const results = make('div', 'document-search-results');
        results.id = input.id + '-results';
        results.setAttribute('role', 'listbox');
        results.setAttribute('aria-label', this.t('readerResults'));
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', results.id);
        input.autocomplete = 'off';
        const empty = make('p', 'document-search-empty', this.t('noResults'));
        empty.setAttribute('role', 'status');
        const help = make('footer', 'document-search-help');
        help.append(make('kbd', 'shortcut', '↑ ↓'), make('span', '', this.t('readerNavigate')),
            make('kbd', 'shortcut', '↵'), make('span', '', this.t('readerOpen')));
        let options: HTMLButtonElement[] = [];
        let selected = 0;
        const selectOption = (index: number, scroll = false) => {
            const option = options[index];
            if (!option) { input.removeAttribute('aria-activedescendant'); return; }
            options[selected]?.setAttribute('aria-selected', 'false');
            selected = index;
            option.setAttribute('aria-selected', 'true');
            input.setAttribute('aria-activedescendant', option.id);
            if (scroll) option.scrollIntoView({ block: 'nearest' });
        };
        const group = (title: string, kind: string, entries: { title: string; detail?: string; activate: () => void }[]) => {
            if (!entries.length) return;
            const group = make('div', 'document-search-group');
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', title);
            const heading = make('p', 'document-search-group-label', title);
            heading.setAttribute('aria-hidden', 'true');
            group.append(heading);
            for (const entry of entries) {
                const index = options.length;
                const option = button('', () => { dialog.close(); entry.activate(); });
                option.id = results.id + '-' + index;
                option.tabIndex = -1;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', 'false');
                const icon = make('span', 'nav-icon ' + kind);
                icon.setAttribute('aria-hidden', 'true');
                const text = make('span', 'document-search-option-label', entry.title);
                if (entry.detail) text.append(make('small', 'mono', entry.detail));
                option.append(icon, text);
                option.addEventListener('pointermove', () => selectOption(index));
                group.append(option);
                options.push(option);
            }
            results.append(group);
        };
        function match(query: string, value: string) { return value.toLocaleLowerCase().includes(query); }
        const render = () => {
            const query = input.value.trim().toLocaleLowerCase();
            options = [];
            results.replaceChildren();
            group(this.t('readerSections'), 'icon-wiki', model.sections.flatMap(({ title, content }, index) => match(query, title + ' ' + content.textContent)
                ? [{ title, activate: () => this.openSection(index) }] : []));
            if (query) group(this.t('readerSources'), 'icon-evidence', model.references.flatMap(({ label, location }, index) => match(query, label + ' ' + location)
                ? [{ title: label, detail: location, activate: () => this.openReference(index, true) }] : []));
            empty.hidden = options.length > 0;
            results.hidden = !empty.hidden;
            input.setAttribute('aria-expanded', String(empty.hidden));
            selectOption(0);
        };
        input.addEventListener('input', render);
        input.addEventListener('keydown', event => {
            if (!options.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
            event.preventDefault();
            const offset = event.key === 'ArrowDown' ? 1 : -1;
            selectOption((selected + offset + options.length) % options.length, true);
        });
        form.addEventListener('submit', event => { event.preventDefault(); options[selected]?.click(); });
        render();
        dialog.append(form, results, empty, help);
        return dialog;
    }

    private toggleOutline() {
        if (this.mode === 'outline') { this.switchMode('document'); return; }
        if (this.mode !== 'document') { this.switchMode('outline'); return; }
        if (this.outlineOpen && !this.outline?.getClientRects().length) { this.switchMode('outline'); return; }
        this.outlineOpen = !this.outlineOpen;
        this.syncView();
        if (this.outlineOpen && !this.outline?.getClientRects().length) this.switchMode('outline');
    }

    private switchMode(mode: ReadingMode) {
        if (this.mode === mode) return;
        if (this.mode === 'document' && this.paper) this.scrollTop = this.paper.scrollTop;
        this.mode = mode;
        this.syncView();
        if (mode === 'document' && this.paper) this.paper.scrollTop = this.scrollTop;
    }

    private syncView() {
        this.root.dataset.mode = this.mode;
        this.root.dataset.outline = this.outlineOpen ? 'open' : 'closed';
        if (!this.controls) return;
        this.controls.previous.disabled = this.section === 0;
        this.controls.next.disabled = this.section >= this.headings.length - 1;
        this.controls.outline.setAttribute('aria-pressed', String(!!this.outline?.getClientRects().length));
        this.controls.modes.forEach((control, index) => control.setAttribute('aria-pressed', String(modes[index] === this.mode)));
        this.outlineItems.forEach((entry, index) => {
            if (index === this.section) entry.setAttribute('aria-current', 'location');
            else entry.removeAttribute('aria-current');
        });
    }

    openSection(index: number) {
        const heading = this.headings[index], paper = this.paper;
        if (!heading || !paper) return;
        this.switchMode('document');
        this.section = index;
        paper.scrollTop += heading.getBoundingClientRect().top - paper.getBoundingClientRect().top - 16;
        this.scrollTop = paper.scrollTop;
        this.syncView();
        heading.focus({ preventScroll: true });
    }

    private followReading() {
        const paper = this.paper;
        if (this.mode !== 'document' || !paper || paper.scrollTop === this.scrollTop) return;
        this.scrollTop = paper.scrollTop;
        const top = paper.getBoundingClientRect().top + 24;
        this.section = Math.max(0, this.headings.findLastIndex(heading => heading.getBoundingClientRect().top <= top));
        this.syncView();
    }

    private openReference(index: number, focus: boolean) {
        this.reference = index;
        if (!this.references?.getClientRects().length) this.switchMode('sources');
        this.renderSource();
        if (focus) {
            const target = this.sourceItems[index];
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: 'nearest' });
        }
    }

    private renderSource() {
        this.sourceRequest?.abort();
        this.sourceRequest = undefined;
        const source = this.model?.references[this.reference], preview = this.preview;
        this.sourceItems.forEach((control, index) => control.setAttribute('aria-pressed', String(index === this.reference)));
        if (!source || !preview) return;
        const title = make('h4', '', source.label);
        preview.replaceChildren(title, make('p', 'mono document-source-path', source.location));
        if (source.description) preview.append(make('p', 'document-cue', source.description));
        const state = make('p', 'document-cue', source.excerpt ? this.t('load') : this.t('readerNoExcerpt'));
        state.setAttribute('role', 'status');
        preview.append(state);
        if (source.href) {
            const link = make('a', 'document-source-link', this.t('openSource'));
            link.href = source.href;
            link.addEventListener('click', event => {
                if (!source.open || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                source.open();
            });
            preview.append(link);
        }
        if (!source.excerpt) return;
        const controller = this.sourceRequest = new AbortController();
        void source.excerpt(controller.signal).then(result => {
            if (controller.signal.aborted) return;
            if (!result) { state.textContent = this.t('readerNoExcerpt'); return; }
            const frame = make('div', 'document-code-frame');
            const header = make('div', 'document-code-header');
            const filename = make('span', 'mono', source.filename || source.location);
            filename.title = source.location;
            const feedback = make('span', 'sr-only');
            feedback.setAttribute('role', 'status');
            const copy = button(this.t('copy'), async () => {
                try {
                    await navigator.clipboard.writeText(result.lines.join('\n'));
                    copy.textContent = this.t('copied');
                    feedback.textContent = this.t('copied');
                } catch {
                    feedback.className = 'document-copy-feedback';
                    feedback.textContent = this.t('copyFailed');
                }
            }, this.t('readerCopy'));
            header.append(filename, copy);
            const code = make('pre', 'document-source-code');
            code.tabIndex = 0;
            code.setAttribute('aria-label', this.t('readerExcerpt'));
            for (const [i, line] of result.lines.entries()) {
                const row = make('span', 'document-code-line');
                if (i === 0) row.classList.add('document-code-target');
                const number = make('span', 'document-line-number', String(result.firstLine + i));
                number.setAttribute('aria-hidden', 'true');
                row.append(number, make('code', '', line || ' '));
                code.append(row);
            }
            frame.append(header, code, feedback);
            state.replaceWith(frame);
        }).catch(() => {
            if (!controller.signal.aborted) state.textContent = this.t('readerExcerptFailed');
        });
    }
}
