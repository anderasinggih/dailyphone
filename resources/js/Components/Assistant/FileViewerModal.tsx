import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    X,
    Search,
    ChevronUp,
    ChevronDown,
    Download,
    Trash2,
    Loader2,
    FileText,
    FileArchive,
    FileSpreadsheet,
    FileCode2,
    Image as ImageIcon,
} from 'lucide-react';

export interface ProjectFileNode {
    id: number;
    name: string;
    is_folder: boolean;
    kind: string;
    mime_type?: string | null;
    size_bytes?: number;
    created_at?: string;
    updated_at?: string;
    children: ProjectFileNode[];
}

interface FileViewerModalProps {
    projectId: number;
    file: ProjectFileNode;
    onClose: () => void;
    onDelete: (file: ProjectFileNode) => void;
}

export const LANG_LABELS: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', mjs: 'JavaScript', cjs: 'JavaScript',
    py: 'Python', php: 'PHP', go: 'Go', rb: 'Ruby', rs: 'Rust', java: 'Java', kt: 'Kotlin',
    cs: 'C#', c: 'C', h: 'C Header', cpp: 'C++', hpp: 'C++ Header', cc: 'C++', swift: 'Swift',
    dart: 'Dart', lua: 'Lua', pl: 'Perl', r: 'R', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
    sql: 'SQL', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
    json: 'JSON', xml: 'XML', yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI', cfg: 'Config',
    conf: 'Config', env: 'Env', gitignore: 'Gitignore', dockerfile: 'Dockerfile',
    md: 'Markdown', markdown: 'Markdown', txt: 'Text', log: 'Log', csv: 'CSV', tsv: 'TSV',
    vue: 'Vue', svelte: 'Svelte', graphql: 'GraphQL', proto: 'Protobuf', makefile: 'Makefile', ipynb: 'Notebook',
};

export const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const DELIMITERS = [',', '\t', ';', '|'] as const;

/**
 * Pick the separator a delimited-data blob most likely uses by counting how
 * many times each candidate shows up (ignoring quoted regions) on its first
 * non-empty line. Falls back to comma.
 */
function detectDelimiter(text: string): string {
    const line = (text.split(/\r?\n/).find(l => l.trim() !== '') ?? '').trim();
    let best = ',';
    let bestCount = 0;
    for (const d of DELIMITERS) {
        let count = 0;
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
                if (line[i + 1] === '"') { i++; continue; }
            } else if (ch === d && !inQuotes) {
                count++;
            }
        }
        if (count > bestCount) {
            bestCount = count;
            best = d;
        }
    }
    return best;
}

/**
 * Minimal RFC-4180-ish parser: honors quoted fields (embedded delimiters,
 * newlines and doubled `""` escapes) so the grid round-trips real CSVs.
 */
function parseDelimited(text: string): string[][] {
    const delimiter = detectDelimiter(text);
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(cell);
            cell = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell);
            cell = '';
            rows.push(row);
            row = [];
        } else {
            cell += ch;
        }
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

