import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface VisualizationViewerProps {
    content: string;
    streaming?: boolean;
    /** When true (visualization mode) a standalone HTML reply fills nearly the
     *  whole viewport so it reads as a full-screen interactive preview. */
    fill?: boolean;
}

marked.use({ gfm: true, breaks: true });

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

// Larger document typography for the visualization viewer (big panel, easy to
// read at a distance) while keeping the Apple HIG color system untouched.
const VIZ_MARKDOWN_STYLES = [
    'text-[14px] leading-relaxed break-words min-w-0 max-w-full',
    '[overflow-wrap:anywhere]',
    '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
    '[&_strong]:font-bold [&_strong]:text-primary',
    '[&_em]:italic',
    '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_li>p]:my-0 [&_li]:break-words',
    '[&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h4]:text-base [&_h5]:text-sm [&_h6]:text-sm',
    '[&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold',
    '[&_h1]:mt-5 [&_h2]:mt-4 [&_h3]:mt-3 [&_h1]:mb-1.5 [&_h2]:mb-1.5 [&_h3]:mb-1 [&_h4]:mt-2 [&_h5]:mt-2 [&_h6]:mt-2',
    '[&_h1]:tracking-tight [&_h2]:tracking-tight [&_h3]:tracking-tight',
    '[&_code]:bg-black/5 dark:[&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_code]:text-[12px] [&_code]:break-all',
    '[&_pre]:bg-[#0b0b0d] [&_pre]:rounded-xl [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:my-2.5 [&_pre]:max-w-full [&_pre]:text-neutral-200',
    '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-neutral-200 [&_pre_code]:break-all',
    '[&_.dp-code-wrap]:relative [&_.dp-code-wrap>pre]:pr-9',
    '[&_.dp-copy-code]:absolute [&_.dp-copy-code]:right-1.5 [&_.dp-copy-code]:top-1.5 [&_.dp-copy-code]:z-10 [&_.dp-copy-code]:flex [&_.dp-copy-code]:items-center [&_.dp-copy-code]:rounded-md [&_.dp-copy-code]:border [&_.dp-copy-code]:border-white/10 [&_.dp-copy-code]:bg-white/5 [&_.dp-copy-code]:px-1.5 [&_.dp-copy-code]:py-1 [&_.dp-copy-code]:text-neutral-400 [&_.dp-copy-code]:shadow-xs [&_.dp-copy-code]:transition [&_.dp-copy-code:hover]:text-white [&_.dp-copy-code:hover]:bg-white/10',
    '[&_.dp-copied]:text-emerald-400',
    '[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-muted-foreground [&_blockquote]:break-words',
    '[&_a]:text-primary [&_a]:underline [&_a]:break-all [&_a]:cursor-pointer [&_a:hover]:opacity-85 [&_a:hover]:decoration-primary/60',
    '[&_.markdown-table-wrapper]:overflow-x-auto [&_.markdown-table-wrapper]:my-3 [&_.markdown-table-wrapper]:rounded-xl [&_.markdown-table-wrapper]:border [&_.markdown-table-wrapper]:border-border/50 [&_.markdown-table-wrapper]:shadow-2xs',
    '[&_table]:w-full [&_table]:min-w-[560px] sm:[&_table]:min-w-full [&_table]:border-collapse [&_table]:text-[12.5px]',
    '[&_thead]:bg-muted/70 [&_thead]:text-foreground',
    '[&_th]:border-b [&_th]:border-border/60 [&_th]:px-3.5 [&_th]:py-2 [&_th]:font-semibold [&_th]:whitespace-nowrap',
    '[&_td]:border-b [&_td]:border-border/30 [&_td]:px-3.5 [&_td]:py-2 [&_td]:whitespace-nowrap sm:[&_td]:whitespace-normal',
    '[&_tbody_tr:hover]:bg-muted/20',
    '[&_hr]:my-3 [&_hr]:border-border/60',
    '[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-xl [&_img]:my-2',
    '[&_.viz-mermaid]:my-3 [&_.viz-mermaid]:rounded-xl [&_.viz-mermaid]:border [&_.viz-mermaid]:border-border/50 [&_.viz-mermaid]:bg-card [&_.viz-mermaid]:overflow-x-auto [&_.viz-mermaid]:p-3 [&_.viz-mermaid]:min-h-[60px]',
].join(' ');

// Remove internal AI payloads that are irrelevant to the visualized document.
function stripInternalBlocks(raw: string): string {
    return raw
        .replace(/```action_proposal[\s\S]*?```/g, '')
        .replace(/```ai_memo[\s\S]*?```/g, '')
        .trim();
}

// Detect a complete, self-contained HTML page inside the reply. Returns the
// extracted HTML when found (a full <!DOCTYPE html>/<html> document, optionally
// wrapped in a single ```html fence), otherwise null → the content is markdown.
function extractHtmlDocument(raw: string): string | null {
    const cleaned = stripInternalBlocks(raw);
    const trimmed = cleaned.trim();

    if (/^<!DOCTYPE html>/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
        return trimmed;
    }

    // A ```html fenced block that itself contains a full document.
    const fence = trimmed.match(/```html\s*\n([\s\S]*?)\n```/);
    if (fence && fence[1]) {
        const inner = fence[1].trim();
        if (/^<!DOCTYPE html>/i.test(inner) || /^<html[\s>]/i.test(inner)) {
            return inner;
        }
    }

    return null;
}

/** True when a reply is a full standalone HTML page (needs the big panel). */
export function isHtmlDocument(content: string): boolean {
    return extractHtmlDocument(content) !== null;
}

