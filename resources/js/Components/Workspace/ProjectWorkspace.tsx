import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Check,
    ChevronRight,
    Download,
    File as FileIcon,
    FileArchive,
    FileCode2,
    FileSpreadsheet,
    FileText,
    Folder,
    FolderOpen,
    GitCompareArrows,
    Image as ImageIcon,
    Loader2,
    PanelLeft,
    PanelRight,
    RefreshCw,
    RotateCw,
    X,
} from 'lucide-react';
import { diffLines, diffStatsOf, DiffLine, DiffStats } from '@/lib/diff';
import { LANG_LABELS, formatBytes } from '@/Components/Assistant/FileViewerModal';

export interface WorkspaceProjectFile {
    id: number;
    name: string;
    is_folder: boolean;
    kind: string;
    mime_type?: string | null;
    size_bytes?: number;
    created_at?: string;
    updated_at?: string;
    change_type?: 'created' | 'modified' | null;
    changed_at?: string | null;
    children: WorkspaceProjectFile[];
}

interface FileData {
    content: string | null;
    previous: string | null;
    error?: string | null;
}

interface OpenTab {
    id: number;
    node: WorkspaceProjectFile;
    path: string;
    view: 'source' | 'diff';
    loading: boolean;
    data: FileData | null;
}

interface Props {
    projectId: number;
    projectTitle: string;
    onClose: () => void;
    refreshSignal?: number;
}

const PREVIEW_KINDS = new Set(['image', 'pdf']);

