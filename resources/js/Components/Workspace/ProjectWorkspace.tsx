import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    Check,
    ChevronRight,
    Copy,
    Download,
    File as FileIcon,
    FileArchive,
    FileCode2,
    FileSpreadsheet,
    FileText,
    Folder,
    FolderOpen,
    GitBranch,
    GitCommitHorizontal,
    GitCompareArrows,
    History,
    Image as ImageIcon,
    Loader2,
    MessageSquare,
    PanelLeft,
    PanelRight,
    Pencil,
    RefreshCw,
    Trash2,
    Unplug,
    X,
} from 'lucide-react';
import GithubMark from '@/Components/GithubMark';
import { diffLines, diffStatsOf, DiffLine, DiffStats } from '@/lib/diff';
import { LANG_LABELS, formatBytes } from '@/Components/Assistant/FileViewerModal';
import { tokenizeCode, tokensToLines, TOKEN_CLASS, languageFromName, Token } from '@/lib/highlight';

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

interface RepoCommit {
    hash: string;
    short: string;
    author: string;
    email: string;
    date: string;
    subject: string;
}

interface RepoCommitFile {
    status: string;
    path: string;
}

interface RepoCommitDetail extends RepoCommit {
    files: RepoCommitFile[];
    diff: string;
}

interface Props {
    projectId: number;
    projectTitle: string;
    onClose: () => void;
    refreshSignal?: number;
    // IDE split mode: the parent pages the chat column beside the workspace,
    // so the top bar can toggle its visibility.
    chatPaneOpen?: boolean;
    onToggleChatPane?: () => void;
    // Git repo backing: when repoUrl is set the workspace can commit & push
    // its changes back to the remote repository.
    repoUrl?: string | null;
    repoBranch?: string | null;
    repoError?: string | null;
    repoWorking?: 'commit' | 'pull' | 'connect' | null;
    onConnectRepo?: () => void;
    onCommitRepo?: () => void;
    onPullRepo?: () => void;
    onDisconnectRepo?: () => void;
}

const PREVIEW_KINDS = new Set(['image', 'pdf']);

// Internal drag payloads. A drag leaving the workspace onto the chat pane uses
// `application/x-project-file` (index.tsx turns it into an @mention); the
// workspace tree uses `application/x-workspace-move` for folder destinations.
const DRAG_FILE = 'application/x-project-file';
const DRAG_MOVE = 'application/x-workspace-move';

