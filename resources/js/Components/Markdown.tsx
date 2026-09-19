import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useMemo } from 'react';

interface MarkdownProps {
    content: string;
    className?: string;
}

marked.use({
    gfm: true,
    breaks: true,
});

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
    '[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-2.5 [&_blockquote]:my-2 [&_blockquote]:text-muted-foreground [&_blockquote]:break-words',
    '[&_a]:text-primary [&_a]:underline [&_a]:break-all',
    '[&_.markdown-table-wrapper]:overflow-x-auto [&_.markdown-table-wrapper]:my-2.5 [&_.markdown-table-wrapper]:rounded-xl [&_.markdown-table-wrapper]:border [&_.markdown-table-wrapper]:border-border/50 [&_.markdown-table-wrapper]:shadow-2xs',
    '[&_table]:w-full [&_table]:min-w-[480px] sm:[&_table]:min-w-full [&_table]:border-collapse [&_table]:text-[11px]',
    '[&_thead]:bg-muted/70 [&_thead]:text-foreground',
    '[&_th]:border-b [&_th]:border-border/60 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:whitespace-nowrap',
    '[&_td]:border-b [&_td]:border-border/30 [&_td]:px-3 [&_td]:py-1.5 [&_td]:whitespace-nowrap sm:[&_td]:whitespace-normal',
    '[&_tbody_tr:hover]:bg-muted/20',
    '[&_hr]:my-2 [&_hr]:border-border/60',
    '[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-1',
].join(' ');

export default function Markdown({ content, className }: MarkdownProps) {
    const html = useMemo(() => {
        let raw = marked.parse(content, { async: false }) as string;
        // Automatically wrap all <table> elements with a scrollable container
        raw = raw.replace(/<table([\s\S]*?)<\/table>/g, '<div class="markdown-table-wrapper"><table$1</table></div>');
        return typeof window !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
    }, [content]);

    return (
        <div
            className={[MARKDOWN_STYLES, className].filter(Boolean).join(' ')}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}