const csrfToken = (): string =>
    (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';

export default function ProjectWorkspace({ projectId, projectTitle, onClose, refreshSignal = 0 }: Props) {
    const [files, setFiles] = useState<WorkspaceProjectFile[]>([]);
    const [loadingTree, setLoadingTree] = useState(true);
    const [treeError, setTreeError] = useState<string | null>(null);
    const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());
    const [tabs, setTabs] = useState<OpenTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<number | null>(null);
    const [fileData, setFileData] = useState<Record<number, FileData>>({});
    const [stats, setStats] = useState<Record<number, DiffStats>>({});
    const [selectedChangeId, setSelectedChangeId] = useState<number | null>(null);
    const [showTree, setShowTree] = useState(true);
    const [showChanges, setShowChanges] = useState(true);
    const [isFetching, setIsFetching] = useState(false);

    const reloadTree = useCallback(async () => {
        setLoadingTree(true);
        setTreeError(null);
        try {
            const res = await fetch(route('assistant.project.files', projectId), {
                headers: { 'Accept': 'application/json' },
            });
            if (!res.ok) throw new Error(`Failed to load files (${res.status})`);
            const data = await res.json();
            setFiles(data.files ?? []);
        } catch (err: any) {
            setTreeError(err?.message || 'Failed to load project files.');
        } finally {
            setLoadingTree(false);
        }
    }, [projectId]);

    useEffect(() => {
        reloadTree();
    }, [reloadTree, refreshSignal]);

    const { flatFiles, pathOf, changedFiles } = useMemo(() => {
        const flat: WorkspaceProjectFile[] = [];
        const paths = new Map<number, string>();
        const walk = (nodes: WorkspaceProjectFile[], prefix: string) => {
            for (const n of nodes) {
                const p = prefix ? `${prefix}/${n.name}` : n.name;
                paths.set(n.id, p);
                if (n.is_folder) walk(n.children || [], p);
                else flat.push(n);
            }
        };
        walk(files, '');
        const changed = flat
            .filter(f => f.change_type === 'created' || f.change_type === 'modified')
            .sort((a, b) => (b.changed_at && a.changed_at ? b.changed_at.localeCompare(a.changed_at) : 0));
        return { flatFiles: flat, pathOf: paths, changedFiles: changed };
    }, [files]);

    const previewUrl = (id: number) => route('assistant.project.files.preview', [projectId, id]);
    const downloadUrl = (id: number) => route('assistant.project.files.download', [projectId, id]);

    const fileIconFor = (node: WorkspaceProjectFile) => {
        const k = node.kind;
        const Ic = k === 'image' ? ImageIcon
            : k === 'archive' ? FileArchive
            : k === 'spreadsheet' ? FileSpreadsheet
            : k === 'pdf' || k === 'document' ? FileText
            : FileCode2;
        return Ic;
    };

    const loadFile = useCallback(async (node: WorkspaceProjectFile): Promise<FileData | null> => {
        if (fileData[node.id]) return fileData[node.id];
        if (PREVIEW_KINDS.has(node.kind)) return null;

        try {
            const res = await fetch(route('assistant.project.files.content', [projectId, node.id]), {
                headers: { 'Accept': 'application/json' },
            });
            if (!res.ok) throw new Error(`Failed to load content (${res.status})`);
            const data = await res.json();
            const entry: FileData = {
                content: data.content ?? null,
                previous: data.previous_content ?? null,
            };
            setFileData(prev => ({ ...prev, [node.id]: entry }));
            if (node.change_type === 'modified' || node.change_type === 'created') {
                setStats(prev => ({ ...prev, [node.id]: diffStatsOf(diffLines(entry.previous, entry.content)) }));
            }
            return entry;
        } catch (err: any) {
            const entry: FileData = { content: null, previous: null, error: err?.message || 'Failed to load.' };
            setFileData(prev => ({ ...prev, [node.id]: entry }));
            return entry;
        }
    }, [fileData, projectId]);

    const openTab = useCallback(async (node: WorkspaceProjectFile) => {
        const existing = tabs.find(t => t.id === node.id);
        if (existing) {
            setActiveTabId(node.id);
            return;
        }

        const tab: OpenTab = {
            id: node.id,
            node,
            path: pathOf.get(node.id) ?? node.name,
            view: 'source',
            loading: !PREVIEW_KINDS.has(node.kind),
            data: null,
        };
        setTabs(prev => [...prev, tab]);
        setActiveTabId(node.id);
        setSelectedChangeId(node.change_type ? node.id : prev => prev);

        if (!PREVIEW_KINDS.has(node.kind)) {
            const data = await loadFile(node);
            setTabs(prev => prev.map(t => (t.id === node.id ? { ...t, loading: false, data } : t)));
        }
    }, [tabs, pathOf, loadFile]);

    const closeTab = (id: number, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setTabs(prev => {
            const next = prev.filter(t => t.id !== id);
            if (activeTabId === id && next.length > 0) {
                setActiveTabId(next[0].id);
            } else if (next.length === 0) {
                setActiveTabId(null);
            }
            return next;
        });
    };

    const toggleView = (id: number) => {
        setTabs(prev => prev.map(t => (t.id === id ? { ...t, view: t.view === 'source' ? 'diff' : 'source' } : t)));
    };

    const toggleFolder = (id: number) => {
        setOpenFolders(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const deleteFile = async (node: WorkspaceProjectFile) => {
        if (!window.confirm(`Delete "${node.name}"?`)) return;
        try {
            await fetch(route('assistant.project.files.destroy', [projectId, node.id]), {
                method: 'DELETE',
                headers: { 'X-CSRF-TOKEN': csrfToken() },
            });
            closeTab(node.id);
            setFileData(prev => {
                const next = { ...prev };
                delete next[node.id];
                return next;
            });
            setStats(prev => {
                const next = { ...prev };
                delete next[node.id];
                return next;
            });
            setSelectedChangeId(prev => (prev === node.id ? null : prev));
            await reloadTree();
        } catch (err: any) {
            alert('Failed to delete file: ' + (err?.message || 'unknown error'));
        }
    };

    const activeTab = tabs.find(t => t.id === activeTabId) ?? null;

    const renderTree = (nodes: WorkspaceProjectFile[], depth: number) => {
        return nodes.map(node => {
            const pad = { paddingLeft: `${Math.min(6 + depth * 13, 40)}px` };
            if (node.is_folder) {
                const open = openFolders.has(node.id);
                return (
                    <div key={node.id}>
                        <button
                            type="button"
                            onClick={() => toggleFolder(node.id)}
                            style={pad}
                            className="w-full flex items-center gap-1.5 py-1.5 rounded-lg text-xs text-foreground hover:bg-muted/60 transition text-left"
                        >
                            <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                            {open
                                ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                                : <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />}
                            <span className="truncate flex-1 min-w-0 font-medium">{node.name}</span>
                        </button>
                        {open && node.children && node.children.length > 0 && renderTree(node.children, depth + 1)}
                    </div>
                );
            }

            const Ic = fileIconFor(node);
            const isActive = activeTabId === node.id;
            return (
                <button
                    key={node.id}
                    type="button"
                    onClick={() => openTab(node)}
                    style={pad}
                    className={`w-full flex items-center gap-1.5 py-1.5 rounded-lg text-xs transition text-left group ${
                        isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted/60'
                    }`}
                    title={`${pathOf.get(node.id) ?? node.name} — click to open`}
                >
                    <Ic className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="truncate flex-1 min-w-0">{node.name}</span>
                    {node.change_type === 'created' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Created by AI" />
                    )}
                    {node.change_type === 'modified' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Modified by AI" />
                    )}
                </button>
            );
        });
    };

    const renderCode = (value: string) => {
        const lines = value.split('\n');
        return (
            <pre className="text-[12px] leading-[1.55] font-mono text-neutral-200">
                {lines.map((line, i) => (
                    <div key={i} className="flex px-2 hover:bg-white/[0.03]">
                        <span className="w-10 pr-4 text-right shrink-0 select-none text-neutral-600">{i + 1}</span>
                        <code className="whitespace-pre flex-1 pr-4">{line || ' '}</code>
                    </div>
                ))}
            </pre>
        );
    };

    const renderDiff = (diffs: DiffLine[], compact = false) => (
        <pre className={`font-mono text-neutral-200 ${compact ? 'text-[11px] leading-[1.5]' : 'text-[12px] leading-[1.55]'}`}>
            {diffs.map((line, i) => (
                <div
                    key={i}
                    className={`flex px-2 ${
                        line.type === 'add' ? 'bg-emerald-500/[0.09]' :
                        line.type === 'del' ? 'bg-rose-500/[0.09]' :
                        'hover:bg-white/[0.03]'
                    }`}
                >
                    <span className={`w-8 pr-2 text-right shrink-0 select-none ${line.type === 'add' ? 'text-emerald-500' : line.type === 'del' ? 'text-rose-500' : 'text-neutral-600'}`}>
                        {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                    </span>
                    <span className="w-10 pr-3 shrink-0 select-none text-right text-neutral-600 opacity-60">
                        {line.type === 'add' ? (line.newLine ?? '') : line.type === 'del' ? (line.oldLine ?? '') : `L${line.newLine ?? ''}`}
                    </span>
                    <code className="whitespace-pre flex-1 pr-4 text-neutral-200">{line.value || ' '}</code>
                </div>
            ))}
        </pre>
    );

    const renderEditorBody = (tab: OpenTab) => {
        if (PREVIEW_KINDS.has(tab.node.kind)) {
            const Preview = tab.node.kind === 'image' ? (
                <div className="flex-1 min-h-0 flex items-center justify-center p-4 bg-[repeating-conic-gradient(#1c1c1e_0%_25%,#141416_0%_50%)] bg-[size:24px_24px] overflow-auto">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl(tab.node.id)} alt={tab.node.name} className="max-w-full max-h-full rounded-xl object-contain" />
                </div>
            ) : (
                <iframe src={previewUrl(tab.node.id)} title={tab.node.name} className="flex-1 min-h-0 w-full bg-[#2b2b2d]" />
            );
            return (
                <div className="flex-1 min-h-0 flex flex-col">
                    <TabMetaBar tab={tab} pathOf={pathOf} />
                    <div className="flex-1 min-h-0 flex flex-col">{Preview}</div>
                </div>
            );
        }

        if (tab.loading) {
            return (
                <div className="flex-1 min-h-0 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-xs">Loading file content…</span>
                </div>
            );
        }

        if (tab.data?.error) {
            return (
                <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-destructive px-6">
                    {tab.data.error}
                </div>
            );
        }

        const content = tab.data?.content;
        if (content === null || content === undefined || content === '') {
            return (
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-muted-foreground px-6">
                    <FileText className="h-6 w-6 opacity-60" />
                    <span className="text-xs text-center">No readable text preview for this file type.</span>
                    <a href={downloadUrl(tab.node.id)} className="mt-1 flex items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 text-[11px] font-semibold transition">
                        <Download className="h-3.5 w-3.5" /> Download to open
                    </a>
                </div>
            );
        }

        const hasChange = tab.node.change_type === 'modified' || tab.node.change_type === 'created';
        const stat = stats[tab.node.id];
        const diffs = tab.view === 'diff' && hasChange
            ? diffLines(tab.data?.previous ?? null, content)
            : null;

        return (
            <div className="flex-1 min-h-0 flex flex-col">
                <TabMetaBar tab={tab} pathOf={pathOf} onToggleDiff={hasChange ? () => toggleView(tab.id) : undefined} />
                <div className="flex-1 min-h-0 overflow-auto bg-[#0b0b0d]">
                    {diffs ? renderDiff(diffs) : renderCode(content)}
                </div>
            </div>
        );
    };

    const editorInfo = activeTab
        ? stats[activeTab.id]
        : null;

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-background md:bg-card relative">
            {/* Top bar */}
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border/50 shrink-0 bg-card/80 backdrop-blur-xl">
                <button
                    type="button"
                    onClick={onClose}
                    title="Back to chat"
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Chat</span>
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <FileCode2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-xs font-semibold text-foreground truncate">{projectTitle}</span>
                        <span className="text-[10px] text-muted-foreground/70 shrink-0 hidden sm:inline">Workspace</span>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setShowTree(v => !v)}
                    title={showTree ? 'Hide files' : 'Show files'}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                        showTree ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                    }`}
                >
                    <PanelLeft className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">Files</span>
                </button>
                <button
                    type="button"
                    onClick={() => setShowChanges(v => !v)}
                    title={showChanges ? 'Hide changes' : 'Show changes'}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                        showChanges ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                    }`}
                >
                    <PanelRight className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">Changes</span>
                    {changedFiles.length > 0 && (
                        <span className="ml-0.5 rounded-full bg-primary/15 text-primary px-1.5 py-px text-[9.5px] font-bold">
                            {changedFiles.length}
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => reloadTree()}
                    title="Refresh files"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Body: 3 columns */}
            <div className="flex-1 min-h-0 flex relative">
                {/* Col 1: Explorer */}
                <aside
                    className={`absolute inset-y-0 left-0 z-30 md:static md:z-auto flex flex-col bg-card/95 backdrop-blur-xl border-r border-border/40 transition-all duration-200 overflow-hidden ${
                        showTree ? 'w-60 md:w-64' : 'w-0 border-none'
                    }`}
                >
                    <div className="px-3 py-2.5 border-b border-border/40 shrink-0">
                        <div className="text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground/60">EXPLORER</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                            {flatFiles.length} file{flatFiles.length !== 1 ? 's' : ''}
                            {changedFiles.length > 0 && ` · ${changedFiles.length} changed`}
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto py-1.5 px-1 space-y-0.5">
                        {loadingTree ? (
                            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                <span className="text-[11px]">Loading…</span>
                            </div>
                        ) : treeError ? (
                            <p className="text-[11px] text-destructive px-3 py-6">{treeError}</p>
                        ) : files.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground text-center py-10 px-3">
                                No files yet. Upload them from the chat sidebar, or ask the AI to generate them with a Python run.
                            </p>
                        ) : (
                            renderTree(files, 0)
                        )}
                    </div>
                </aside>

                {/* Col 2: Editor */}
                <div className="flex-1 min-w-0 flex flex-col relative">
                    {tabs.length === 0 ? (
                        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-muted-foreground px-6">
                            <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                                <FileCode2 className="h-5 w-5" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-semibold text-foreground">{projectTitle}</p>
                                <p className="text-[11px] mt-1">Pick a file from the explorer to preview it.</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
                                {changedFiles.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => openTab(changedFiles[0])}
                                        className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 text-amber-600 dark:text-amber-400 px-3 py-1.5 text-[11px] font-semibold transition active:scale-95"
                                    >
                                        <GitCompareArrows className="h-3.5 w-3.5" />
                                        Review {changedFiles.length} changed file{changedFiles.length !== 1 ? 's' : ''}
                                    </button>
                                )}
                                <span className="text-[10px] text-muted-foreground/70">
                                    {changedFiles.length === 0
                                        ? 'No AI changes yet — run a Python action from the chat to see files appear here.'
                                        : 'AI changes are shown in the Changes panel.'}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Tabs bar */}
                            <div className="flex items-end gap-0.5 px-2 pt-1.5 border-b border-border/50 bg-card/95 backdrop-blur-xl shrink-0 overflow-x-auto scrollbar-thin">
                                {tabs.map(t => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => {
                                            setActiveTabId(t.id);
                                            const n = flatFiles.find(f => f.id === t.id);
                                            if (n?.change_type) setSelectedChangeId(t.id);
                                        }}
                                        className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg text-[11px] font-medium transition shrink-0 border-x border-t ${
                                            activeTabId === t.id
                                                ? 'bg-background dark:bg-card text-foreground border-border/70 border-b-background dark:border-b-card'
                                                : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/40'
                                        }`}
                                        title={t.path}
                                    >
                                        {t.loading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                                        {(t.node.change_type === 'modified' || t.node.change_type === 'created') && (
                                            <span className={`h-1.5 w-1.5 rounded-full ${t.node.change_type === 'created' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                        )}
                                        <span className="max-w-[140px] truncate">{t.node.name}</span>
                                        <span
                                            role="button"
                                            tabIndex={-1}
                                            onClick={e => closeTab(t.id, e)}
                                            className="p-0.5 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition"
                                            title="Close tab"
                                        >
                                            <X className="h-3 w-3" />
                                        </span>
                                    </button>
                                ))}
                                <div className="flex-1" />
                            </div>

                            {/* Editor body */}
                            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                                {activeTab ? renderEditorBody(activeTab) : null}
                            </div>
                        </>
                    )}
                </div>

                {/* Col 3: Changes */}
                <aside
                    className={`absolute inset-y-0 right-0 z-30 md:static md:z-auto flex flex-col bg-card/95 backdrop-blur-xl border-l border-border/40 transition-all duration-200 overflow-hidden ${
                        showChanges ? 'w-72' : 'w-0 border-none'
                    }`}
                >
                    <div className="px-3 py-2.5 border-b border-border/40 shrink-0 flex items-center justify-between">
                        <div>
                            <div className="text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground/60">CHANGES</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                                {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} changed by AI
                            </div>
                        </div>
                        {changedFiles.length > 0 && (
                            <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-bold">
                                {changedFiles.length}
                            </span>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
                        {changedFiles.length === 0 ? (
                            <div className="text-center py-10 px-4">
                                <div className="mx-auto h-9 w-9 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground/60 mb-2">
                                    <GitCompareArrows className="h-4 w-4" />
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                    Nothing changed yet. When the AI generates or edits a project file, it will show up here with a diff.
                                </p>
                            </div>
                        ) : (
                            <>
                                {changedFiles.map(f => {
                                    const st = stats[f.id];
                                    const isSelected = selectedChangeId === f.id;
                                    const Ic = f.kind === 'image' ? ImageIcon
                                        : f.kind === 'archive' ? FileArchive
                                        : f.kind === 'spreadsheet' ? FileSpreadsheet
                                        : FileText;
                                    return (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => { setSelectedChangeId(f.id); openTab(f); }}
                                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition ${
                                                isSelected ? 'bg-primary/10' : 'hover:bg-muted/60'
                                            }`}
                                        >
                                            <span
                                                className={`h-4 w-4 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${
                                                    f.change_type === 'created'
                                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                                }`}
                                                title={f.change_type === 'created' ? 'Created by AI' : 'Modified by AI'}
                                            >
                                                {f.change_type === 'created' ? 'A' : 'M'}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[11px] font-medium text-foreground truncate">{f.name}</div>
                                                <div className="text-[9.5px] font-mono text-muted-foreground/60 truncate">
                                                    {pathOf.get(f.id)}
                                                </div>
                                            </div>
                                            {st && (
                                                <span className="font-mono text-[9.5px] shrink-0">
                                                    <span className="text-emerald-600 dark:text-emerald-400">+{st.additions}</span>{' '}
                                                    <span className="text-rose-600 dark:text-rose-400">-{st.deletions}</span>
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </>
                        )}
                    </div>

                    {/* Diff preview of the selected changed file */}
                    {selectedChangeId !== null && (() => {
                        const f = changedFiles.find(c => c.id === selectedChangeId);
                        const data = fileData[selectedChangeId];
                        if (!f || !data || data.content === null) return (
                            <div className="shrink-0 border-t border-border/40 px-3 py-2.5 text-[10.5px] text-muted-foreground">
                                {data?.error ? data.error : 'Loading content…'}
                            </div>
                        );
                        const diffs = diffLines(data.previous, data.content);
                        const st = diffStatsOf(diffs);
                        return (
                            <div className="shrink-0 max-h-64 overflow-y-auto border-t border-border/40 bg-card">
                                <div className="sticky top-0 z-10 px-3 py-1.5 border-b border-border/40 bg-card/95 backdrop-blur-xl flex items-center justify-between text-[10.5px]">
                                    <span className="font-semibold text-foreground truncate max-w-[140px]">{f.name}</span>
                                    <span className="font-mono">
                                        <span className="text-emerald-600 dark:text-emerald-400">+{st.additions}</span>{' '}
                                        <span className="text-rose-600 dark:text-rose-400">-{st.deletions}</span>
                                    </span>
                                </div>
                                <div className="overflow-auto">
                                    {renderDiff(diffs, true)}
                                </div>
                            </div>
                        );
                    })()}
                </aside>
            </div>
        </div>
    );
}

function TabMetaBar({
    tab,
    pathOf,
    onToggleDiff,
}: {
    tab: OpenTab;
    pathOf: Map<number, string>;
    onToggleDiff?: () => void;
}) {
    const extension = tab.node.name.split('.').pop()?.toLowerCase() ?? '';
    const language = LANG_LABELS[extension] ?? (extension.toUpperCase() || 'Text');
    return (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-white/5 bg-[#101114]/95 backdrop-blur-xl text-[9.5px] font-mono text-muted-foreground/70 select-none">
            <span className="truncate max-w-[260px]">{pathOf.get(tab.id) ?? tab.node.name}</span>
            <span className="text-primary/70">{language}</span>
            {tab.node.size_bytes ? <span>· {formatBytes(tab.node.size_bytes)}</span> : null}
            {tab.node.change_type === 'modified' && (
                <span className="text-amber-500/90 font-semibold">· AI-MODIFIED</span>
            )}
            {tab.node.change_type === 'created' && (
                <span className="text-emerald-500/90 font-semibold">· AI-CREATED</span>
            )}
            <span className="flex-1" />
            {onToggleDiff && (
                <button
                    type="button"
                    onClick={onToggleDiff}
                    className={`flex items-center gap-1 rounded-md px-1.5 py-1 font-bold transition ${
                        tab.view === 'diff'
                            ? 'bg-primary/15 text-primary'
                            : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                    }`}
                >
                    <GitCompareArrows className="h-3 w-3" />
                    {tab.view === 'diff' ? 'Source' : 'Diff'}
                </button>
            )}
            <a
                href={route('assistant.project.files.download', [tab.node.id ? 0 : 0, tab.id])}
                onClick={(e) => e.preventDefault()}
                className="opacity-0 pointer-events-none h-0 w-0"
                aria-hidden="true"
            />
        </div>
    );
}