const csrfToken = (): string =>
    (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Flat walk helpers so rename/move/tab reconciliation stays simple.
const walkTree = (nodes: WorkspaceProjectFile[], prefix = '') => {
    const flat: WorkspaceProjectFile[] = [];
    const paths = new Map<number, string>();
    const recurse = (list: WorkspaceProjectFile[], pfx: string) => {
        for (const n of list) {
            const p = pfx ? `${pfx}/${n.name}` : n.name;
            paths.set(n.id, p);
            flat.push(n);
            if (n.is_folder) recurse(n.children || [], p);
        }
    };
    recurse(nodes, prefix);
    return { flatFiles: flat, paths };
};

interface ContextMenuState {
    x: number;
    y: number;
    node: WorkspaceProjectFile;
}

export default function ProjectWorkspace({ projectId, projectTitle, onClose, refreshSignal = 0, chatPaneOpen = true, onToggleChatPane, repoUrl = null, repoBranch = null, repoError = null, repoWorking = null, onConnectRepo, onCommitRepo, onPullRepo, onDisconnectRepo }: Props) {
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
    // Bumped each time the tree finishes loading, so the persisted-tab restorer
    // only runs once the fresh tree is available.
    const [treeLoaded, setTreeLoaded] = useState(0);
    // Right rail mode: the live AI diff vs. the repo commit history.
    const [rightPanel, setRightPanel] = useState<'changes' | 'commits'>('changes');
    // User edit mode: per-file dirty buffers plus which tab is being edited.
    const [editingContent, setEditingContent] = useState<Record<number, string>>({});
    const [editingFileId, setEditingFileId] = useState<number | null>(null);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const editAreaRef = useRef<HTMLTextAreaElement>(null);
    const editGutterRef = useRef<HTMLDivElement>(null);
    const [gitMenuOpen, setGitMenuOpen] = useState(false);

    // ── IDE chrome: resizable panels persisted across reloads ──
    const STORAGE_KEY = `dailyphone-workspace-${projectId}`;
    const [treeWidth, setTreeWidth] = useState(256);
    const [rightWidth, setRightWidth] = useState(292);
    const [resizing, setResizing] = useState(false);
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
    );
    // Open tabs persisted across reloads, restored once the tree lands.
    const pendingRestoreRef = useRef<{ ids: number[]; views: Record<number, OpenTab['view']>; active: number | null } | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mq = window.matchMedia('(max-width: 767px)');
        const onChange = () => setIsMobile(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    // Restore persisted workspace chrome on mount / project switch.
    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (typeof p.treeWidth === 'number') setTreeWidth(clamp(p.treeWidth, 176, 480));
            if (typeof p.rightWidth === 'number') setRightWidth(clamp(p.rightWidth, 208, 560));
            if (typeof p.showTree === 'boolean') setShowTree(p.showTree);
            if (typeof p.showChanges === 'boolean') setShowChanges(p.showChanges);
            if (p.rightPanel === 'changes' || p.rightPanel === 'commits') setRightPanel(p.rightPanel);
            if (Array.isArray(p.openFolders)) setOpenFolders(new Set(p.openFolders.filter((x: unknown) => typeof x === 'number')));
            if (Array.isArray(p.tabs)) {
                const ids: number[] = [];
                const views: Record<number, OpenTab['view']> = {};
                for (const t of p.tabs as Array<{ id?: unknown; view?: unknown }>) {
                    if (t && typeof t.id === 'number') {
                        ids.push(t.id);
                        if (t.view === 'diff' || t.view === 'source') views[t.id] = t.view;
                    }
                }
                pendingRestoreRef.current = {
                    ids,
                    views,
                    active: typeof p.activeTabId === 'number' ? p.activeTabId : null,
                };
            }
        } catch {
            // Corrupt or unavailable storage — start fresh.
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId]);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                treeWidth,
                rightWidth,
                showTree,
                showChanges,
                rightPanel,
                openFolders: [...openFolders],
                tabs: tabs.map(t => ({ id: t.id, view: t.view })),
                activeTabId,
            }));
        } catch {
            // Storage may be disabled; the workspace still works without it.
        }
    }, [STORAGE_KEY, treeWidth, rightWidth, showTree, showChanges, rightPanel, openFolders, tabs, activeTabId]);

    const startResize = (side: 'left' | 'right') => (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startLeft = treeWidth;
        const startRight = rightWidth;
        setResizing(true);
        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            if (side === 'left') setTreeWidth(clamp(startLeft + dx, 176, 520));
            else setRightWidth(clamp(startRight - dx, 208, 620));
        };
        const onUp = () => {
            setResizing(false);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // ── File tree ──
    const reloadTree = useCallback(async () => {
        setLoadingTree(true);
        setTreeError(null);
        try {
            const res = await fetch(route('assistant.project.files', projectId), {
                headers: { 'Accept': 'application/json' },
            });
            if (!res.ok) throw new Error(`Failed to load files (${res.status})`);
            const data = await res.json();
            const nodes = data.files ?? [];
            setFiles(nodes);
            if (pendingRestoreRef.current) setTreeLoaded(v => v + 1);
        } catch (err: any) {
            setTreeError(err?.message || 'Failed to load project files.');
        } finally {
            setLoadingTree(false);
        }
    }, [projectId]);

    useEffect(() => {
        reloadTree();
    }, [reloadTree, refreshSignal]);

    const { flatFiles, paths: pathOf } = useMemo(() => walkTree(files), [files]);

    const changedFiles = useMemo(() => flatFiles
        .filter(f => f.change_type === 'created' || f.change_type === 'modified')
        .sort((a, b) => (b.changed_at && a.changed_at ? b.changed_at.localeCompare(a.changed_at) : 0)), [flatFiles]);

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

    // Re-open persisted tabs once the tree is in — VS Code keeps the editor
    // strip, so the workspace should survive a refresh without resetting to empty.
    const restoreTabs = useCallback(async (
        nodes: WorkspaceProjectFile[],
        pending: { ids: number[]; views: Record<number, OpenTab['view']>; active: number | null },
    ) => {
        const walked = walkTree(nodes);
        const flat = walked.flatFiles;
        const next: OpenTab[] = [];
        for (const id of pending.ids) {
            const node = flat.find(f => f.id === id);
            if (!node) continue;
            next.push({
                id: node.id,
                node,
                path: walked.paths.get(node.id) ?? node.name,
                view: pending.views[node.id] ?? (node.change_type ? 'diff' : 'source'),
                loading: !PREVIEW_KINDS.has(node.kind),
                data: null,
            });
        }
        if (next.length === 0) return;
        setTabs(next);
        if (pending.active !== null && flat.some(f => f.id === pending.active)) {
            setActiveTabId(pending.active);
        }
        for (const tab of next) {
            if (!PREVIEW_KINDS.has(tab.node.kind)) {
                const data = await loadFile(tab.node);
                setTabs(prev => prev.map(t => (t.id === tab.id ? { ...t, loading: false, data } : t)));
            }
        }
    }, [loadFile]);

    useEffect(() => {
        const pending = pendingRestoreRef.current;
        if (!pending || treeLoaded === 0 || files.length === 0) return;
        pendingRestoreRef.current = null;
        restoreTabs(files, pending);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [treeLoaded]);

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
            // AI-modified / AI-created files open straight into the diff view so
            // the red/green change is visible in the code immediately.
            view: node.change_type ? 'diff' : 'source',
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

    // Sync open tabs' node + path snapshots after any rename/move so stale
    // names never linger on the tab strip / editor title.
    const reconcileTabs = useCallback((nextFiles: WorkspaceProjectFile[]) => {
        const walked = walkTree(nextFiles);
        setTabs(prev => prev.map(t => {
            const node = walked.flatFiles.find(f => f.id === t.id);
            return node ? { ...t, node, path: walked.paths.get(t.id) ?? t.path } : t;
        }));
    }, []);

    const collectIdsUnder = useCallback((nodes: WorkspaceProjectFile[], rootId: number, into: number[]) => {
        const findAndCollect = (list: WorkspaceProjectFile[]) => {
            for (const n of list) {
                if (n.id === rootId || into.includes(n.id)) {
                    into.push(n.id);
                    if (n.is_folder) findAndCollect(n.children || []);
                }
                if (n.is_folder) findAndCollect(n.children || []);
            }
        };
        findAndCollect(nodes);
    }, []);

    const cancelEdit = () => {
        if (editingFileId === null) return;
        setEditingContent(prev => {
            const next = { ...prev };
            delete next[editingFileId];
            return next;
        });
        setEditingFileId(null);
    };

    // Keep the editor's line-number gutter in sync with the textarea scroll.
    const syncEditGutter = () => {
        const ta = editAreaRef.current;
        const gutter = editGutterRef.current;
        if (ta && gutter) gutter.scrollTop = ta.scrollTop;
    };

    const startEdit = (tab: OpenTab) => {
        const content = tab.data?.content;
        if (typeof content !== 'string') return;
        setEditingContent(prev => ({ ...prev, [tab.id]: content }));
        setEditingFileId(tab.id);
    };

    // Focus the editor (and align numbers) the moment a tab enters edit mode.
    useEffect(() => {
        if (editingFileId === null) return;
        const raf = requestAnimationFrame(() => {
            editAreaRef.current?.focus();
            syncEditGutter();
        });
        return () => cancelAnimationFrame(raf);
    }, [editingFileId]);

    // IDE-style save shortcut while editing: ⌘S / Ctrl+S.
    useEffect(() => {
        if (editingFileId === null) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                saveEdit();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingFileId, editingContent, isSavingEdit]);

    // IDE-style save: persist the edited buffer, then re-derive the diff and
    // refresh the tree / changes panel so the file shows up as AI-modified.
    const saveEdit = async () => {
        if (editingFileId === null || isSavingEdit) return;
        const node = flatFiles.find(f => f.id === editingFileId);
        if (!node) return;
        const content = editingContent[editingFileId] ?? '';

        setIsSavingEdit(true);
        try {
            const res = await fetch(route('assistant.project.files.update', [projectId, node.id]), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                body: JSON.stringify({ content }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || `Failed to save (${res.status})`);
            }
            const data = await res.json();
            const entry: FileData = {
                content: data.content ?? null,
                previous: data.previous_content ?? null,
                error: null,
            };
            setFileData(prev => ({ ...prev, [node.id]: entry }));
            if (data.file?.change_type) {
                setStats(prev => ({ ...prev, [node.id]: diffStatsOf(diffLines(entry.previous, entry.content)) }));
            }
            // Keep the explorer tree + the active tab in sync with the server.
            setFiles(prev => {
                const updateNode = (nodes: WorkspaceProjectFile[]): WorkspaceProjectFile[] => nodes.map(n => {
                    if (n.id === node.id) {
                        return {
                            ...n,
                            change_type: data.file?.change_type ?? n.change_type,
                            changed_at: data.file?.changed_at ?? n.changed_at,
                            size_bytes: data.file?.size_bytes ?? n.size_bytes,
                        };
                    }
                    return { ...n, children: updateNode(n.children || []) };
                });
                return updateNode(prev);
            });
            setTabs(prev => prev.map(t => (t.id === node.id ? {
                ...t,
                node: {
                    ...t.node,
                    change_type: data.file?.change_type ?? t.node.change_type,
                    changed_at: data.file?.changed_at ?? t.node.changed_at,
                },
                view: 'diff',
                data: entry,
            } : t)));
            setSelectedChangeId(node.id);
            setEditingContent(prev => {
                const next = { ...prev };
                delete next[node.id];
                return next;
            });
            setEditingFileId(null);
        } catch (err: any) {
            alert('Failed to save: ' + (err?.message || 'unknown error'));
        } finally {
            setIsSavingEdit(false);
        }
    };

    // ── Rename / move ──
    const renameEntry = async (node: WorkspaceProjectFile, name: string) => {
        const trimmed = name.trim();
        if (trimmed === '' || trimmed === node.name) return;
        try {
            const res = await fetch(route('assistant.project.files.update', [projectId, node.id]), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                body: JSON.stringify({ name: trimmed }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || `Failed to rename (${res.status})`);
            }
            const data = await res.json();
            if (Array.isArray(data.files)) {
                setFiles(data.files);
                reconcileTabs(data.files);
            } else {
                await reloadTree();
            }
        } catch (err: any) {
            alert('Failed to rename: ' + (err?.message || 'unknown error'));
        }
    };

    const moveEntry = async (nodeId: number, parentId: number | null) => {
        try {
            const res = await fetch(route('assistant.project.files.update', [projectId, nodeId]), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                body: JSON.stringify({ parent_id: parentId }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || `Failed to move (${res.status})`);
            }
            const data = await res.json();
            if (Array.isArray(data.files)) {
                setFiles(data.files);
                reconcileTabs(data.files);
            } else {
                await reloadTree();
            }
        } catch (err: any) {
            alert('Failed to move: ' + (err?.message || 'unknown error'));
        }
    };

    const deleteFile = async (node: WorkspaceProjectFile) => {
        const isFolder = node.is_folder;
        const suffix = isFolder ? ' and everything inside it' : '';
        if (!window.confirm(`Delete "${node.name}"${suffix}?`)) return;
        try {
            const res = await fetch(route('assistant.project.files.destroy', [projectId, node.id]), {
                method: 'DELETE',
                headers: { 'Accept': 'application/json', 'X-CSRF-TOKEN': csrfToken() },
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || `Failed to delete (${res.status})`);
            }
            const doomed: number[] = [];
            collectIdsUnder(files, node.id, doomed);
            const doomedSet = new Set(doomed);
            doomedSet.add(node.id);
            setTabs(prev => prev.filter(t => !doomedSet.has(t.id)));
            setFileData(prev => {
                const next = { ...prev };
                doomedSet.forEach(id => delete next[id]);
                return next;
            });
            setStats(prev => {
                const next = { ...prev };
                doomedSet.forEach(id => delete next[id]);
                return next;
            });
            setSelectedChangeId(prev => (prev !== null && doomedSet.has(prev) ? null : prev));
            setEditingFileId(prev => (prev !== null && doomedSet.has(prev) ? null : prev));
            await reloadTree();
        } catch (err: any) {
            alert('Failed to delete: ' + (err?.message || 'unknown error'));
        }
    };

    // ── Right-click context menu ──
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    useEffect(() => {
        if (!contextMenu) return;
        const onAny = () => closeContextMenu();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu(); };
        window.addEventListener('click', onAny);
        window.addEventListener('contextmenu', onAny);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('click', onAny);
            window.removeEventListener('contextmenu', onAny);
            window.removeEventListener('keydown', onKey);
        };
    }, [contextMenu, closeContextMenu]);

    const copyPath = useCallback((node: WorkspaceProjectFile) => {
        const p = pathOf.get(node.id) ?? node.name;
        navigator.clipboard?.writeText(p)?.catch(() => {});
        closeContextMenu();
    }, [pathOf, closeContextMenu]);

    // ── Drag & drop (move in-tree / attach to chat) ──
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);
    const [dragOverRoot, setDragOverRoot] = useState(false);

    const onRowDragStart = (e: React.DragEvent, node: WorkspaceProjectFile) => {
        e.stopPropagation();
        setDraggingId(node.id);
        e.dataTransfer.setData(DRAG_FILE, JSON.stringify([{ id: node.id, name: node.name, kind: node.kind, is_folder: node.is_folder }]));
        e.dataTransfer.setData(DRAG_MOVE, String(node.id));
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const onRowDragEnd = () => {
        setDraggingId(null);
        setDragOverFolderId(null);
        setDragOverRoot(false);
    };

    const onFolderDragOver = (e: React.DragEvent, node: WorkspaceProjectFile) => {
        if (draggingId === node.id) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDragOverFolderId(node.id);
    };

    const onFolderDrop = (e: React.DragEvent, node: WorkspaceProjectFile) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData(DRAG_MOVE);
        setDragOverFolderId(null);
        setDragOverRoot(false);
        setDraggingId(null);
        if (!id || Number(id) === node.id) return;
        moveEntry(Number(id), node.id);
    };

    const onRootDragOver = (e: React.DragEvent) => {
        if (draggingId === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverRoot(true);
    };

    const onRootDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData(DRAG_MOVE);
        setDragOverRoot(false);
        setDraggingId(null);
        if (id) moveEntry(Number(id), null);
    };

    const activeTab = tabs.find(t => t.id === activeTabId) ?? null;

    const rowClass = (depth: number) => ({ paddingLeft: `${Math.min(4 + depth * 13, 40)}px` });

    const renderTree = (nodes: WorkspaceProjectFile[], depth: number) => {
        return nodes.map(node => {
            const pad = rowClass(depth);
            if (node.is_folder) {
                const open = openFolders.has(node.id);
                const isDragging = draggingId === node.id;
                return (
                    <div key={node.id}>
                        <div
                            draggable
                            onDragStart={(e) => onRowDragStart(e, node)}
                            onDragEnd={onRowDragEnd}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, node });
                            }}
                            style={pad}
                            className={`group flex items-center gap-1.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition ${isDragging ? 'opacity-40' : ''} ${open ? 'text-foreground' : ''} ${dragOverFolderId === node.id ? 'bg-primary/15 ring-1 ring-inset ring-primary/40' : 'text-foreground hover:bg-muted/60'}`}
                            title={`${pathOf.get(node.id) ?? node.name} — click to expand, drag to move`}
                        >
                            <button
                                type="button"
                                onClick={() => toggleFolder(node.id)}
                                className="h-3.5 w-3.5 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                                title={open ? 'Collapse' : 'Expand'}
                                tabIndex={-1}
                            >
                                <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                            </button>
                            {open
                                ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                                : <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />}
                            {renamingId === node.id
                                ? (
                                    <input
                                        autoFocus
                                        defaultValue={node.name}
                                        onFocus={(e) => e.currentTarget.select()}
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => {
                                            e.stopPropagation();
                                            if (e.key === 'Enter') { renameEntry(node, (e.target as HTMLInputElement).value); setRenamingId(null); }
                                            if (e.key === 'Escape') { setRenamingId(null); }
                                        }}
                                        onBlur={(e) => { renameEntry(node, e.target.value); setRenamingId(null); }}
                                        className="flex-1 min-w-0 bg-background text-foreground text-xs rounded px-1 py-0.5 border border-primary/60 outline-none ring-1 ring-primary/20"
                                    />
                                ) : (
                                    <span onClick={() => toggleFolder(node.id)} className="truncate flex-1 min-w-0 font-medium" title="Edit (double-click)">
                                        {node.name}
                                    </span>
                                )}
                        </div>
                        {open && node.children && node.children.length > 0 && (
                            <>
                                {renderTree(node.children, depth + 1)}
                                {dragOverRoot && depth >= 0 && draggingId !== null && (
                                    <div className="mx-2 my-1 rounded-lg border border-dashed border-primary/50 bg-primary/5 px-2 py-1 text-[10px] text-primary">
                                        Release to move into a subfolder
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            }

            const Ic = fileIconFor(node);
            const isActive = activeTabId === node.id;
            const isDragging = draggingId === node.id;
            return (
                <div
                    key={node.id}
                    draggable
                    onDragStart={(e) => onRowDragStart(e, node)}
                    onDragEnd={onRowDragEnd}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, node });
                    }}
                    onClick={() => openTab(node)}
                    onDoubleClick={() => { setRenamingId(node.id); }}
                    style={pad}
                    className={`group flex items-center gap-1.5 py-1.5 rounded-lg text-xs cursor-pointer transition select-none ${
                        isDragging ? 'opacity-40' :
                        isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted/60'
                    }`}
                    title={`${pathOf.get(node.id) ?? node.name} — click to open · right-click for options`}
                >
                    <span className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                        <Ic className="h-3.5 w-3.5" />
                    </span>
                    {renamingId === node.id
                        ? (
                            <input
                                autoFocus
                                defaultValue={node.name}
                                onFocus={(e) => e.currentTarget.select()}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') { renameEntry(node, (e.target as HTMLInputElement).value); setRenamingId(null); }
                                    if (e.key === 'Escape') { setRenamingId(null); }
                                }}
                                onBlur={(e) => { renameEntry(node, e.target.value); setRenamingId(null); }}
                                className="flex-1 min-w-0 bg-background text-foreground text-xs rounded px-1 py-0.5 border border-primary/60 outline-none ring-1 ring-primary/20"
                            />
                        ) : (
                            <span className="truncate flex-1 min-w-0">{node.name}</span>
                        )}
                    {node.change_type === 'created' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title="Created by AI" />}
                    {node.change_type === 'modified' && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Modified by AI" />}
                </div>
            );
        });
    };

    // Inline rename state (row id being renamed) reused by the context menu.
    const [renamingId, setRenamingId] = useState<number | null>(null);

    const runRename = (node: WorkspaceProjectFile) => {
        closeContextMenu();
        setRenamingId(node.id);
    };

    // Map of new-file line numbers that were ADDED vs the previous content, so
    // the plain source view can keep the diff "in the code" (soft green gutter).
    const buildSourceMark = (diffs: DiffLine[]): Set<number> => {
        const added = new Set<number>();
        let newLine = 1;
        for (const d of diffs) {
            if (d.type === 'add') added.add(d.newLine ?? newLine);
            if (d.type !== 'del') newLine = (d.newLine ?? newLine) + 1;
        }
        return added;
    };

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
        const isEditing = editingFileId === tab.id;
        const lang = languageFromName(tab.node.name);
        const diffs = tab.view === 'diff' && hasChange
            ? diffLines(tab.data?.previous ?? null, content)
            : null;

        // Quitting edit mode (discarding the buffer) via Escape.
        const onEditKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        };

        if (isEditing) {
            const lineCount = (editingContent[tab.id] ?? content).split('\n').length;
            return (
                <div className="flex-1 min-h-0 flex flex-col">
                    <TabMetaBar tab={tab} pathOf={pathOf} onToggleDiff={hasChange ? () => toggleView(tab.id) : undefined} stat={stat} isEditing />
                    <div className="flex-1 min-h-0 flex overflow-hidden bg-[#0b0b0d]">
                        <div ref={editGutterRef} className="w-11 shrink-0 overflow-hidden pl-2 pr-2 py-2 select-none bg-[#0b0b0d]">
                            <pre className="text-[12px] leading-[1.55] font-mono text-neutral-600 text-right">
                                {Array.from({ length: lineCount }, (_, i) => (
                                    <div key={i}>{i + 1}</div>
                                ))}
                            </pre>
                        </div>
                        <textarea
                            ref={editAreaRef}
                            value={editingContent[tab.id] ?? content}
                            onChange={(e) => {
                                setEditingContent(prev => ({ ...prev, [tab.id]: e.target.value }));
                                requestAnimationFrame(syncEditGutter);
                            }}
                            onScroll={syncEditGutter}
                            onKeyDown={onEditKeyDown}
                            spellCheck={false}
                            className="flex-1 min-w-0 resize-none bg-transparent text-[12px] leading-[1.55] font-mono text-neutral-200 outline-none py-2 pl-2 pr-4 whitespace-pre"
                        />
                    </div>
                    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-border/40 bg-card">
                        <button
                            type="button"
                            onClick={saveEdit}
                            disabled={isSavingEdit}
                            className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 active:scale-95 transition disabled:opacity-50"
                        >
                            {isSavingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Save
                        </button>
                        <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={isSavingEdit}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-50"
                        >
                            <X className="h-3 w-3" /> Cancel
                        </button>
                        <span className="flex-1" />
                        <span className="text-[10px] font-mono text-muted-foreground/70">⌘S to save · Esc to cancel</span>
                        <span className="text-[10px] font-mono text-muted-foreground/60">{lineCount} lines</span>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex-1 min-h-0 flex flex-col">
                <TabMetaBar tab={tab} pathOf={pathOf} onToggleDiff={hasChange ? () => toggleView(tab.id) : undefined} stat={stat} onEdit={() => startEdit(tab)} />
                <div className="flex-1 min-h-0 overflow-auto bg-[#0b0b0d]">
                    {tab.view === 'source' && hasChange
                        ? <HighlightedCode value={content} lang={lang} addedLines={buildSourceMark(diffLines(tab.data?.previous ?? null, content))} />
                        : diffs ? <HighlightedDiff diffs={diffs} lang={lang} /> : <HighlightedCode value={content} lang={lang} />}
                </div>
            </div>
        );
    };

    const editorInfo = activeTab
        ? stats[activeTab.id]
        : null;

    // Aggregate +N/-M across every changed file, shown in the top bar.
    const totalStats = useMemo(() => {
        let additions = 0;
        let deletions = 0;
        for (const f of changedFiles) {
            const s = stats[f.id];
            if (s) {
                additions += s.additions;
                deletions += s.deletions;
            }
        }
        return { additions, deletions };
    }, [changedFiles, stats]);

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-background md:bg-card relative" onDragEnd={onRowDragEnd}>
            {/* Top bar */}
            <div className="relative z-50 flex items-center gap-1.5 px-2.5 py-2 border-b border-border/50 shrink-0 bg-card/80 backdrop-blur-xl">
                <button
                    type="button"
                    onClick={onClose}
                    title="Back to chat"
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Chat</span>
                </button>
                {onToggleChatPane && (
                    <button
                        type="button"
                        onClick={onToggleChatPane}
                        title={chatPaneOpen ? 'Hide chat panel' : 'Show chat panel'}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                            chatPaneOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                        }`}
                    >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span className="hidden lg:inline">Chat</span>
                    </button>
                )}
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
                {totalStats.additions + totalStats.deletions > 0 && (
                    <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-muted/80 border border-border/40 px-1.5 py-px font-mono text-[9.5px] shrink-0">
                        <span className="text-emerald-600 dark:text-emerald-400">+{totalStats.additions}</span>
                        <span className="text-rose-600 dark:text-rose-400">-{totalStats.deletions}</span>
                    </span>
                )}

                {/* Git repo menu */}
                <div className="relative">
                    {repoUrl ? (
                        <button
                            type="button"
                            onClick={() => setGitMenuOpen(v => !v)}
                            title={repoUrl}
                            className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
                                gitMenuOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                            }`}
                        >
                            {repoWorking
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                : <GitBranch className="h-3.5 w-3.5" />}
                            <span className="hidden lg:inline">{repoBranch || 'main'}</span>
                            {repoError && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" title={repoError} />}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={onConnectRepo}
                            title="Connect a Git repository"
                            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                        >
                            {repoWorking === 'connect'
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                : <GithubMark className="h-3.5 w-3.5" />}
                            <span className="hidden lg:inline">Git</span>
                        </button>
                    )}

                    {gitMenuOpen && repoUrl && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-border/60 bg-card/95 backdrop-blur-2xl shadow-2xl p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                            <div className="px-2.5 py-2 border-b border-border/30">
                                <div className="text-[9.5px] font-bold tracking-[0.08em] text-muted-foreground/60">GIT REPOSITORY</div>
                                <div className="text-[11px] text-foreground font-medium mt-0.5 truncate" title={repoUrl}>
                                    {repoUrl}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                    Branch <span className="font-mono text-primary">{repoBranch || 'main'}</span>
                                    {repoError && <span className="text-red-500 block mt-0.5 break-words">⚠ {repoError}</span>}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => { setGitMenuOpen(false); onCommitRepo?.(); }}
                                disabled={repoWorking !== null}
                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] font-semibold text-foreground hover:bg-primary/10 hover:text-primary transition disabled:opacity-50"
                            >
                                {repoWorking === 'commit'
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                    : <GitCommitHorizontal className="h-3.5 w-3.5 text-primary" />}
                                Commit & Push
                            </button>
                            {repoUrl && (
                                <button
                                    type="button"
                                    onClick={() => { setGitMenuOpen(false); setRightPanel('commits'); }}
                                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] font-medium text-foreground hover:bg-muted/60 transition"
                                >
                                    <History className="h-3.5 w-3.5" />
                                    Commit History
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => { setGitMenuOpen(false); onPullRepo?.(); }}
                                disabled={repoWorking !== null}
                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] font-medium text-foreground hover:bg-muted/60 transition disabled:opacity-50"
                            >
                                {repoWorking === 'pull'
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                    : <RefreshCw className="h-3.5 w-3.5" />}
                                Pull Latest
                            </button>

                            <div className="border-t border-border/30 pt-0.5 mt-0.5">
                                <button
                                    type="button"
                                    onClick={() => { setGitMenuOpen(false); onDisconnectRepo?.(); }}
                                    disabled={repoWorking !== null}
                                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] font-medium text-destructive hover:bg-destructive/10 transition disabled:opacity-50"
                                >
                                    <Unplug className="h-3.5 w-3.5" />
                                    Disconnect
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => reloadTree()}
                    title="Refresh files"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Body: 3 columns with resizable splitters */}
            <div className={`flex-1 min-h-0 flex relative ${resizing ? 'cursor-col-resize select-none' : ''}`}>
                {/* Col 1: Explorer */}
                <aside
                    style={{ width: showTree ? (isMobile ? Math.min(320, window.innerWidth * 0.8) : treeWidth) : 0 }}
                    className={`absolute inset-y-0 left-0 z-30 md:static md:z-auto flex flex-col bg-card/95 backdrop-blur-xl border-r border-border/40 overflow-hidden ${
                        showTree ? '' : 'border-none'
                    }`}
                >
                    <div className="px-3 py-2.5 border-b border-border/40 shrink-0">
                        <div className="text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground/60">EXPLORER</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                            {flatFiles.length} file{flatFiles.length !== 1 ? 's' : ''}
                            {changedFiles.length > 0 && ` · ${changedFiles.length} changed`}
                        </div>
                    </div>
                    <div
                        className={`flex-1 overflow-y-auto py-1.5 px-1 space-y-0.5 ${dragOverRoot ? 'rounded-lg ring-1 ring-inset ring-dashed ring-primary/50 bg-primary/[0.03]' : ''}`}
                        onDragOver={onRootDragOver}
                        onDrop={onRootDrop}
                    >
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
                        {dragOverRoot && draggingId !== null && files.length > 0 && (
                            <div className="mx-2 my-1 rounded-lg border border-dashed border-primary/50 bg-primary/5 px-2 py-1.5 text-[10px] text-primary text-center">
                                Release to move to the project root
                            </div>
                        )}
                    </div>
                </aside>

                {/* Splitter: explorer / editor */}
                {showTree && !isMobile && (
                    <div
                        className="hidden md:block w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors"
                        onPointerDown={startResize('left')}
                        title="Drag to resize"
                    />
                )}

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
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            setContextMenu({ x: e.clientX, y: e.clientY, node: t.node });
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

                {/* Splitter: editor / right rail */}
                {showChanges && !isMobile && (
                    <div
                        className="hidden md:block w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors"
                        onPointerDown={startResize('right')}
                        title="Drag to resize"
                    />
                )}

                {/* Col 3: Changes / Commit history */}
                <aside
                    style={{ width: showChanges ? (isMobile ? Math.min(320, window.innerWidth * 0.8) : rightWidth) : 0 }}
                    className={`absolute inset-y-0 right-0 z-30 md:static md:z-auto flex flex-col bg-card/95 backdrop-blur-xl border-l border-border/40 overflow-hidden ${
                        showChanges ? '' : 'border-none'
                    }`}
                >
                    {/* Rail tabs */}
                    <div className="px-3 pt-2.5 pb-2 border-b border-border/40 shrink-0">
                        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
                            <button
                                type="button"
                                onClick={() => setRightPanel('changes')}
                                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] font-semibold transition ${
                                    rightPanel === 'changes' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <GitCompareArrows className="h-3 w-3" />
                                Changes
                                {changedFiles.length > 0 && (
                                    <span className="rounded-full bg-primary/15 text-primary px-1.5 py-px text-[9px] font-bold">{changedFiles.length}</span>
                                )}
                            </button>
                            {repoUrl && (
                                <button
                                    type="button"
                                    onClick={() => setRightPanel('commits')}
                                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[10.5px] font-semibold transition ${
                                        rightPanel === 'commits' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    <History className="h-3 w-3" />
                                    History
                                </button>
                            )}
                        </div>
                        {rightPanel === 'changes' ? (
                            <div className="text-[10px] text-muted-foreground mt-1.5">
                                {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} changed by AI
                            </div>
                        ) : (
                            <div className="text-[10px] text-muted-foreground mt-1.5">
                                Commit history on <span className="font-mono text-primary">{repoBranch || 'main'}</span>
                            </div>
                        )}
                    </div>

                    {rightPanel === 'commits' && repoUrl ? (
                        <CommitHistoryPane projectId={projectId} repoUrl={repoUrl} />
                    ) : (
                        <>
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
                                            <HighlightedDiff diffs={diffs} lang={languageFromName(f.name)} compact />
                                        </div>
                                    </div>
                                );
                            })()}
                        </>
                    )}
                </aside>
            </div>

            {/* Right-click context menu */}
            {contextMenu && (
                <div
                    className="fixed inset-0 z-50"
                    onClick={closeContextMenu}
                    onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
                >
                    <div
                        className="absolute w-52 rounded-xl border border-border/60 bg-card/95 backdrop-blur-2xl shadow-2xl p-1.5 space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
                        style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 260) }}
                    >
                        <div className="px-2.5 py-1.5 border-b border-border/30">
                            <div className="text-[11px] font-semibold text-foreground truncate flex items-center gap-1.5">
                                {contextMenu.node.is_folder ? <Folder className="h-3 w-3 text-primary" /> : <FileIcon className="h-3 w-3 text-primary" />}
                                {contextMenu.node.name}
                            </div>
                            <div className="text-[9.5px] font-mono text-muted-foreground/60 truncate">{pathOf.get(contextMenu.node.id) ?? ''}</div>
                        </div>

                        {!contextMenu.node.is_folder && (
                            <button
                                type="button"
                                onClick={() => { openTab(contextMenu.node); closeContextMenu(); }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px] font-medium text-foreground hover:bg-muted/60 transition"
                            >
                                <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" /> Open
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => runRename(contextMenu.node)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px] font-medium text-foreground hover:bg-muted/60 transition"
                        >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" /> Rename
                        </button>
                        <button
                            type="button"
                            onClick={() => copyPath(contextMenu.node)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px] font-medium text-foreground hover:bg-muted/60 transition"
                        >
                            <Copy className="h-3.5 w-3.5 text-muted-foreground" /> Copy Path
                        </button>
                        {!contextMenu.node.is_folder && (
                            <a
                                href={downloadUrl(contextMenu.node.id)}
                                onClick={closeContextMenu}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px] font-medium text-foreground hover:bg-muted/60 transition"
                            >
                                <Download className="h-3.5 w-3.5 text-muted-foreground" /> Download
                            </a>
                        )}
                        <div className="border-t border-border/30 pt-0.5 mt-0.5">
                            <button
                                type="button"
                                onClick={() => { closeContextMenu(); deleteFile(contextMenu.node); }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px] font-medium text-destructive hover:bg-destructive/10 transition"
                            >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Syntax-highlighted code blocks (VS Code "Dark+" palette) ──

