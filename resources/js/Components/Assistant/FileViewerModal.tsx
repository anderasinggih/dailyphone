import { useEffect, useState } from 'react';
import {
    X,
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

const LANG_LABELS: Record<string, string> = {
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

const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

export default function FileViewerModal({ projectId, file, onClose, onDelete }: FileViewerModalProps) {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
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
                            {file.kind}{file.kind === 'text' ? ` · ${language}` : ''}
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
                <div className="flex-1 min-h-0 overflow-y-auto bg-[#0b0b0d]">
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