// Encode a mermaid diagram into a holder div that survives the full pipeline:
// marked (raw HTML passthrough) → DOMPurify (attributes are preserved).
function mermaidHolder(code: string): string {
    const encoded = btoa(unescape(encodeURIComponent(code)));
    return `<div class="viz-mermaid-holder" data-mermaid-src="${encoded}"><div class="viz-mermaid-loading">…</div></div>`;
}

// Wrap every <pre> block in a relative container and add a small copy button.
function enhanceCodeBlocks(html: string): string {
    return html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (_, attrs, inner) =>
        `<div class="dp-code-wrap"><button type="button" class="dp-copy-code" title="Copy code">${COPY_ICON}</button><pre${attrs}>${inner}</pre></div>`
    );
}

/**
 * Visualization viewer: renders one AI reply as a full document.
 * - Full standalone HTML pages are shown in a big interactive sandboxed iframe.
 * - Markdown is rendered with large document typography + mermaid graph support.
 */
export default function VisualizationViewer({ content, streaming = false, fill = false }: VisualizationViewerProps) {
    const rootRef = useRef<HTMLDivElement>(null);

    const htmlDoc = useMemo(() => extractHtmlDocument(content), [content]);
    const markdown = htmlDoc === null ? stripInternalBlocks(content) : '';

    // Swap every ```mermaid fence for a holder div before marked touches it, so
    // the raw diagram source is preserved verbatim (base64 in a data attribute).
    const markdownWithMermaidHolders = useMemo(() => {
        if (markdown === '') return '';
        return markdown.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_, code: string) => {
            const trimmedCode = code.replace(/\s+$/, '');
            return trimmedCode.trim() === '' ? '' : mermaidHolder(trimmedCode);
        });
    }, [markdown]);

    const html = useMemo(() => {
        if (markdownWithMermaidHolders === '') return '';
        let raw = marked.parse(markdownWithMermaidHolders, { async: false }) as string;
        raw = raw.replace(/<table([\s\S]*?)<\/table>/g, '<div class="markdown-table-wrapper"><table$1</table></div>');
        const cleansed = typeof window !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
        return enhanceCodeBlocks(cleansed);
    }, [markdownWithMermaidHolders]);

    // Delegated copy handler for code blocks (survives streaming re-renders).
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const copyText = (text: string) => {
            if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
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
            copyText(pre.textContent ?? '').catch(() => { /* clipboard unavailable */ });
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

    // Render every mermaid holder into an SVG once streaming settles.
    useEffect(() => {
        if (streaming || html === '') return;
        const root = rootRef.current;
        if (!root) return;

        const holders = Array.from(root.querySelectorAll<HTMLDivElement>('[data-mermaid-src]'));
        if (holders.length === 0) return;

        let cancelled = false;
        (async () => {
            const mermaid = (await import('mermaid')).default;
            mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' });
            for (const holder of holders) {
                if (cancelled) return;
                const encoded = holder.getAttribute('data-mermaid-src') ?? '';
                let code = '';
                try {
                    code = decodeURIComponent(escape(atob(encoded)));
                } catch {
                    continue; // malformed holder — skip
                }
                const id = 'viz-mermaid-' + Math.random().toString(36).slice(2, 9);
                try {
                    const { svg } = await mermaid.render(id, code);
                    if (!cancelled) {
                        holder.removeAttribute('data-mermaid-src');
                        holder.classList.remove('viz-mermaid-holder');
                        holder.classList.add('viz-mermaid');
                        holder.innerHTML = svg;
                    }
                } catch (e: any) {
                    if (!cancelled) {
                        holder.removeAttribute('data-mermaid-src');
                        holder.classList.remove('viz-mermaid-holder', 'viz-mermaid');
                        holder.classList.add('viz-mermaid');
                        holder.innerHTML = `<div class="text-[11px] text-destructive p-3 [overflow-wrap:anywhere]">Graph failed to render: ${DOMPurify.sanitize(String(e?.message || 'unknown error'))}</div>`;
                    }
                }
            }
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html, streaming]);

    // Interactive full-page HTML (charts, dashboards) rendered in a sandboxed
    // iframe so scripts run but stay isolated from the app itself. With `fill`
    // it takes over nearly the whole viewport (visualization mode).
    if (htmlDoc !== null) {
        return (
            <div className="relative rounded-xl border border-border/50 overflow-hidden bg-white">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/40">
                    <span className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70">
                        INTERACTIVE HTML PREVIEW
                    </span>
                    {streaming ? (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            streaming…
                        </span>
                    ) : (
                        <span className="text-[10px] text-muted-foreground">sandboxed</span>
                    )}
                </div>
                <iframe
                    title="Visualization HTML preview"
                    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                    srcDoc={htmlDoc || ''}
                    className={`w-full bg-white ${
                        fill
                            ? 'h-[calc(100dvh-150px)] min-h-[560px]'
                            : 'h-[65dvh] min-h-[420px]'
                    }`}
                />
            </div>
        );
    }

    if (html === '') {
        return null;
    }

    // While streaming, render the raw markdown as a wiper (fast, no graph work);
    // the full document (incl. mermaid SVGs) takes over once done.
    if (streaming) {
        return (
            <div ref={rootRef} className={[VIZ_MARKDOWN_STYLES, 'whitespace-pre-wrap light-wipe'].filter(Boolean).join(' ')}>
                {markdown}
            </div>
        );
    }

    return (
        <div ref={rootRef} className={[VIZ_MARKDOWN_STYLES, 'select-text'].filter(Boolean).join(' ')}>
            <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
}