function Tokens({ value, lang }: { value: string; lang: string | null }) {
    const tokens = useMemo<Token[]>(() => {
        if (value === '') return [];
        const out: Token[] = [];
        for (const t of tokenizeCode(value, lang ?? undefined)) {
            if (t.value !== '') out.push(t);
        }
        return out;
    }, [value, lang]);
    if (tokens.length === 0) return <>{' '}</>;
    return <>{tokens.map((t, i) => <span key={i} className={TOKEN_CLASS[t.type]}>{t.value}</span>)}</>;
}

function HighlightedCode({ value, lang, addedLines, compact = false }: { value: string; lang: string | null; addedLines?: Set<number>; compact?: boolean }) {
    const lineTokens = useMemo(() => tokensToLines(tokenizeCode(value, lang ?? undefined)), [value, lang]);
    const lines = lineTokens.length;
    const cn = compact ? 'text-[11px] leading-[1.5]' : 'text-[12px] leading-[1.55]';
    return (
        <pre className={`ws-dark font-mono text-neutral-200 ${cn}`}>
            {Array.from({ length: lines }, (_, i) => {
                const num = i + 1;
                const added = addedLines?.has(num) ?? false;
                const toks = lineTokens[i] ?? [];
                return (
                    <div key={i} className={`flex px-2 ${added ? 'bg-emerald-500/[0.07]' : 'hover:bg-white/[0.03]'}`}>
                        <span className={`w-8 pr-2 text-right shrink-0 select-none ${added ? 'text-emerald-500' : 'text-neutral-600'}`}>
                            {added ? '+' : ' '}
                        </span>
                        <span className="w-10 pr-4 text-right shrink-0 select-none text-neutral-600">{num}</span>
                        <code className="whitespace-pre flex-1 pr-4">
                            {toks.length === 0 ? ' ' : toks.map((t, j) => <span key={j} className={TOKEN_CLASS[t.type]}>{t.value}</span>)}
                        </code>
                    </div>
                );
            })}
        </pre>
    );
}

