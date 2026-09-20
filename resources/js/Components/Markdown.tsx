import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef } from 'react';

interface MarkdownProps {
    content: string;
    className?: string;
}

marked.use({
    gfm: true,
    breaks: true,
});

if (typeof window !== 'undefined') {
    DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
        if (node.tagName === 'A') {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
    });
}

const COPY_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

const CHECK_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const MARKDOWN_STYLES = [
    'text-xs leading-relaxed break-words min-w-0 max-w-full',
    '[overflow-wrap:anywhere]',
    '[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
    '[&_strong]:font-bold [&_strong]:text-primary',
    '[&_em]:italic',
    '[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_li>p]:my-0 [&_li]:break-words',
    '[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1 [&_h1]:tracking-tight [&_h2]:tracking-tight [&_h3]:tracking-tight [&_h1]:break-words [&_h2]:break-words [&_h3]:break-words',
    '[&_code]:bg-black/5 dark:[&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_code]:text-[10.5px] [&_code]:break-all',
    '[&_pre]:bg-black/5 dark:[&_pre]:bg-white/10 [&_pre]:rounded-xl [&_pre]:p-2.5 [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre]:max-w-full',
    '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:break-all',
    '[&_.dp-code-wrap]:relative [&_.dp-code-wrap>pre]:pr-8',
    '[&_.dp-copy-code]:absolute [&_.dp-copy-code]:right-1 [&_.dp-copy-code]:top-1 [&_.dp-copy-code]:z-10 [&_.dp-copy-code]:flex [&_.dp-copy-code]:items-center [&_.dp-copy-code]:rounded-md [&_.dp-copy-code]:border [&_.dp-copy-code]:border-border/60 [&_.dp-copy-code]:bg-card/90 [&_.dp-copy-code]:px-1.5 [&_.dp-copy-code]:py-1 [&_.dp-copy-code]:text-muted-foreground [&_.dp-copy-code]:shadow-xs [&_.dp-copy-code]:backdrop-blur-xl [&_.dp-copy-code]:transition [&_.dp-copy-code:hover]:text-primary [&_.dp-copy-code:hover]:bg-muted/70',
    '[&_.dp-copied]:text-primary',
    '[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-2.5 [&_blockquote]:my-2 [&_blockquote]:text-muted-foreground [&_blockquote]:break-words',
    '[&_a]:text-primary [&_a]:underline [&_a]:break-all [&_a]:cursor-pointer [&_a:hover]:opacity-85 [&_a:hover]:decoration-primary/60',
    '[&_.markdown-table-wrapper]:overflow-x-auto [&_.markdown-table-wrapper]:my-2.5 [&_.markdown-table-wrapper]:rounded-xl [&_.markdown-table-wrapper]:border [&_.markdown-table-wrapper]:border-border/50 [&_.markdown-table-wrapper]:shadow-2xs',
    '[&_table]:w-full [&_table]:min-w-[480px] sm:[&_table]:min-w-full [&_table]:border-collapse [&_table]:text-[11px]',
    '[&_thead]:bg-muted/70 [&_thead]:text-foreground',
    '[&_th]:border-b [&_th]:border-border/60 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:whitespace-nowrap',
    '[&_td]:border-b [&_td]:border-border/30 [&_td]:px-3 [&_td]:py-1.5 [&_td]:whitespace-nowrap sm:[&_td]:whitespace-normal',
    '[&_tbody_tr:hover]:bg-muted/20',
    '[&_hr]:my-2 [&_hr]:border-border/60',
    '[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-1',
].join(' ');

/**
 * Wrap every <pre> block in a relative container and add a small copy button
 * so users can grab code / JSON / action proposals from chat replies quickly.
 */
function enhanceCodeBlocks(raw: string): string {
    return raw.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (_, attrs, inner) =>
        `<div class="dp-code-wrap"><button type="button" class="dp-copy-code" title="Copy code">${COPY_ICON}</button><pre${attrs}>${inner}</pre></div>`
    );
}

export default function Markdown({ content, className }: MarkdownProps) {
    const rootRef = useRef<HTMLDivElement>(null);

    const html = useMemo(() => {
        let raw = marked.parse(content, { async: false }) as string;
        // Automatically wrap all <table> elements with a scrollable container
        raw = raw.replace(/<table([\s\S]*?)<\/table>/g, '<div class="markdown-table-wrapper"><table$1</table></div>');
        const cleansed = typeof window !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
        return enhanceCodeBlocks(cleansed);
    }, [content]);

    // Delegated copy handler: survives live streaming re-renders and keeps the
    // code blocks free of per-render data attributes.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const copyText = (text: string) => {
            if (navigator.clipboard?.writeText) {
                return navigator.clipboard.writeText(text);
            }
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
            } finally {
                document.body.removeChild(textarea);
            }
            return Promise.resolve();
        };

        const onClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const button = target.closest<HTMLButtonElement>('.dp-copy-code');
            if (!button || !root.contains(button)) return;

            const wrap = button.parentElement;
            const pre = wrap?.querySelector('pre');
            if (!pre) return;

            copyText(pre.textContent ?? '').catch(() => {
                // Clipboard unavailable — the button simply stays idle.
            });

            const original = button.innerHTML;
            button.classList.add('dp-copied');
            button.title = 'Copied!';
            button.innerHTML = CHECK_ICON;
            setTimeout(() => {
                button.innerHTML = original;
                button.classList.remove('dp-copied');
                button.title = 'Copy code';
            }, 1400);
        };

        root.addEventListener('click', onClick);
        return () => root.removeEventListener('click', onClick);
    }, []);

    return (
        <div
            ref={rootRef}
            className={[MARKDOWN_STYLES, className].filter(Boolean).join(' ')}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}