export default function FileViewerModal({ projectId, file, onClose, onDelete }: FileViewerModalProps) {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [searchOpen, setSearchOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [matchIdx, setMatchIdx] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isDelimited = extension === 'csv' || extension === 'tsv';
    const language = (LANG_LABELS[extension] ?? extension.toUpperCase()) || 'Text';
    const previewUrl = route('assistant.project.files.preview', [projectId, file.id]);
    const downloadUrl = route('assistant.project.files.download', [projectId, file.id]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        const fetchContent = async () => {
            try {
                const res = await fetch(route('assistant.project.files.content', [projectId, file.id]), {
                    headers: { 'Accept': 'application/json' },
                });
                if (!res.ok) throw new Error(`Failed to load content (${res.status})`);
                const data = await res.json();
                if (!cancelled) setContent(data.content ?? null);
            } catch (err: any) {
                if (!cancelled) setError(err?.message || 'Failed to load content.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        if (file.kind === 'image' || file.kind === 'pdf') {
            setLoading(false);
        } else {
            fetchContent();
        }

        return () => { cancelled = true; };
    }, [projectId, file.id, file.kind]);

    const Icon = file.kind === 'image' ? ImageIcon
        : file.kind === 'archive' ? FileArchive
        : file.kind === 'spreadsheet' ? FileSpreadsheet
        : file.kind === 'pdf' || file.kind === 'document' ? FileText
        : FileCode2;

    const codeLines = content !== null ? content.split('\n') : [];
    const gridRows = useMemo(() => (isDelimited && content ? parseDelimited(content) : []), [isDelimited, content]);

    const query = search.trim().toLowerCase();
    const matches = useMemo(() => {
        if (!query || gridRows.length === 0) return [];
        const out: number[] = [];
        gridRows.forEach((row, r) => {
            if (row.some(c => c.toLowerCase().includes(query))) out.push(r);
        });
        return out;
    }, [query, gridRows]);
    const activeRow = matches.length > 0 ? matches[Math.min(matchIdx, matches.length - 1)] : null;
    const totalMatches = matches.length;

    useEffect(() => {
        setMatchIdx(0);
    }, [search]);

    useEffect(() => {
        if (activeRow === null) return;
        rowRefs.current.get(activeRow)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [activeRow]);

    const toggleSearch = () => {
        setSearchOpen(o => {
            const next = !o;
            if (next) setTimeout(() => searchInputRef.current?.focus(), 10);
            return next;
        });
    };

    const goToMatch = (dir: 1 | -1) => {
        if (matches.length === 0) return;
        setMatchIdx(prev => (prev + dir + matches.length) % matches.length);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                toggleSearch();
                return;
            }
            if (e.key === 'Escape') {
                setSearchOpen(false);
                return;
            }
            if (searchOpen && e.key === 'Enter') {
                e.preventDefault();
                goToMatch(e.shiftKey ? -1 : 1);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchOpen, matches.length]);

    const highlightCellText = (text: string, rowIndex: number): ReactNode => {
        if (!query || !text.toLowerCase().includes(query)) return text;
        const lower = text.toLowerCase();
        const parts: ReactNode[] = [];
        let i = 0;
        while (i < text.length) {
            const idx = lower.indexOf(query, i);
            if (idx === -1) {
                parts.push(text.slice(i));
                break;
            }
            if (idx > i) parts.push(text.slice(i, idx));
            const isActive = activeRow === rowIndex;
            parts.push(
                <mark
                    key={parts.length}
                    className={`rounded-[3px] px-px text-white ${
                        isActive ? 'bg-primary' : 'bg-primary/40'
                    }`}
                >
                    {text.slice(idx, idx + query.length)}
                </mark>,
            );
            i = idx + query.length;
        }
        return parts;
    };

    const renderGrid = () => {
        if (gridRows.length === 0) return null;
        const cols = Math.max(...gridRows.map(r => r.length));
        const header = gridRows[0];

        return (
            <div className="flex-1 min-h-0 flex flex-col bg-[#0b0b0d]">
                {/* Toolbar */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/5 bg-[#0f1012]/95 backdrop-blur-xl shrink-0">
                    <button
                        type="button"
                        onClick={toggleSearch}
                        title="Search (⌘F / Ctrl+F)"
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10.5px] font-semibold transition ${
                            searchOpen
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                        }`}
                    >
                        <Search className="h-3.5 w-3.5" />
                        Search
                    </button>

                    {searchOpen && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-1.5 py-1 focus-within:border-primary/60">
                            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Find in table…"
                                className="w-40 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                            />
                            {search !== '' ? (
                                <>
                                    <span className="text-[9.5px] font-mono text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
                                        {matches.length === 0
                                            ? 'No matches'
                                            : `${matchIdx + 1}/${totalMatches}`}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => goToMatch(-1)}
                                        disabled={matches.length === 0}
                                        title="Previous match (Shift+Enter)"
                                        className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition"
                                    >
                                        <ChevronUp className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => goToMatch(1)}
                                        disabled={matches.length === 0}
                                        title="Next match (Enter)"
                                        className="p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition"
                                    >
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                </>
                            ) : null}
                        </div>
                    )}

                    <span className="ml-auto text-[9.5px] font-mono text-muted-foreground/70 select-none whitespace-nowrap">
                        {extension.toUpperCase()} · {gridRows.length} row{gridRows.length !== 1 ? 's' : ''} × {cols} col{cols !== 1 ? 's' : ''}
                    </span>
                </div>

                {/* Grid */}
                <div className="flex-1 min-h-0 overflow-auto scrollbar-thin pb-3">
                    <table className="w-full text-left text-[11.5px] font-mono border-collapse">
                        <thead>
                            <tr>
                                <th className="sticky top-0 z-20 px-2 py-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/70 bg-[#141518] border-b border-white/10 text-right select-none">
                                    #
                                </th>
                                {header.map((cell, c) => (
                                    <th
                                        key={c}
                                        title={cell}
                                        className="sticky top-0 z-20 px-2.5 py-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground bg-[#141518] border-b border-white/10 whitespace-nowrap min-w-[120px] max-w-[320px] truncate"
                                    >
                                        {cell === '' ? <span className="opacity-50">(empty)</span> : highlightCellText(cell, 0)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {gridRows.slice(1).map((row, i) => {
                                const r = i + 1;
                                const rowHasMatch = matches.includes(r);
                                const isActive = activeRow === r;
                                return (
                                    <tr
                                        key={r}
                                        data-row-key={r}
                                        ref={el => {
                                            if (el) rowRefs.current.set(r, el);
                                            else rowRefs.current.delete(r);
                                        }}
                                        className={`transition-colors border-b border-white/5 ${
                                            isActive ? 'bg-primary/10' : rowHasMatch ? 'bg-primary/[0.04] hover:bg-primary/[0.07]' : 'hover:bg-white/[0.03]'
                                        }`}
                                    >
                                        <td className="px-2 py-1 text-right text-[9.5px] text-neutral-600 select-none border-r border-white/5">
                                            {r}
                                        </td>
                                        {Array.from({ length: cols }, (_, c) => {
                                            const cell = row[c] ?? '';
                                            return (
                                                <td
                                                    key={c}
                                                    title={cell === '' ? '' : cell}
                                                    className="px-2.5 py-1 whitespace-nowrap min-w-[100px] max-w-[320px] truncate text-neutral-200 border-r border-white/5 last:border-r-0"
                                                >
                                                    {cell === '' ? (
                                                        <span className="text-neutral-700">-</span>
                                                    ) : (
                                                        highlightCellText(cell, r)
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const bodyClass = isDelimited
        ? 'flex-1 min-h-0 flex flex-col bg-[#0b0b0d]'
        : 'flex-1 min-h-0 overflow-y-auto bg-[#0b0b0d]';

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-black/55 backdrop-blur-sm animate-in fade-in-50 duration-150">
            <div className="w-full max-w-4xl max-h-[88dvh] flex flex-col rounded-2xl bg-card border border-border/70 shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50 shrink-0">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-foreground truncate">{file.name}</h3>
                        <p className="text-[10.5px] text-muted-foreground truncate">
                            {file.kind}{file.kind === 'text' || isDelimited ? ` · ${language}` : ''}
                            {file.size_bytes ? ` · ${formatBytes(file.size_bytes)}` : ''}
                        </p>
                    </div>
                    <a
                        href={downloadUrl}
                        title="Download file"
                        className="flex items-center gap-1.5 rounded-xl border border-border bg-background/70 hover:bg-muted/80 px-2.5 py-1.5 text-[11px] font-semibold text-foreground transition shrink-0"
                    >
                        <Download className="h-3.5 w-3.5 text-primary" />
                        <span className="hidden sm:inline">Download</span>
                    </a>
                    <button
                        type="button"
                        onClick={() => onDelete(file)}
                        title="Delete file"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        title="Close viewer"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition shrink-0"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className={bodyClass}>
                    {file.kind === 'image' ? (
                        <div className="min-h-[300px] h-full flex items-center justify-center p-4 bg-[repeating-conic-gradient(#1c1c1e_0%_25%,#141416_0%_50%)] bg-[size:24px_24px]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={previewUrl}
                                alt={file.name}
                                className="max-w-full max-h-[70dvh] rounded-xl shadow-2xl object-contain"
                            />
                        </div>
                    ) : file.kind === 'pdf' ? (
                        <iframe
                            src={previewUrl}
                            title={file.name}
                            className="w-full h-[70dvh] bg-[#2b2b2d]"
                        />
                    ) : loading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <span className="text-xs">Loading file content…</span>
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center py-16 text-[12px] text-destructive">
                            {error}
                        </div>
                    ) : content === null || content === '' ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground px-6">
                            <FileText className="h-6 w-6 opacity-60" />
                            <span className="text-xs text-center">
                                No readable text preview for this file type.
                            </span>
                            <a
                                href={downloadUrl}
                                className="mt-1 flex items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 text-[11px] font-semibold transition"
                            >
                                <Download className="h-3.5 w-3.5" />
                                Download to open
                            </a>
                        </div>
                    ) : isDelimited ? (
                        renderGrid()
                    ) : (
                        <div className="relative">
                            <div className="sticky top-0 left-0 right-0 z-10 px-4 py-1.5 border-b border-white/5 bg-[#0f1012]/95 backdrop-blur-xl text-[9.5px] font-mono text-muted-foreground/70 select-none">
                                {language} · {codeLines.length} line{codeLines.length !== 1 ? 's' : ''}
                            </div>
                            <div className="overflow-x-auto">
                                <pre className="text-[12px] leading-[1.55] font-mono text-neutral-200 py-3">
                                    {codeLines.map((line, i) => (
                                        <div key={i} className="flex px-2 hover:bg-white/[0.03]">
                                            <span className="w-10 pr-4 text-right shrink-0 select-none text-neutral-600">
                                                {i + 1}
                                            </span>
                                            <code className="whitespace-pre flex-1 pr-4">{line || ' '}</code>
                                        </div>
                                    ))}
                                </pre>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}