function HighlightedDiff({ diffs, lang, compact = false }: { diffs: DiffLine[]; lang: string | null; compact?: boolean }) {
    const cn = compact ? 'text-[11px] leading-[1.5]' : 'text-[12px] leading-[1.55]';
    return (
        <pre className={`ws-dark font-mono text-neutral-200 ${cn}`}>
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
                    <code className="whitespace-pre flex-1 pr-4 text-neutral-200"><Tokens value={line.value} lang={lang} /></code>
                </div>
            ))}
        </pre>
    );
}

// ── Commit history (VS Code-style source control) ──

type ParsedDiffLine = { type: 'add' | 'del' | 'ctx' | 'scope'; value: string; file?: string };

function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
    const lines: ParsedDiffLine[] = [];
    let currentFile: string | undefined;
    for (const raw of diff.split('\n')) {
        if (raw.startsWith('diff --git ')) {
            currentFile = raw.match(/diff --git a\/(.*?) b\//)?.[1] ?? raw;
            lines.push({ type: 'scope', value: raw, file: currentFile });
            continue;
        }
        if (raw.startsWith('index ') || raw.startsWith('new file ') || raw.startsWith('deleted file ') || raw.startsWith('old mode ') || raw.startsWith('new mode ') || raw.startsWith('similarity ') || raw.startsWith('rename ') || raw.startsWith('No newline at end of file')) {
            continue;
        }
        if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) {
            lines.push({ type: 'ctx', value: raw, file: currentFile });
            continue;
        }
        if (raw.startsWith('+')) lines.push({ type: 'add', value: raw.slice(1), file: currentFile });
        else if (raw.startsWith('-')) lines.push({ type: 'del', value: raw.slice(1), file: currentFile });
        else lines.push({ type: 'ctx', value: raw, file: currentFile });
    }
    return lines;
}

