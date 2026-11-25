export type UiLanguage = 'en' | 'zh';

export function preference(key: string, value?: string) {
    const name = `repograph.${key}`;
    try {
        if (value !== undefined) localStorage.setItem(name, value);
        return localStorage.getItem(name);
    } catch { return null; }
}

export function preferredLanguage(): UiLanguage {
    const saved = preference('language');
    if (saved === 'en' || saved === 'zh') return saved;
    return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setDocumentLanguage(language: UiLanguage) {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-language]')) {
        const label = language === 'en' ? 'Switch to Chinese' : '切换为英文';
        button.setAttribute('aria-label', label);
        button.title = label;
        const name = button.querySelector('span')!;
        name.lang = language === 'en' ? 'zh-CN' : 'en';
        name.textContent = language === 'en' ? '中文' : 'English';
    }
}

export function bindLanguageSwitch(onChange: (language: UiLanguage) => void) {
    for (const button of document.querySelectorAll('[data-language]')) {
        button.addEventListener('click', () => {
            const language = document.documentElement.lang === 'zh-CN' ? 'en' : 'zh';
            preference('language', language);
            onChange(language);
        });
    }
}