function timeAgo(date: string): string {
    const t = new Date(date).getTime();
    if (Number.isNaN(t)) return '';
    const diff = Date.now() - t;
    const m = Math.round(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function CommitHistoryPane({ projectId, repoUrl }: { projectId: number; repoUrl: string }) {
    const [commits, setCommits] = useState<RepoCommit[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [detail, setDetail] = useState<RepoCommitDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [diffOpen, setDiffOpen] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            setError(null);
            try {
                const res = await fetch(route('assistant.project.repo.commits', projectId), {
                    headers: { 'Accept': 'application/json' },
                });
                const data = await res.json();
                if (!alive) return;
                if (data.success) setCommits(data.commits ?? []);
                else setError(data.message || 'Failed to load history.');
            } catch (err: any) {
                if (alive) setError(err?.message || 'Failed to load history.');
            }
        })();
        return () => { alive = false; };
    }, [projectId]);

    const selectCommit = async (hash: string) => {
        if (selected === hash && detail) {
            setSelected(null);
            setDetail(null);
            setDiffOpen(false);
            return;
        }
        setSelected(hash);
        setDetail(null);
        setDiffOpen(false);
        setDetailLoading(true);
        try {
            const res = await fetch(route('assistant.project.repo.commit.detail', [projectId, hash]), {
                headers: { 'Accept': 'application/json' },
            });
            const data = await res.json();
            setDetail(data.success ? (data.commit as RepoCommitDetail) : null);
        } catch {
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    };

    if (error) {
        return (
            <div className="flex-1 overflow-y-auto px-3 py-4">
                <p className="text-[11px] text-destructive leading-relaxed">{error}</p>
            </div>
        );
    }

    if (!commits) {
        return (
            <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-[11px]">Loading history…</span>
            </div>
        );
    }

    if (commits.length === 0) {
        return (
            <div className="flex-1 overflow-y-auto px-4 py-10 text-center">
                <GitCommitHorizontal className="h-5 w-5 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                    No commits yet. Make your first commit with “Commit &amp; Push”.
                </p>
            </div>
        );
    }

    const selectedDetail = detail;

    return (
        <>
            <div className={`flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5 ${detail ? '' : ''}`}>
                {commits.map(c => {
                    const isOpen = selected === c.hash;
                    return (
                        <div key={c.hash} className="rounded-lg">
                            <button
                                type="button"
                                onClick={() => selectCommit(c.hash)}
                                className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left transition ${
                                    isOpen ? 'bg-primary/10' : 'hover:bg-muted/60'
                                }`}
                            >
                                <GitCommitHorizontal className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${isOpen ? 'text-primary' : 'text-muted-foreground'}`} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-1.5 min-w-0">
                                        <span className="font-mono text-[9.5px] text-primary shrink-0">{c.short}</span>
                                        <span className="text-[10px] text-muted-foreground/60 shrink-0">{timeAgo(c.date)}</span>
                                    </div>
                                    <div className="text-[11px] font-medium text-foreground truncate mt-0.5">{c.subject}</div>
                                    <div className="text-[9.5px] text-muted-foreground/60 truncate">{c.author}</div>
                                </div>
                            </button>
                            {isOpen && (
                                <div className="ml-2.5 pl-3 border-l border-border/50 pb-1.5 space-y-1 mt-1">
                                    {detailLoading && (
                                        <div className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground">
                                            <Loader2 className="h-3 w-3 animate-spin text-primary" /> Loading…
                                        </div>
                                    )}
                                    {selectedDetail && (
                                        <>
                                            <div className="flex flex-wrap gap-1 px-1 pt-0.5">
                                                {selectedDetail.files.map((f, i) => (
                                                    <span key={i} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                                                        f.status === 'added' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                                                        f.status === 'deleted' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' :
                                                        'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                                    }`} title={f.status}>
                                                        {f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M'}
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="px-1">
                                                {selectedDetail.files.slice(0, 6).map(f => (
                                                    <div key={f.path} className="text-[10px] font-mono text-muted-foreground/80 truncate">
                                                        {f.path}
                                                    </div>
                                                ))}
                                                {selectedDetail.files.length > 6 && (
                                                    <div className="text-[9.5px] text-muted-foreground/50">+ {selectedDetail.files.length - 6} more</div>
                                                )}
                                            </div>
                                            {selectedDetail.diff && (
                                                <button
                                                    type="button"
                                                    onClick={() => setDiffOpen(v => !v)}
                                                    className="flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold text-primary hover:text-primary/80 transition"
                                                >
                                                    <GitCompareArrows className="h-3 w-3" />
                                                    {diffOpen ? 'Hide diff' : 'View diff'}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {selectedDetail && diffOpen && (
                <div className="shrink-0 max-h-[45%] overflow-y-auto border-t border-border/40 bg-card ws-dark">
                    <HighlightedScopeDiff lines={parseUnifiedDiff(selectedDetail.diff)} />
                </div>
            )}
        </>
    );
}

function HighlightedScopeDiff({ lines }: { lines: ParsedDiffLine[] }) {
    const cn = 'text-[10.5px] leading-[1.5]';
    return (
        <pre className={`ws-dark font-mono text-neutral-200 ${cn}`}>
            {lines.map((line, i) => (
                <div
                    key={i}
                    className={`flex px-2 whitespace-pre ${
                        line.type === 'scope' ? 'bg-primary/[0.06] text-primary/90 font-semibold' :
                        line.type === 'add' ? 'bg-emerald-500/[0.09]' :
                        line.type === 'del' ? 'bg-rose-500/[0.09]' :
                        'hover:bg-white/[0.03]'
                    }`}
                >
                    <span className={`w-5 pr-1 text-right shrink-0 select-none ${
                        line.type === 'add' ? 'text-emerald-500' : line.type === 'del' ? 'text-rose-500' : 'text-neutral-600'
                    }`}>
                        {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                    </span>
                    <code className={`flex-1 pr-4 ${line.type === 'scope' ? '' : 'text-neutral-200'}`}>
                        {line.type === 'scope' ? line.value : <Tokens value={line.value} lang={null} />}
                    </code>
                </div>
            ))}
        </pre>
    );
}

function TabMetaBar({
    tab,
    pathOf,
    onToggleDiff,
    stat,
    onEdit,
    isEditing,
}: {
    tab: OpenTab;
    pathOf: Map<number, string>;
    onToggleDiff?: () => void;
    stat?: DiffStats;
    onEdit?: () => void;
    isEditing?: boolean;
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
            {stat && (
                <span className="font-mono">
                    <span className="text-emerald-500/90">+{stat.additions}</span>{' '}
                    <span className="text-rose-500/90">-{stat.deletions}</span>
                </span>
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
            {onEdit && (
                <button
                    type="button"
                    onClick={onEdit}
                    disabled={isEditing}
                    title="Edit file"
                    className={`flex items-center gap-1 rounded-md px-1.5 py-1 font-bold transition ${
                        isEditing
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                    }`}
                >
                    <Pencil className="h-3 w-3" />
                    <span className="hidden sm:inline">{isEditing ? 'Editing' : 'Edit'}</span>
                </button>
            )}
        </div>
    );
}