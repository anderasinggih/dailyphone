import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link, router } from '@inertiajs/react';
import { useState, useRef, useEffect, FormEvent } from 'react';
import {
    Send,
    Settings,
    Smartphone,
    TrendingUp,
    ShieldCheck,
    Store,
    Loader2,
    Plus,
    MessageSquare,
    Trash2,
    PanelLeftClose,
    PanelLeft,
    Sparkles,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
    Copy,
    Check,
    CheckCircle2,
    CircleDashed,
    Megaphone,
    Reply,
    CornerUpLeft,
    X,
    Pencil,
    Sliders,
    Network,
    Image as ImageIcon,
    FileText,
    FileArchive,
    FileSpreadsheet,
    FileCode2,
    File as FileIcon,
    Folder,
    FolderOpen,
    FolderPlus,
    Paperclip,
    Download,
    Upload
} from 'lucide-react';
import GeminiStar from '@/Components/GeminiStar';
import Markdown from '@/Components/Markdown';
import AiActionProposalCard, { ActionProposalData, GeneratedFile } from '@/Components/AiActionProposalCard';
import NeuronFiringMap from '@/Components/NeuronFiringMap';
import FileViewerModal from '@/Components/Assistant/FileViewerModal';
import { consumeNdjson } from '@/lib/ndjson';

type AccessedNeuron = import('@/lib/ndjson').StreamNeuron;
type NeuronLink = import('@/lib/ndjson').StreamEdge;

// Compact live timing strip for the thinking panel: which server stage ate the
// wall clock, split between "our backend" (retrieval/context/payload) and the
// Gemini round-trips (turn1, turn2, ...).
function timingStrip(timing: Record<string, number>): string {
    const order = ['retrieval', 'context', 'payload'];
    for (const n of Object.keys(timing).filter(k => /^turn\d+$/.test(k)).map(Number).sort((a, b) => a - b)) {
        order.push('turn' + n);
    }
    order.push('total');
    return order
        .filter(k => timing[k] !== undefined)
        .map(k => `${k}: ${(timing[k] / 1000).toFixed(1)}s`)
        .join(' · ');
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    action_status?: 'pending' | 'executing' | 'executed' | 'rejected' | null;
    replyToId?: string | null;
    replyToRole?: 'user' | 'assistant' | null;
    timestamp: string;
    attachments?: { name: string; kind: string }[];
}

interface UploadedAttachment {
    id: number;
    original_name: string;
    kind: string;
    size_bytes: number;
}

interface Session {
    id: number;
    project_id?: number | null;
    title: string;
    custom_rules?: string | null;
    ai_model?: string | null;
    created_at: string;
    updated_at: string;
}

interface ProjectSession {
    id: number;
    title: string;
    created_at: string;
    updated_at: string;
}

interface ProjectFileNode {
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

interface AiProject {
    id: number;
    title: string;
    description?: string | null;
    created_at: string;
    updated_at: string;
    sessions: ProjectSession[];
    files: ProjectFileNode[];
}

const AVAILABLE_MODELS = [
    { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Recommended)' },
    { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Fast)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { value: 'gemini-3.1-flash-image', label: 'Nano Banana 2 (Image) — Gemini 3.1 Flash Image' },
    { value: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite (Image) — Gemini 3.1 Flash Lite Image' },
    { value: 'gemini-2.5-flash-image', label: 'Nano Banana (Image) — Gemini 2.5 Flash Image' },
];

interface AssistantProps {
    aiConfig: {
        is_configured: boolean;
        is_enabled: boolean;
        model: string;
    };
    userRole: string;
    chatOnly?: boolean;
    projects?: AiProject[];
    sessions: Session[];
    activeSessionId: number | null;
    initialMessages: Message[];
}

const QUICK_PROMPTS = [
    {
        title: 'Audit Operasional Toko',
        prompt: 'Lakukan audit operasional toko: cek stok mati/aging >45 hari, transaksi void/pembatalan belakangan ini, dan status transfer antar cabang.',
        icon: ShieldCheck,
    },
    {
        title: 'Ide Promo & Marketing',
        prompt: 'Buatkan strategi promo dan ide kampanye marketing retail untuk mendongkrak penjualan unit stok yang aging/lambat terjual, lengkap dengan paket bundling dan copy iklan medsos.',
        icon: Megaphone,
    },
    {
        title: 'Check iPhone 13 Stock',
        prompt: 'Apakah ada stok iPhone 13 128GB yang ready saat ini? Tolong sebutkan warna dan cabangnya.',
        icon: Smartphone,
    },
    {
        title: "Today's Sales Summary",
        prompt: 'Bagaimana ringkasan penjualan toko hari ini? Berapa unit yang terjual dan total transaksinya?',
        icon: TrendingUp,
    },
];

export default function Assistant({
    aiConfig,
    userRole,
    chatOnly = false,
    projects = [],
    sessions = [],
    activeSessionId = null,
    initialMessages = []
}: AssistantProps) {
    const welcomeMessage: Message = {
        id: 'welcome-default',
        role: 'assistant',
        content: `Halo! Saya **Daily Phone Intelligence**. Saya siap membantu cek ketersediaan unit stok, harga jual, transaksi kasir hari ini, hingga informasi cabang toko.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const [currentSessionId, setCurrentSessionId] = useState<number | null>(activeSessionId);
    const [sessionList, setSessionList] = useState<Session[]>(sessions);
    const [messages, setMessages] = useState<Message[]>(
        initialMessages && initialMessages.length > 0 ? initialMessages : [welcomeMessage]
    );
    const [inputQuery, setInputQuery] = useState('');
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [accessedNetwork, setAccessedNetwork] = useState<{ nodes: AccessedNeuron[]; edges: NeuronLink[] }>({ nodes: [], edges: [] });
    const [thinkingSeconds, setThinkingSeconds] = useState<number>(0);
    // Live per-stage wall-clock from the stream ('retrieval' | 'context' | 'payload' | 'turnN' | 'total').
    const [liveTiming, setLiveTiming] = useState<Record<string, number>>({});
    const [isSidebarOpen, setIsSidebarOpen] = useState(false); // sidebar closed by default
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
    const [editingSessionTitle, setEditingSessionTitle] = useState<string>('');
    const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
        return localStorage.getItem('ai_sound_enabled') !== 'false';
    });
    const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
    const [currentRules, setCurrentRules] = useState<string>('');
    const [currentModel, setCurrentModel] = useState<string>(aiConfig.model || '');
    const [isSavingRules, setIsSavingRules] = useState(false);
    const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Projects layer: each project groups sessions and owns a shared file tree.
    const [projectList, setProjectList] = useState<AiProject[]>(projects);
    const [expandedProjects, setExpandedProjects] = useState<Set<number>>(() => {
        const activeProject = projects.find(p => p.sessions.some(s => s.id === activeSessionId));
        return new Set(activeProject ? [activeProject.id] : []);
    });
    // When set, the sidebar swaps from the project/session tree to that
    // project's file explorer.
    const [filePanelProjectId, setFilePanelProjectId] = useState<number | null>(null);
    const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
    const [editingProjectTitle, setEditingProjectTitle] = useState('');
    const [openFileFolders, setOpenFileFolders] = useState<Set<number>>(new Set());
    const [isProjectUploading, setIsProjectUploading] = useState(false);
    const projectFileInputRef = useRef<HTMLInputElement>(null);
    const fileUploadTargetRef = useRef<number | null>(null);
    // Project files referenced into the current message (@-mention / picker).
    const [projectFileRefs, setProjectFileRefs] = useState<ProjectFileNode[]>([]);
    const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    // Built-in file viewer (code / image / pdf preview).
    const [viewerFile, setViewerFile] = useState<{ projectId: number; file: ProjectFileNode } | null>(null);
    // Drag & drop file attach state for the chat panel.
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    // Live token-by-token draft rendered while Gemini streams its answer.
    const [draftStream, setDraftStream] = useState<string>('');
    // Collapsible "AI is thinking" panel — arrow toggles, like opencode's thought.
    const [streamCollapsed, setStreamCollapsed] = useState(false);
    // Floating corner toast — confirms whenever the AI actually persisted a new
    // memory node ("Saved to new node"), so the user sees memory grow in real time.
    const [cornerToast, setCornerToast] = useState<{ key: number; title: string; detail?: string } | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showCornerToast = (title: string, detail?: string) => {
        setCornerToast({ key: Date.now(), title, detail });
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setCornerToast(null), 2600);
    };

    // Reuse a single AudioContext so completion chimes do not leak one context per
// message (browsers cap concurrent AudioContexts).
let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioCtx(): AudioContext | null {
    if (sharedAudioCtx) return sharedAudioCtx;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    sharedAudioCtx = new AudioCtx();
    return sharedAudioCtx;
}

function playCompletionChime(soundEnabled: boolean): void {
    if (!soundEnabled) return;
    try {
        const ctx = getSharedAudioCtx();
        if (!ctx) return;
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
            ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Pure Apple notification chime: 1 single elegant crystal tone (880Hz - A5)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // Crisp, gentle single note

        // Smooth bell envelope: quick soft attack, pure exponential decay
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.45);
    } catch (e) {
        // Audio context not allowed or unsupported
    }
}

    // Load active session rules when current session changes
    useEffect(() => {
        const active = sessionList.find(s => s.id === currentSessionId);
        setCurrentRules(active?.custom_rules || '');
        setCurrentModel(active?.ai_model || aiConfig.model || '');
    }, [currentSessionId, sessionList]);

    // Synchronize messages state when initialMessages or activeSessionId updates (e.g. on page refresh or session switch)
    useEffect(() => {
        if (initialMessages && initialMessages.length > 0) {
            setMessages(initialMessages);
        } else {
            setMessages([welcomeMessage]);
        }
    }, [initialMessages, activeSessionId]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const handleReply = (msg: Message) => {
        setReplyingTo(msg);
        setTimeout(() => {
            inputRef.current?.focus();
        }, 50);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const scrollToMessage = (id: string) => {
        const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`) as HTMLElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.boxShadow = '0 0 0 2.5px rgba(0,122,255,0.55)';
        el.style.borderRadius = '16px';
        window.setTimeout(() => {
            el.style.boxShadow = '';
            el.style.borderRadius = '';
        }, 1600);
    };

    const replySnippet = (content: string) => {
        const clean = content
            .replace(/```action_proposal[\s\S]*?```/g, '')
            .replace(/```ai_memo[\s\S]*?```/g, '')
            .replace(/```[\s\S]*?```/g, '')
            .trim();
        return clean.length > 50 ? clean.slice(0, 50) + '…' : (clean || '(attachment)');
    };

    const renderReplyChip = (m: Message) => {
        if (!m.replyToId) return null;
        return (
            <button
                type="button"
                onClick={() => scrollToMessage(m.replyToId!)}
                title="Jump to replied message"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/70 border border-border/50 text-[10.5px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 transition cursor-pointer max-w-[90%]"
            >
                <CornerUpLeft className="h-3 w-3 text-primary/70 shrink-0" />
                <span className="shrink-0">Reply to {m.replyToRole === 'user' ? 'You' : 'AI'}:</span>
                <span className="truncate max-w-[180px] text-muted-foreground/80">{replySnippet(m.content)}</span>
            </button>
        );
    };

    // Auto-grow the composer textarea up to ~4 lines (80px @ leading-5)
    const resizeTextarea = () => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 80) + 'px';
    };

    useEffect(() => {
        resizeTextarea();
    }, [inputQuery]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading, accessedNetwork.nodes]);

    // Elapsed timer while the assistant is thinking.
    useEffect(() => {
        if (!isLoading) {
            setThinkingSeconds(0);
            return;
        }

        const timerInterval = setInterval(() => {
            setThinkingSeconds(prev => prev + 1);
        }, 1000);

        return () => {
            clearInterval(timerInterval);
        };
    }, [isLoading]);

    // Keep the address bar in sync with the active session without a full
    // reload, so refreshing or opening a new tab never jumps to another chat
    // (or silently starts a fresh one on the next message).
    const syncUrlSessionId = (sessionId: number | null) => {
        const url = new URL(window.location.href);
        if (sessionId) {
            url.searchParams.set('session_id', String(sessionId));
        } else {
            url.searchParams.delete('session_id');
        }
        window.history.replaceState(window.history.state, '', url.toString());
    };

    // Handle selecting a different session
    const selectSession = (sessionId: number) => {
        setIsSidebarOpen(false);
        setFilePanelProjectId(null);
        resetComposerRefs();
        router.get(route('assistant.index'), { session_id: sessionId }, {
            preserveState: false,
            preserveScroll: true,
        });
    };

    // Handle creating a new chat session (optionally inside a project)
    const createNewChat = async (projectId?: number | null) => {
        setIsSidebarOpen(false);
        const targetProject = projectId === undefined ? currentProjectId : projectId;
        try {
            const res = await fetch(route('assistant.session.create'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                },
                body: JSON.stringify({ project_id: targetProject ?? null }),
            });
            const data = await res.json();
            if (data.success && data.session) {
                const next = data.session as Session;
                setSessionList(prev => [next, ...prev]);
                addSessionToProject(next);
                setCurrentSessionId(next.id);
                syncUrlSessionId(next.id);
                setMessages([welcomeMessage]);
                resetComposerRefs();
            }
        } catch (e) {
            // fallback: reset state locally
            setCurrentSessionId(null);
            syncUrlSessionId(null);
            setMessages([welcomeMessage]);
        }
    };

    // Handle deleting a session
    const deleteSession = async (sessionId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Hapus sesi obrolan ini?')) return;

        try {
            await fetch(route('assistant.session.destroy', sessionId), {
                method: 'DELETE',
                headers: {
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                }
            });

            const removed = sessionList.find(s => s.id === sessionId);
            setSessionList(prev => prev.filter(s => s.id !== sessionId));
            removeSessionFromProject(sessionId, removed?.project_id);
            resetComposerRefs();

            if (currentSessionId === sessionId) {
                const remaining = sessionList.filter(s => s.id !== sessionId);
                if (remaining.length > 0) {
                    selectSession(remaining[0].id);
                } else {
                    setCurrentSessionId(null);
                    syncUrlSessionId(null);
                    setMessages([welcomeMessage]);
                }
            }
        } catch (err: any) {
            alert('Gagal menghapus sesi: ' + err.message);
        }
    };

    // Handle renaming session
    const startEditingSession = (session: Session, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingSessionId(session.id);
        setEditingSessionTitle(session.title || 'Conversation');
    };

    const saveRenameSession = async (sessionId: number, e?: React.FormEvent | React.FocusEvent) => {
        if (e) e.preventDefault();
        const trimmedTitle = editingSessionTitle.trim();
        if (!trimmedTitle) {
            setEditingSessionId(null);
            return;
        }

        try {
            const res = await fetch(route('assistant.session.update', sessionId), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                },
                body: JSON.stringify({ title: trimmedTitle }),
            });
            const data = await res.json();
            if (data.success) {
                const renaming = sessionList.find(s => s.id === sessionId);
                syncProjectSessionTitle(sessionId, trimmedTitle, renaming?.project_id);
            }
        } catch (err: any) {
            console.error('Failed to rename session:', err);
        } finally {
            setEditingSessionId(null);
        }
    };

    // Save custom training rules for active session
    const saveCustomRules = async () => {
        if (!currentSessionId) return;
        setIsSavingRules(true);
        try {
            const res = await fetch(route('assistant.session.update', currentSessionId), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                },
                body: JSON.stringify({ custom_rules: currentRules, ai_model: currentModel }),
            });
            const data = await res.json();
            if (data.success) {
                setSessionList(prev =>
                    prev.map(s => (s.id === currentSessionId ? { ...s, custom_rules: currentRules, ai_model: currentModel } : s))
                );
                setIsRulesModalOpen(false);
            }
        } catch (err) {
            console.error('Failed to save session preferences:', err);
            alert('Gagal menyimpan preferensi sesi.');
        } finally {
            setIsSavingRules(false);
        }
    };

    const handleSendMessage = async (textToSend?: string) => {
        const uploaded = attachments;
        const rawQuery = (textToSend || inputQuery).trim();
        if (
            (!rawQuery && uploaded.length === 0 && projectFileRefs.length === 0) ||
            isLoading || isUploading
        ) return;

        let query = rawQuery;

        if (replyingTo) {
            const cleanQuote = replyingTo.content.replace(/```action_proposal[\s\S]*?```/g, '').trim();
            const snippet = cleanQuote.length > 80 ? cleanQuote.slice(0, 80) + '...' : cleanQuote;
            query = `[Membalas pesan: "${snippet}"]\n${rawQuery}`;
        }

        // Mentioned project files: explicit picker chips plus any "@filename"
        // token typed inline. Both resolve to the same server-side context.
        const allProjectFiles = currentProject ? flatProjectFiles(currentProject.files) : [];
        const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const mentionedFiles = allProjectFiles.filter(f => {
            const pattern = new RegExp(`(@${escapeRegExp(f.name)})(?:$|[^A-Za-z0-9_.])`);
            return pattern.test(rawQuery);
        });
        const referencedProjectFiles = Array.from(new Set([
            ...projectFileRefs.map(f => f.id),
            ...mentionedFiles.map(f => f.id),
        ]));

        const tempId = 'temp-' + Date.now();
        const userMsg: Message = {
            id: tempId,
            role: 'user',
            content: rawQuery || '📎 ' + [...uploaded.map(a => a.original_name), ...projectFileRefs.map(f => f.name)].join(', '),
            replyToId: replyingTo?.id ?? null,
            replyToRole: replyingTo?.role ?? null,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            attachments: uploaded.map(a => ({ name: a.original_name, kind: a.kind })),
        };

        setMessages(prev => [...prev, userMsg]);
        setInputQuery('');
        setReplyingTo(null);
        setIsLoading(true);
        setAttachments([]);
        resetComposerRefs();
        setAccessedNetwork({ nodes: [], edges: [] });
        setDraftStream('');
        setLiveTiming({});
        setStreamCollapsed(false);

        const applyReply = (data: any) => {
            const looksLikeProposal = !!data.reply && (data.reply.includes('```action_proposal') || data.reply.includes('"action":'));
            const assistantMsg: Message = {
                id: data.message_id || 'assistant-' + Date.now(),
                role: 'assistant',
                content: data.reply || 'Maaf, terjadi kendala saat memproses jawaban.',
                action_status: looksLikeProposal ? 'pending' : null,
                timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };

            setMessages(prev => [...prev, assistantMsg]);
            playCompletionChime(soundEnabled);

            // Update session list with new session or updated title (and keep
            // the project tree mirrored for sessions that live in a project)
            if (data.session_id) {
                setCurrentSessionId(data.session_id);
                syncUrlSessionId(data.session_id);
                const existingSess = sessionList.find(s => s.id === data.session_id);
                setSessionList(prev => {
                    const exists = prev.find(s => s.id === data.session_id);
                    if (exists) {
                        return prev.map(s => s.id === data.session_id ? { ...s, title: data.session_title || s.title } : s);
                    } else {
                        return [{
                            id: data.session_id,
                            project_id: existingSess?.project_id ?? null,
                            title: data.session_title || query.substring(0, 80),
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }, ...prev];
                    }
                });
                if (existingSess?.project_id) {
                    syncProjectSessionTitle(data.session_id, data.session_title || existingSess.title, existingSess.project_id);
                }
            }
        };

        try {
            const response = await fetch(route('assistant.chat'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                },
                body: JSON.stringify({
                    message: query,
                    session_id: currentSessionId,
                    project_id: currentProjectId ?? undefined,
                    attachments: uploaded.map(a => a.id),
                    project_file_ids: referencedProjectFiles.length > 0 ? referencedProjectFiles : undefined,
                    model: currentModel || aiConfig.model || undefined,
                })
            });

            const contentType = response.headers.get('content-type') || '';

            if (!response.ok) {
                const text = await response.text();
                let errorMsg = `Server error (${response.status})`;
                try {
                    const parsed = JSON.parse(text);
                    if (parsed.message) errorMsg = parsed.message;
                    if (parsed.reply) errorMsg = parsed.reply;
                } catch {
                    // response is HTML error page
                }
                throw new Error(errorMsg);
            }

            if (contentType.includes('ndjson')) {
                // Live stream: accessed neurons + tokens render while thinking.
                const last = await consumeNdjson(response, {
                    onNeurons: (nodes, edges) => setAccessedNetwork({ nodes, edges }),
                    onToken: (text) => setDraftStream(prev => prev + text),
                    onTiming: (phase, snap) => setLiveTiming(prev => phase === 'total' ? snap : { ...prev, ...snap }),
                    onLearned: (evt) => {
                        const count = Number(evt.notes_count ?? 1);
                        if (count > 0) {
                            showCornerToast(
                                count === 1 ? 'Saved to new node' : `${count} new nodes saved`,
                                evt.title || (typeof evt.message === 'string' ? evt.message : undefined) || 'AI memory updated'
                            );
                        }
                    },
                });
                if (!last || last.type === 'error') {
                    throw new Error(
                        last?.reply ||
                        'The server did not reply — the file may be too large or the AI is busy. Try again, split the file into smaller parts, or wait a moment.'
                    );
                }
                setDraftStream('');
                applyReply(last);
            } else {
                const data = await response.json();
                applyReply(data);
            }
        } catch (error: any) {
            setDraftStream('');
            setMessages(prev => [
                ...prev,
                {
                    id: 'assistant-err-' + Date.now(),
                    role: 'assistant',
                    content: 'Terjadi kesalahan jaringan atau server saat memproses pesan: ' + error.message,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }
            ]);
        } finally {
            setDraftStream('');
            setIsLoading(false);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
            return;
        }
        if (e.key === '@' && currentProject && mentionFiles.length > 0) {
            setMentionMenuOpen(true);
            setMentionFilter('');
            return;
        }
        if (e.key === 'Escape' && mentionMenuOpen) {
            setMentionMenuOpen(false);
        }
    };

    const csrfToken = (): string =>
        (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';

    const uploadFiles = (files: File[]) => {
        if (files.length === 0) return;
        if (!aiConfig.is_configured) {
            alert('AI Assistant has not been configured yet. Set the API key in Settings first.');
            return;
        }

        setIsUploading(true);
        Promise.all(files.map(async (file) => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(route('assistant.upload'), {
                method: 'POST',
                headers: { 'X-CSRF-TOKEN': csrfToken() },
                body: formData,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.message || `Upload failed (${res.status})`);
            }
            const data = await res.json();
            return data.attachment as UploadedAttachment;
        })).then((uploaded) => {
            setAttachments(prev => [...prev, ...uploaded]);
        }).catch((err) => {
            alert('Gagal mengunggah file: ' + err.message);
        }).finally(() => {
            setIsUploading(false);
        });
    };

    const handlePickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        uploadFiles(files);
    };

    // --- Drag & drop file attach ---
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        if (isLoading || isUploading) return;
        dragCounterRef.current += 1;
        setIsDragOver(true);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragOver(false);
        if (isLoading || isUploading) return;
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length > 0) {
            uploadFiles(files);
        }
    };

    const removeAttachment = (id: number) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    };

    // ===================== Projects & Project Files =====================

    const currentProjectId = sessionList.find(s => s.id === currentSessionId)?.project_id ?? null;
    const currentProject = projectList.find(p => p.id === currentProjectId) ?? null;
    const orphanSessions = sessionList.filter(s => !s.project_id);

    const flatProjectFiles = (nodes: ProjectFileNode[]): ProjectFileNode[] => {
        const out: ProjectFileNode[] = [];
        for (const n of nodes) {
            if (n.is_folder) out.push(...flatProjectFiles(n.children || []));
            else out.push(n);
        }
        return out;
    };

    const toggleProject = (projectId: number) => {
        setExpandedProjects(prev => {
            const next = new Set(prev);
            if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
            return next;
        });
    };

    const syncProjectSessionTitle = (sessionId: number, title: string, projectId?: number | null) => {
        setSessionList(prev => prev.map(s => (s.id === sessionId ? { ...s, title } : s)));
        if (projectId) {
            setProjectList(prev => prev.map(p => p.id === projectId
                ? { ...p, sessions: p.sessions.map(s => (s.id === sessionId ? { ...s, title } : s)) }
                : p));
        }
    };

    const addSessionToProject = (session: Session) => {
        if (!session.project_id) return;
        setProjectList(prev => prev.map(p => {
            if (p.id !== session.project_id) return p;
            const exists = p.sessions.some(s => s.id === session.id);
            return {
                ...p,
                sessions: exists ? p.sessions.map(s => (s.id === session.id ? session : s)) : [session, ...p.sessions],
            };
        }));
        setExpandedProjects(prev => new Set(prev).add(session.project_id!));
    };

    const removeSessionFromProject = (sessionId: number, projectId?: number | null) => {
        if (!projectId) return;
        setProjectList(prev => prev.map(p => p.id === projectId
            ? { ...p, sessions: p.sessions.filter(s => s.id !== sessionId) }
            : p));
    };

    const updateFileTree = (projectId: number, updater: (nodes: ProjectFileNode[]) => ProjectFileNode[]) => {
        setProjectList(prev => prev.map(p => (p.id === projectId ? { ...p, files: updater(p.files) } : p)));
    };

    const insertFileNode = (nodes: ProjectFileNode[], parentId: number | null, node: ProjectFileNode): ProjectFileNode[] => {
        if (parentId === null) return [node, ...nodes];
        return nodes.map(n =>
            n.is_folder && n.id === parentId
                ? { ...n, children: insertFileNode(n.children || [], null, node) }
                : n
        );
    };

    const removeFileNode = (nodes: ProjectFileNode[], id: number): ProjectFileNode[] =>
        nodes.filter(n => n.id !== id).map(n =>
            n.is_folder ? { ...n, children: removeFileNode(n.children || [], id) } : n
        );

    const createNewProject = async () => {
        setIsSidebarOpen(false);
        const title = window.prompt('Project name:')?.trim();
        if (!title) return;
        try {
            const res = await fetch(route('assistant.project.create'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                body: JSON.stringify({ title }),
            });
            const data = await res.json();
            if (data.success && data.project) {
                const proj: AiProject = data.project;
                setProjectList(prev => [proj, ...prev]);
                setExpandedProjects(prev => new Set(prev).add(proj.id));
                const first = proj.sessions[0];
                if (first) {
                    const nextSession: Session = { ...first, project_id: proj.id, custom_rules: null, ai_model: null };
                    setSessionList(prev => [nextSession, ...prev]);
                    setCurrentSessionId(first.id);
                    syncUrlSessionId(first.id);
                    setMessages([welcomeMessage]);
                }
            }
        } catch (err: any) {
            alert('Gagal membuat proyek: ' + (err?.message || 'unknown error'));
        }
    };

    const startEditingProject = (project: AiProject, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingProjectId(project.id);
        setEditingProjectTitle(project.title || 'Project');
    };

    const saveRenameProject = async (projectId: number, e?: React.FormEvent | React.FocusEvent) => {
        if (e) e.preventDefault();
        const trimmed = editingProjectTitle.trim();
        if (!trimmed) {
            setEditingProjectId(null);
            return;
        }
        try {
            const res = await fetch(route('assistant.project.update', projectId), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                body: JSON.stringify({ title: trimmed }),
            });
            const data = await res.json();
            if (data.success) {
                setProjectList(prev => prev.map(p => (p.id === projectId ? { ...p, title: trimmed } : p)));
            }
        } catch (err: any) {
            console.error('Failed to rename project:', err);
        } finally {
            setEditingProjectId(null);
        }
    };

    const deleteProject = async (projectId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Delete this project and all its chats & files? This cannot be undone.')) return;
        try {
            await fetch(route('assistant.project.destroy', projectId), {
                method: 'DELETE',
                headers: { 'X-CSRF-TOKEN': csrfToken() },
            });
            const wasCurrent = currentProjectId === projectId;
            setProjectList(prev => prev.filter(p => p.id !== projectId));
            setSessionList(prev => prev.filter(s => s.project_id !== projectId));
            if (wasCurrent) resetComposerRefs();
            setFilePanelProjectId(prev => (prev === projectId ? null : prev));
            setViewerFile(prev => (prev && prev.projectId === projectId ? null : prev));
            if (wasCurrent) {
                const remaining = sessionList.filter(s => s.project_id !== projectId);
                if (remaining.length > 0) selectSession(remaining[0].id);
                else {
                    setCurrentSessionId(null);
                    syncUrlSessionId(null);
                    setMessages([welcomeMessage]);
                }
            }
        } catch (err: any) {
            alert('Gagal menghapus proyek: ' + (err?.message || 'unknown error'));
        }
    };

    // Upload project files (max 10 MB each) into the file panel's project.
    const uploadProjectFiles = async (projectId: number, files: File[], parentId: number | null) => {
        if (files.length === 0) return;
        setIsProjectUploading(true);
        try {
            for (const file of files) {
                if (file.size > 10 * 1024 * 1024) {
                    alert(`"${file.name}" is larger than the 10 MB per-file limit for project files.`);
                    continue;
                }
                const formData = new FormData();
                formData.append('file', file);
                if (parentId) formData.append('parent_id', String(parentId));
                const res = await fetch(route('assistant.project.files.upload', projectId), {
                    method: 'POST',
                    headers: { 'X-CSRF-TOKEN': csrfToken() },
                    body: formData,
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => null);
                    throw new Error(body?.message || `Upload failed (${res.status})`);
                }
                const data = await res.json();
                if (data.success && data.file) {
                    updateFileTree(projectId, nodes => insertFileNode(nodes, parentId, data.file as ProjectFileNode));
                }
            }
        } catch (err: any) {
            alert('Gagal mengunggah file: ' + err.message);
        } finally {
            setIsProjectUploading(false);
        }
    };

    const pickProjectFiles = (parentId: number | null) => {
        fileUploadTargetRef.current = parentId;
        projectFileInputRef.current?.click();
    };

    const handleProjectFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        const parentId = fileUploadTargetRef.current;
        fileUploadTargetRef.current = null;
        if (files.length > 0 && filePanelProjectId) {
            uploadProjectFiles(filePanelProjectId, files, parentId);
        }
    };

    const createProjectFolder = async (projectId: number, parentId: number | null) => {
        const name = window.prompt('Folder name:')?.trim();
        if (!name) return;
        try {
            const res = await fetch(route('assistant.project.folders.store', projectId), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrfToken(),
                },
                body: JSON.stringify({ name, parent_id: parentId ?? undefined }),
            });
            const data = await res.json();
            if (data.success && data.file) {
                updateFileTree(projectId, nodes => insertFileNode(nodes, parentId, data.file as ProjectFileNode));
                if (parentId) setOpenFileFolders(prev => new Set(prev).add(parentId));
            }
        } catch (err: any) {
            alert('Gagal membuat folder: ' + (err?.message || 'unknown error'));
        }
    };

    const deleteProjectFileEntry = async (projectId: number, entry: ProjectFileNode) => {
        if (!window.confirm(`Delete "${entry.name}"${entry.is_folder ? ' and everything inside it' : ''}?`)) return;
        try {
            await fetch(route('assistant.project.files.destroy', [projectId, entry.id]), {
                method: 'DELETE',
                headers: { 'X-CSRF-TOKEN': csrfToken() },
            });
            updateFileTree(projectId, nodes => removeFileNode(nodes, entry.id));
            setProjectFileRefs(prev => prev.filter(f => f.id !== entry.id));
            setViewerFile(prev => (prev && prev.file.id === entry.id ? null : prev));
        } catch (err: any) {
            alert('Gagal menghapus: ' + (err?.message || 'unknown error'));
        }
    };

    const toggleProjectFileRef = (file: ProjectFileNode) => {
        setProjectFileRefs(prev =>
            prev.some(f => f.id === file.id)
                ? prev.filter(f => f.id !== file.id)
                : [...prev, file]
        );
    };

    const resetComposerRefs = () => {
        setProjectFileRefs([]);
        setMentionMenuOpen(false);
        setMentionFilter('');
    };

    const fileIconFor = (kind: string) => {
        const Ic = kind === 'image' ? ImageIcon
            : kind === 'archive' ? FileArchive
            : kind === 'spreadsheet' ? FileSpreadsheet
            : kind === 'pdf' || kind === 'document' ? FileText
            : FileCode2;
        return Ic;
    };

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const toPlainText = (text: string): string => {
        let t = text;

        // Drop internal AI payloads (action proposal / memory notes) entirely
        t = t.replace(/```action_proposal[\s\S]*?```/g, '');
        t = t.replace(/```ai_memo[\s\S]*?```/g, '');

        // Keep other fenced code content but drop the fences
        t = t.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => '\n' + code.trim() + '\n');

        const out: string[] = [];
        for (const rawLine of t.split('\n')) {
            const trimmed = rawLine.trim();

            // Markdown table row -> tab-separated cells (paste-ready for spreadsheets)
            if (/^\|.*\|\s*$/.test(trimmed)) {
                const cells = trimmed
                    .replace(/^\||\|$/g, '')
                    .split('|')
                    .map(c => c.trim().replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`(.*?)`/g, '$1'));
                if (cells.every(c => /^[-:]+$/.test(c))) continue; // skip header separator row
                out.push(cells.join('\t'));
                continue;
            }

            if (/^\s*(---|\*\*\*|___)\s*$/.test(rawLine)) continue; // horizontal rule

            let line = rawLine;
            line = line.replace(/^>\s?/, '');                       // blockquote
            line = line.replace(/^[-*+]\s+/, '');                   // bullet list
            line = line.replace(/^\d+[.)]\s+/, '');                 // numbered list
            line = line.replace(/^#{1,6}\s+/, '');                  // heading
            line = line.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');   // image -> alt text
            line = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');    // link -> label only
            line = line.replace(/\*\*(.*?)\*\*/g, '$1');            // bold
            line = line.replace(/__(.*?)__/g, '$1');                // bold (alt)
            line = line.replace(/\*(.*?)\*/g, '$1');                // italic
            line = line.replace(/~~(.*?)~~/g, '$1');                // strikethrough
            line = line.replace(/`([^`]*)`/g, '$1');                // inline code

            out.push(line.replace(/\s+$/, ''));
        }

        return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    };

    const copyMessage = async (id: string, text: string) => {
        // Pure plain text ready to paste: no **, #, table pipes, links — tables
        // become tab-separated columns for spreadsheets.
        const cleanText = toPlainText(text);

        try {
            await navigator.clipboard.writeText(cleanText);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = cleanText;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopiedId(id);
        setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 1500);
    };

    // ===================== Sidebar render helpers =====================

    const renderSessionRow = (s: Session) => {
        const isActive = s.id === currentSessionId;
        const isEditingThis = editingSessionId === s.id;

        return (
            <div
                key={s.id}
                onClick={() => !isEditingThis && selectSession(s.id)}
                className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium cursor-pointer transition ${
                    isActive
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-foreground hover:bg-muted/60'
                }`}
            >
                <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                    <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    {isEditingThis ? (
                        <form
                            onSubmit={(e) => saveRenameSession(s.id, e)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0"
                        >
                            <input
                                type="text"
                                value={editingSessionTitle}
                                onChange={(e) => setEditingSessionTitle(e.target.value)}
                                onBlur={() => saveRenameSession(s.id)}
                                autoFocus
                                className="w-full rounded-md border border-primary/50 bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </form>
                    ) : (
                        <span className="truncate">{s.title || 'Conversation'}</span>
                    )}
                </div>

                {!isEditingThis && (
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition">
                        <button
                            type="button"
                            onClick={(e) => startEditingSession(s, e)}
                            className="p-1 rounded-lg hover:bg-muted hover:text-foreground text-muted-foreground transition"
                            title="Rename chat"
                        >
                            <Pencil className="h-3 w-3" />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => deleteSession(s.id, e)}
                            className="p-1 rounded-lg hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition"
                            title="Delete session"
                        >
                            <Trash2 className="h-3 w-3" />
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const toggleFileFolder = (folderId: number) => {
        setOpenFileFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
            return next;
        });
    };

    const renderFileTree = (nodes: ProjectFileNode[], depth: number) => {
        if (!filePanelProjectId) return null;
        const fileProjectId = filePanelProjectId;

        return nodes.map(node => {
            const pad = { paddingLeft: `${Math.min(8 + depth * 14, 44)}px` };
            if (node.is_folder) {
                const open = openFileFolders.has(node.id);
                return (
                    <div key={node.id}>
                        <div
                            className="group flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg cursor-pointer transition hover:bg-muted/60"
                            style={pad}
                            onClick={() => toggleFileFolder(node.id)}
                        >
                            <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                            {open
                                ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                                : <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />}
                            <span className="truncate flex-1 min-w-0 text-xs font-medium">{node.name}</span>
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition">
                                <button
                                    type="button"
                                    title="Upload into this folder"
                                    onClick={(e) => { e.stopPropagation(); pickProjectFiles(node.id); }}
                                    className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                                >
                                    <Upload className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    title="New folder here"
                                    onClick={(e) => { e.stopPropagation(); createProjectFolder(fileProjectId, node.id); }}
                                    className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                                >
                                    <FolderPlus className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    title="Delete folder"
                                    onClick={(e) => { e.stopPropagation(); deleteProjectFileEntry(fileProjectId, node); }}
                                    className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                        {open && node.children && node.children.length > 0 && renderFileTree(node.children, depth + 1)}
                    </div>
                );
            }

            const Ic = fileIconFor(node.kind);
            return (
                <div
                    key={node.id}
                    className="group flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg cursor-pointer transition hover:bg-muted/60"
                    style={pad}
                    onClick={() => setViewerFile({ projectId: fileProjectId, file: node })}
                    title={`${node.name} — click to preview`}
                >
                    <Ic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1 min-w-0 text-xs">{node.name}</span>
                    <span className="text-[9.5px] text-muted-foreground/70 shrink-0">{node.size_bytes ? formatBytes(node.size_bytes) : ''}</span>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition">
                        <a
                            title="Download"
                            href={route('assistant.project.files.download', [fileProjectId, node.id])}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                        >
                            <Download className="h-3 w-3" />
                        </a>
                        <button
                            type="button"
                            title="Delete file"
                            onClick={(e) => { e.stopPropagation(); deleteProjectFileEntry(fileProjectId, node); }}
                            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                        >
                            <Trash2 className="h-3 w-3" />
                        </button>
                    </div>
                </div>
            );
        });
    };

    const renderFileExplorer = () => {
        const proj = projectList.find(p => p.id === filePanelProjectId);
        if (!proj) return null;
        const totalFiles = flatProjectFiles(proj.files).length;

        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between px-1.5 pt-1">
                    <button
                        type="button"
                        onClick={() => setFilePanelProjectId(null)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                    >
                        <ChevronLeft className="h-3 w-3" />
                        Back to chats
                    </button>
                </div>

                <div className="px-1.5">
                    <div className="text-[10.5px] font-semibold text-primary truncate">{proj.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                        {totalFiles} file{totalFiles !== 1 ? 's' : ''} in this project
                    </div>
                </div>

                <div className="flex gap-1.5 px-1.5">
                    <button
                        type="button"
                        onClick={() => pickProjectFiles(null)}
                        disabled={isProjectUploading}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-background/60 hover:bg-muted/80 px-2 py-1.5 text-[11px] font-semibold text-foreground transition active:scale-95 disabled:opacity-50"
                    >
                        {isProjectUploading
                            ? <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            : <Upload className="h-3 w-3 text-primary" />}
                        Upload
                    </button>
                    <button
                        type="button"
                        onClick={() => createProjectFolder(proj.id, null)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-background/60 hover:bg-muted/80 px-2 py-1.5 text-[11px] font-semibold text-foreground transition active:scale-95"
                    >
                        <FolderPlus className="h-3 w-3 text-primary" />
                        Folder
                    </button>
                </div>

                <input
                    ref={projectFileInputRef}
                    type="file"
                    multiple
                    onChange={handleProjectFilePick}
                    className="hidden"
                    aria-label="Upload project files"
                />

                <div className="pt-1 pb-2 space-y-0.5">
                    {proj.files.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground text-center py-4 px-3">
                            No files yet. Upload code, docs, sheets, or images — up to 10 MB each.
                        </p>
                    ) : (
                        renderFileTree(proj.files, 0)
                    )}
                </div>

                <p className="px-1.5 pb-1 text-[9.5px] leading-relaxed text-muted-foreground/70">
                    Type <span className="font-mono text-primary/80">@filename</span> or use{' '}
                    <span className="font-mono text-primary/80">@</span> in the composer to reference
                    files from any session of this project.
                </p>
            </div>
        );
    };

    const renderProjectRow = (proj: AiProject) => {
        const isExpanded = expandedProjects.has(proj.id);
        const isEditingThis = editingProjectId === proj.id;

        return (
            <div key={proj.id} className="mb-0.5">
                <div
                    className={`group flex items-center gap-1 px-2 py-1.5 rounded-xl cursor-pointer transition ${
                        currentProjectId === proj.id ? 'bg-primary/5' : 'hover:bg-muted/60'
                    }`}
                    onClick={() => toggleProject(proj.id)}
                >
                    <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    {isExpanded
                        ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                        : <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />}

                    {isEditingThis ? (
                        <form
                            className="flex-1 min-w-0"
                            onClick={(e) => e.stopPropagation()}
                            onSubmit={(e) => saveRenameProject(proj.id, e)}
                        >
                            <input
                                type="text"
                                value={editingProjectTitle}
                                onChange={(e) => setEditingProjectTitle(e.target.value)}
                                onBlur={() => saveRenameProject(proj.id)}
                                autoFocus
                                className="w-full rounded-md border border-primary/50 bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </form>
                    ) : (
                        <span className="truncate flex-1 min-w-0 text-xs font-semibold">{proj.title || 'Project'}</span>
                    )}

                    <span className="shrink-0 text-[9.5px] font-mono text-muted-foreground/60">
                        {proj.sessions.length}
                    </span>

                    {!isEditingThis && (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition">
                            <button
                                type="button"
                                title="Open file explorer for this project"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setFilePanelProjectId(proj.id);
                                }}
                                className="p-1 rounded-lg hover:bg-muted hover:text-foreground text-muted-foreground transition"
                            >
                                <FileIcon className="h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                title="Rename project"
                                onClick={(e) => startEditingProject(proj, e)}
                                className="p-1 rounded-lg hover:bg-muted hover:text-foreground text-muted-foreground transition"
                            >
                                <Pencil className="h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                title="Delete project"
                                onClick={(e) => deleteProject(proj.id, e)}
                                className="p-1 rounded-lg hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition"
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    )}
                </div>

                {isExpanded && (
                    <div className="ml-3.5 pl-2 border-l border-border/40 space-y-0.5">
                        {proj.sessions.length === 0 ? (
                            <p className="text-[10.5px] text-muted-foreground px-2 py-1.5">
                                No sessions yet.
                            </p>
                        ) : (
                            proj.sessions.map(s => renderSessionRow({ ...s, project_id: proj.id }))
                        )}
                    </div>
                )}
            </div>
        );
    };

    // ===================== Composer mention menu =====================

    const mentionFiles = currentProject ? flatProjectFiles(currentProject.files) : [];
    const filteredMentionFiles = mentionFiles.filter(f =>
        f.name.toLowerCase().includes(mentionFilter.toLowerCase())
    );

    return (
        <AuthenticatedLayout hideMobileNav={true} hideNavbar={chatOnly}>
            <Head title={chatOnly ? 'Chat - Daily Phone Intelligence' : 'Assistant - Daily Phone Intelligence'} />

            {/* Container: Fullscreen on mobile/tablet, wide & spacious on desktop (w-full max-w-7xl).
                Chat-only mode drops the app nav shell, so it always fills the full viewport height. */}
            <div
                className={
                    chatOnly
                        ? 'p-0 sm:p-0 w-full max-w-7xl mx-auto h-[100dvh] sm:h-[100dvh] md:h-[100dvh] flex flex-col relative'
                        : 'p-0 sm:p-0 md:py-4 md:px-4 lg:px-6 w-full max-w-7xl mx-auto h-[100dvh] sm:h-[100dvh] md:h-[calc(100vh-80px)] flex flex-col relative'
                }
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >

                {/* Main Container with Sidebar + Chat Area */}
                <div className="flex-1 flex overflow-hidden bg-card relative md:border md:border-border/50 md:rounded-2xl md:shadow-sm">

                    {/* Left Sidebar: Chat Sessions History */}
                    <div
                        className={`absolute inset-y-0 left-0 z-30 bg-card/95 backdrop-blur-xl border-border/50 flex flex-col transition-all duration-200 ease-in-out md:static ${
                            isSidebarOpen
                                ? 'translate-x-0 w-64 sm:w-72 border-r opacity-100 shadow-xl'
                                : '-translate-x-full w-0 -ml-1 opacity-0 overflow-hidden border-none pointer-events-none'
                        }`}
                    >
                        {/* New Project + New Chat */}
                        <div className="p-3 border-b border-border/40 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <button
                                    onClick={createNewProject}
                                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95 active:scale-[0.98] transition shadow-2xs"
                                >
                                    <FolderPlus className="h-3.5 w-3.5" />
                                    <span>New Project</span>
                                </button>
                                <button
                                    onClick={() => setIsSidebarOpen(false)}
                                    className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:bg-muted/70"
                                >
                                    <PanelLeftClose className="h-4 w-4" />
                                </button>
                            </div>
                            <button
                                onClick={() => createNewChat()}
                                className="w-full flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-background/60 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/80 active:scale-[0.98] transition"
                            >
                                <Plus className="h-3.5 w-3.5 text-primary" />
                                <span>New Chat</span>
                            </button>
                        </div>

                        {/* Projects / Sessions OR File Explorer */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {filePanelProjectId !== null ? (
                                renderFileExplorer()
                            ) : projectList.length === 0 && orphanSessions.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground text-center py-6 px-3">
                                    No projects yet. Create a project to organise your chats and files!
                                </p>
                            ) : (
                                <>
                                    {projectList.map(proj => renderProjectRow(proj))}

                                    {orphanSessions.length > 0 && (
                                        <>
                                            <div className="px-2 pt-2.5 pb-1 text-[9.5px] font-bold tracking-[0.08em] text-muted-foreground/60">
                                                MY CHATS
                                            </div>
                                            <div className="space-y-0.5">
                                                {orphanSessions.map(s => renderSessionRow(s))}
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Footer in Sidebar */}
                        <div className="p-2.5 border-t border-border/40 space-y-1.5">
                            <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                                <span className="truncate">
                                    {projectList.length} Project{projectList.length !== 1 ? 's' : ''} · {sessionList.length} Sessions
                                </span>
                            </div>
                            {userRole === 'superadmin' && !chatOnly && (
                                <div className="grid grid-cols-2 gap-1.5">
                                    <Link
                                        href={route('settings.ai.training-notes')}
                                        className="flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                                        title="AI memory neuron map"
                                    >
                                        <Network className="h-3 w-3" />
                                        <span>Memory Map</span>
                                    </Link>
                                    <Link
                                        href={route('settings.general')}
                                        className="flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-muted-foreground hover:text-primary hover:bg-primary/10 transition"
                                        title="AI Config"
                                    >
                                        <Settings className="h-3 w-3" />
                                        <span>AI Config</span>
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Backdrop on mobile when sidebar is open */}
                    {isSidebarOpen && (
                        <div
                            onClick={() => setIsSidebarOpen(false)}
                            className="absolute inset-0 bg-black/40 z-[25] md:hidden backdrop-blur-xs"
                        />
                    )}

                    {/* Right Area: Active Chat */}
                    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background md:bg-card relative">

                        {/* Floating Top Header - Liquid Glass Capsule (like mobile ChatGPT app) */}
                        <div className="absolute top-3 left-3 right-3 z-[15] pointer-events-none flex justify-center">
                            <div className="pointer-events-auto w-full max-w-3xl flex items-center justify-between px-3.5 py-2 rounded-2xl bg-background/80 dark:bg-card/75 backdrop-blur-2xl border border-border/50 shadow-lg shadow-black/5 dark:shadow-black/20">
                                <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
                                    {chatOnly ? (
                                        <span
                                            className="p-1.5 rounded-xl text-primary shrink-0"
                                            title="Daily Phone Intelligence"
                                        >
                                            <GeminiStar className="h-4 w-4" />
                                        </span>
                                    ) : (
                                        <Link
                                            href={route('dashboard')}
                                            title="Back to Dashboard"
                                            className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/70 active:scale-95 transition shrink-0"
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Link>
                                    )}
                                    <button
                                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                        className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/70 active:scale-95 transition shrink-0"
                                        title="Sidebar"
                                    >
                                        <PanelLeft className="h-4 w-4" />
                                    </button>
                                    <h1
                                        className="text-xs sm:text-sm font-semibold tracking-tight text-foreground truncate min-w-0 max-w-full pl-1"
                                        title={sessionList.find(s => s.id === currentSessionId)?.title || 'Assistant'}
                                    >
                                        {sessionList.find(s => s.id === currentSessionId)?.title || 'Assistant'}
                                    </h1>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                    {/* Session Preference / Training Button */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const active = sessionList.find(s => s.id === currentSessionId);
                                            setCurrentRules(active?.custom_rules || '');
                                            setCurrentModel(active?.ai_model || aiConfig.model || '');
                                            setIsRulesModalOpen(true);
                                        }}
                                        title="Session preference"
                                        className={`p-1.5 rounded-xl border transition shadow-2xs active:scale-95 flex items-center gap-1 text-[11px] ${
                                            sessionList.find(s => s.id === currentSessionId)?.custom_rules ||
                                            sessionList.find(s => s.id === currentSessionId)?.ai_model
                                                ? 'border-primary/50 bg-primary/10 text-primary font-semibold'
                                                : 'border-border/50 bg-background/70 hover:bg-muted/80 text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        <Sliders className="h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">Preference</span>
                                    </button>

                                    <button
                                        onClick={() => createNewChat()}
                                        title="New chat"
                                        className="flex items-center gap-1 rounded-xl border border-border/50 bg-background/70 hover:bg-muted/80 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition shadow-2xs active:scale-95"
                                    >
                                        <Plus className="h-3.5 w-3.5 text-primary" />
                                        <span className="hidden sm:inline">New</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Messages List Area (Scrollable body) - Top padded for floating header */}
                        <div className="flex-1 overflow-y-auto px-4 sm:px-8 md:px-12 lg:px-20 pt-16 pb-24 space-y-6">
                            {messages.map((m) => {
                                const isUser = m.role === 'user';

                                // Extract action_proposal codeblock if present
                                let textContent = m.content;
                                let proposalData: ActionProposalData | null = null;

                                if (!isUser && (
                                    m.content.includes('```action_proposal') ||
                                    m.content.includes('```json') ||
                                    m.content.includes('"action":')
                                )) {
                                    // Try matching properly closed codeblock first, fallback to unclosed codeblock or raw JSON object
                                    let jsonStr: string | null = null;
                                    let matchedBlock: string | null = null;

                                    const closedMatch = m.content.match(/```(?:action_proposal|json)?\s*(\{[\s\S]*?\})\s*```/);
                                    if (closedMatch && closedMatch[1]) {
                                        jsonStr = closedMatch[1];
                                        matchedBlock = closedMatch[0];
                                    } else {
                                        const openMatch = m.content.match(/```(?:action_proposal|json)?\s*(\{[\s\S]*)/);
                                        if (openMatch && openMatch[1]) {
                                            jsonStr = openMatch[1].trim();
                                            matchedBlock = openMatch[0];
                                        } else {
                                            // Handle raw JSON without codeblock
                                            const rawJsonMatch = m.content.match(/(\{[\s\S]*"action"\s*:\s*"[^"]+"[\s\S]*\})/);
                                            if (rawJsonMatch && rawJsonMatch[1]) {
                                                jsonStr = rawJsonMatch[1].trim();
                                                matchedBlock = rawJsonMatch[0];
                                            } else {
                                                // Even if unclosed raw JSON at the end of message
                                                const unclosedRaw = m.content.match(/(\{[\s\S]*"action"\s*:\s*"[^"]+"[\s\S]*)/);
                                                if (unclosedRaw && unclosedRaw[1]) {
                                                    jsonStr = unclosedRaw[1].trim();
                                                    matchedBlock = unclosedRaw[0];
                                                }
                                            }
                                        }
                                    }

                                    if (jsonStr) {
                                        try {
                                            const parsed = JSON.parse(jsonStr);
                                            if (parsed && parsed.action) {
                                                proposalData = parsed;
                                                if (matchedBlock) {
                                                    textContent = m.content.replace(matchedBlock, '').trim();
                                                }
                                            }
                                        } catch (e) {
                                            // If JSON was cut off at the end, attempt simple bracket repair
                                            try {
                                                let repaired = jsonStr.trim();
                                                if (repaired.includes('"items": [') && !repaired.endsWith('}')) {
                                                    // Close unclosed array and object if trailing
                                                    const lastBrace = repaired.lastIndexOf('}');
                                                    if (lastBrace > -1) {
                                                        repaired = repaired.substring(0, lastBrace + 1) + '\n  ]\n}';
                                                        const recovered = JSON.parse(repaired);
                                                        if (recovered && recovered.action) {
                                                            proposalData = recovered;
                                                            if (matchedBlock) {
                                                                textContent = m.content.replace(matchedBlock, '').trim();
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch {
                                                // Ignore incomplete JSON stream cut-offs
                                            }
                                        }
                                    }
                                }

                                if (isUser) {
                                    return (
                                        <div key={m.id} data-message-id={m.id} className="flex flex-col items-end max-w-3xl mx-auto space-y-1">
                                            {renderReplyChip(m)}
                                            <div className="max-w-[85%] sm:max-w-[75%] rounded-3xl bg-primary text-primary-foreground px-4 py-2.5 shadow-2xs">
                                                {m.attachments && m.attachments.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                                                        {m.attachments.map((att, ai) => {
                                                            const Ic = att.kind === 'image' ? ImageIcon
                                                                : att.kind === 'archive' ? FileArchive
                                                                : att.kind === 'spreadsheet' ? FileSpreadsheet
                                                                : FileText;
                                                            return (
                                                                <span
                                                                    key={ai}
                                                                    className="inline-flex items-center gap-1 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10.5px] font-medium"
                                                                    title={att.name}
                                                                >
                                                                    <Ic className="h-3 w-3 shrink-0" />
                                                                    <span className="max-w-[120px] truncate">{att.name}</span>
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <div className="whitespace-pre-wrap select-text text-[13px] leading-relaxed break-words">
                                                    {m.content}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 px-2 text-[10.5px] text-muted-foreground/75">
                                                <span className="font-mono select-none">
                                                    {m.timestamp}
                                                </span>
                                                <button
                                                    onClick={() => copyMessage(m.id, m.content)}
                                                    title="Copy message"
                                                    className="p-1 rounded-md text-muted-foreground/60 hover:text-primary hover:bg-muted/60 transition"
                                                >
                                                    {copiedId === m.id ? (
                                                        <Check className="h-3 w-3 text-primary" />
                                                    ) : (
                                                        <Copy className="h-3 w-3" />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleReply(m)}
                                                    title="Reply to this message"
                                                    className="p-1 rounded-md text-muted-foreground/60 hover:text-primary hover:bg-muted/60 transition flex items-center gap-1"
                                                >
                                                    <Reply className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }

                                // AI Assistant Message: Clean, flat, open ChatGPT-style layout (no bubble, no avatar box, full spacious text)
                                return (
                                    <div key={m.id} data-message-id={m.id} className="max-w-3xl mx-auto text-foreground">
                                        {renderReplyChip(m)}
                                        <div className="space-y-3">
                                            {textContent && (
                                                <div className="text-[13px] leading-relaxed">
                                                    <Markdown content={textContent} />
                                                </div>
                                            )}

                                            {proposalData && (
                                                <div className="pt-1">
                                                    <AiActionProposalCard
                                                        proposal={proposalData}
                                                        sessionId={currentSessionId}
                                                        messageId={m.id}
                                                        initialStatus={m.action_status}
                                                        isSuperadmin={userRole === 'superadmin'}
                                                        onStatusChange={(newStatus) => {
                                                            setMessages(prev =>
                                                                prev.map(item =>
                                                                    item.id === m.id
                                                                        ? { ...item, action_status: newStatus }
                                                                        : item
                                                                )
                                                            );
                                                        }}
                                                        onFeedbackComment={(defaultText) => {
                                                            setInputQuery(defaultText || '');
                                                            setTimeout(() => {
                                                                inputRef.current?.focus();
                                                            }, 50);
                                                        }}
                                                        onFilesSaved={(files) => {
                                                            const savedNodes = files
                                                                .map(f => f.project_file)
                                                                .filter((n): n is NonNullable<typeof n> => Boolean(n))
                                                                .map(n => ({ ...n, children: [] }));

                                                            if (savedNodes.length === 0) return;

                                                            const projectId = sessionList.find(s => s.id === currentSessionId)?.project_id;
                                                            if (!projectId) return;

                                                            updateFileTree(projectId, tree =>
                                                                savedNodes.reduce(
                                                                    (acc, node) => insertFileNode(acc, null, node),
                                                                    tree
                                                                )
                                                            );
                                                            setExpandedProjects(prev => new Set(prev).add(projectId));
                                                            showCornerToast(
                                                                `Saved ${savedNodes.length} file${savedNodes.length > 1 ? 's' : ''} to project`,
                                                                savedNodes.map(n => n.name).join(', ')
                                                            );
                                                        }}
                                                    />
                                                </div>
                                            )}

                                            <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground/75 pt-1">
                                                <span className="font-mono select-none">{m.timestamp}</span>
                                                <button
                                                    onClick={() => copyMessage(m.id, m.content)}
                                                    title="Copy response"
                                                    className="p-1 rounded-md text-muted-foreground/60 hover:text-primary hover:bg-muted/60 transition"
                                                >
                                                    {copiedId === m.id ? (
                                                        <Check className="h-3 w-3 text-primary" />
                                                    ) : (
                                                        <Copy className="h-3 w-3" />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleReply(m)}
                                                    title="Reply to assistant"
                                                    className="p-1 rounded-md text-muted-foreground/60 hover:text-primary hover:bg-muted/60 transition flex items-center gap-1"
                                                >
                                                    <Reply className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {isLoading && (
                                <div className="max-w-3xl mx-auto select-none">
                                    {/* Collapsible "AI is thinking" panel — arrow toggles the body */}
                                    <button
                                        type="button"
                                        onClick={() => setStreamCollapsed(c => !c)}
                                        className="w-full flex items-center gap-2 text-muted-foreground/80 hover:text-foreground transition group"
                                    >
                                        <ChevronDown
                                            className={`h-3.5 w-3.5 text-primary transition-transform duration-200 ${streamCollapsed ? '-rotate-90' : ''}`}
                                        />
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                                        <span className="font-semibold text-[12px] text-foreground group-hover:underline underline-offset-2">
                                            AI is thinking
                                        </span>
                                        <span className="text-[11px] font-mono text-muted-foreground/60">
                                            ({thinkingSeconds}s)
                                        </span>
                                        {accessedNetwork.nodes.length > 0 && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary ml-1">
                                                <Network className="h-3 w-3" />
                                                {accessedNetwork.nodes.length} neurons
                                            </span>
                                        )}
                                        {Object.keys(liveTiming).length > 0 && (
                                            <span className="ml-1 hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70 truncate max-w-[380px]" title="Live per-stage timing (backend vs Gemini)">
                                                {timingStrip(liveTiming)}
                                            </span>
                                        )}
                                    </button>

                                    {!streamCollapsed && (
                                        <div className="mt-2 space-y-3">
                                            {/* Neurons the AI is tapping into — stay live while streaming */}
                                            {accessedNetwork.nodes.length > 0 && (
                                                <NeuronFiringMap nodes={accessedNetwork.nodes} edges={accessedNetwork.edges} />
                                            )}

                                            {draftStream && (
                                                <div key="draft-stream" className="text-[13px] leading-relaxed whitespace-pre-wrap light-wipe">
                                                    {draftStream}
                                                    <span className="inline-block ml-0.5 h-3.5 w-[2px] translate-y-[2px] bg-primary animate-pulse" />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Quick Prompts (Only if fresh chat) */}
                        {messages.length <= 1 && (
                            <div className="absolute bottom-20 left-4 right-4 z-10 pointer-events-none flex justify-center">
                                <div className="pointer-events-auto w-full max-w-3xl grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-2 rounded-2xl bg-background/80 dark:bg-card/75 backdrop-blur-xl border border-border/40 shadow-md">
                                    {QUICK_PROMPTS.map((qp, idx) => {
                                        const IconComp = qp.icon;
                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => handleSendMessage(qp.prompt)}
                                                disabled={isLoading}
                                                className="text-left p-2 rounded-xl border border-border/40 bg-background/60 hover:bg-muted/80 hover:border-primary/40 transition flex items-center gap-2 active:scale-95"
                                            >
                                                <IconComp className="h-3 w-3 text-primary shrink-0" />
                                                <span className="text-[11px] font-semibold text-foreground truncate">
                                                    {qp.title}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Floating Bottom Chat Input Bar - Liquid Glass Capsule */}
                        <div className="absolute bottom-3 left-3 right-3 z-20 pointer-events-none flex justify-center">
                            <div className="pointer-events-auto w-full max-w-3xl flex flex-col gap-2">
                                {/* Replying banner preview if replying to a message */}
                                {replyingTo && (
                                    <div className="flex items-center justify-between gap-2 px-3.5 py-1.5 rounded-2xl bg-background/90 dark:bg-card/90 backdrop-blur-2xl border border-border/50 text-xs shadow-md animate-in fade-in-50 duration-150">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <Reply className="h-3.5 w-3.5 text-primary shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <span className="font-semibold text-foreground mr-1 text-[11px]">
                                                    Membalas {replyingTo.role === 'user' ? 'pesan Anda' : 'asisten'}:
                                                </span>
                                                <span className="text-muted-foreground text-[11px] truncate inline-block max-w-[200px] sm:max-w-[420px] align-bottom">
                                                    {replyingTo.content.replace(/```action_proposal[\s\S]*?```/g, '').trim()}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setReplyingTo(null)}
                                            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition shrink-0"
                                            title="Cancel reply"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}

                                {/* Uploaded file chips — shown above the composer */}
                                {(attachments.length > 0 || isUploading) && (
                                    <div className="flex flex-wrap items-center gap-1.5 px-4">
                                        {attachments.map((att) => {
                                            const Ic = att.kind === 'image' ? ImageIcon
                                                : att.kind === 'archive' ? FileArchive
                                                : att.kind === 'spreadsheet' ? FileSpreadsheet
                                                : FileText;
                                            return (
                                                <span
                                                    key={att.id}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/90 dark:bg-card/90 backdrop-blur-xl px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm"
                                                >
                                                    <Ic className="h-3 w-3 text-primary shrink-0" />
                                                    <span className="max-w-[140px] sm:max-w-[220px] truncate">{att.original_name}</span>
                                                    <span className="text-[9.5px] text-muted-foreground/70">{formatBytes(att.size_bytes)}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeAttachment(att.id)}
                                                        className="p-0.5 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                                                        title="Remove file"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </span>
                                            );
                                        })}
                                        {isUploading && (
                                            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                                                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                                Uploading…
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Referenced project files — @ mention chips */}
                                {projectFileRefs.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 px-4">
                                        {projectFileRefs.map(f => {
                                            const Ic = fileIconFor(f.kind);
                                            return (
                                                <span
                                                    key={f.id}
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 dark:bg-primary/15 backdrop-blur-xl px-2.5 py-1 text-[11px] font-medium text-primary shadow-sm"
                                                >
                                                    <Ic className="h-3 w-3 shrink-0" />
                                                    <span className="max-w-[140px] sm:max-w-[220px] truncate">@{f.name}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleProjectFileRef(f)}
                                                        className="p-0.5 rounded-full text-primary/70 hover:text-destructive hover:bg-destructive/10 transition"
                                                        title="Remove reference"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* @ mention picker — reference project files in the message */}
                                {mentionMenuOpen && currentProject && mentionFiles.length > 0 && (
                                    <div className="rounded-2xl border border-border/60 bg-background/95 dark:bg-card/95 backdrop-blur-2xl shadow-xl shadow-black/5 dark:shadow-black/25 p-1.5 space-y-1">
                                        <div className="flex items-center gap-1.5 px-2 py-1">
                                            <span className="text-primary font-bold text-xs">@</span>
                                            <input
                                                autoFocus
                                                value={mentionFilter}
                                                onChange={(e) => setMentionFilter(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Escape') setMentionMenuOpen(false);
                                                    if (e.key === 'Enter') e.preventDefault();
                                                }}
                                                placeholder="Filter project files…"
                                                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none border-none focus:ring-0 p-0"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setMentionMenuOpen(false)}
                                                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
                                                title="Close"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                        <div className="max-h-52 overflow-y-auto space-y-0.5">
                                            {filteredMentionFiles.map(f => {
                                                const selected = projectFileRefs.some(r => r.id === f.id);
                                                const Ic = fileIconFor(f.kind);
                                                return (
                                                    <button
                                                        key={f.id}
                                                        type="button"
                                                        onClick={() => toggleProjectFileRef(f)}
                                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition ${
                                                            selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/70'
                                                        }`}
                                                    >
                                                        <Ic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                        <span className="truncate flex-1 min-w-0 text-left">{f.name}</span>
                                                        <span className="text-[9.5px] text-muted-foreground/60 shrink-0">
                                                            {f.size_bytes ? formatBytes(f.size_bytes) : ''}
                                                        </span>
                                                        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                                                    </button>
                                                );
                                            })}
                                            {filteredMentionFiles.length === 0 && (
                                                <p className="text-[11px] text-muted-foreground text-center py-3">
                                                    No matching files in this project.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <form
                                    onSubmit={(e: FormEvent) => {
                                        e.preventDefault();
                                        handleSendMessage();
                                    }}
                                    className="flex items-center gap-1.5 p-1.5 pl-3 pr-1.5 rounded-full bg-background/85 dark:bg-card/80 backdrop-blur-2xl border border-border/60 shadow-xl shadow-black/5 dark:shadow-black/25 transition-all focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/15"
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        onChange={handlePickFiles}
                                        className="hidden"
                                        aria-label="Upload files"
                                    />

                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isLoading || isUploading || !aiConfig.is_configured}
                                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40 transition flex items-center justify-center shrink-0"
                                        title="Upload file (image, Excel, CSV, ZIP, ...)"
                                    >
                                        {isUploading ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Plus className="h-4 w-4" />
                                        )}
                                    </button>

                                    {/* @-mention project files */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (mentionMenuOpen) setMentionMenuOpen(false);
                                            else { setMentionFilter(''); setMentionMenuOpen(true); }
                                        }}
                                        disabled={isLoading || !aiConfig.is_configured || !currentProject || mentionFiles.length === 0}
                                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40 transition flex items-center justify-center shrink-0"
                                        title={currentProject && mentionFiles.length > 0
                                            ? `Reference a file from ${currentProject.title} (@)`
                                            : 'Upload files to a project first to reference them'}
                                    >
                                        <Paperclip className="h-4 w-4" />
                                    </button>

                                    <div className="flex-1 flex items-center min-w-0">
                                        <textarea
                                            ref={inputRef}
                                            rows={1}
                                            value={inputQuery}
                                            onChange={e => setInputQuery(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            placeholder={
                                                attachments.length > 0
                                                    ? 'Add a question about the file...'
                                                    : projectFileRefs.length > 0
                                                        ? 'Ask about the referenced files…'
                                                        : currentProject && mentionFiles.length > 0
                                                            ? "Ask anything, or type @ to reference a project file…"
                                                            : "Ask anything or propose actions... (Enter to send)"
                                            }
                                            disabled={isLoading || !aiConfig.is_configured}
                                            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground border-none outline-none focus:outline-none focus:ring-0 p-0 resize-none max-h-24 min-h-[24px] leading-5"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isLoading || isUploading || (!inputQuery.trim() && attachments.length === 0 && projectFileRefs.length === 0) || !aiConfig.is_configured}
                                        className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:opacity-90 active:scale-90 transition flex items-center justify-center disabled:opacity-30 shrink-0 shadow-xs"
                                        title="Send"
                                    >
                                        {isLoading ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Send className="h-3.5 w-3.5" />
                                        )}
                                    </button>
                                </form>
                            </div>
                        </div>

                    </div>

                </div>

                {/* Drag & drop file attach overlay */}
                {isDragOver && (
                    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-6">
                        <div className="flex flex-col items-center gap-2.5 rounded-3xl border-2 border-dashed border-primary/60 bg-primary/10 dark:bg-primary/15 backdrop-blur-xl px-8 sm:px-12 py-8 text-primary shadow-2xl">
                            <Upload className="h-7 w-7" />
                            <span className="text-sm font-semibold text-foreground">Drop files to attach</span>
                            <span className="text-[11px] text-muted-foreground">
                                Images, Excel, CSV, ZIP, PDF, DOCX — up to 20 MB each
                            </span>
                        </div>
                    </div>
                )}

            </div>

            {/* Session Preference Modal */}
            {isRulesModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in-50 duration-150">
                    <div className="w-full max-w-lg rounded-2xl bg-card border border-border/70 p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-border/40 pb-3">
                            <div className="flex items-center gap-2">
                                <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                    <Sliders className="h-4 w-4" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">
                                        Session Preference
                                    </h3>
                                    <p className="text-[11px] text-muted-foreground">
                                        Model choice & training directives for this chat session
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsRulesModalOpen(false)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
                                title="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-foreground flex items-center justify-between">
                                <span>AI Model</span>
                                <span className="text-[10.5px] text-muted-foreground">Saved per session</span>
                            </label>
                            <select
                                value={currentModel}
                                onChange={(e) => setCurrentModel(e.target.value)}
                                className="w-full rounded-xl border border-border bg-background dark:bg-muted/30 text-foreground px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                            >
                                {!AVAILABLE_MODELS.some(m => m.value === currentModel) && currentModel && (
                                    <option value={currentModel}>{currentModel}</option>
                                )}
                                {AVAILABLE_MODELS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                            <p className="text-[11px] text-muted-foreground">
                                Used for this chat session. Empty preference falls back to the model set in Settings.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-foreground flex items-center justify-between">
                                <span>Training Directives</span>
                                <span className="text-[10.5px] text-muted-foreground">Saved per session</span>
                            </label>
                            <textarea
                                rows={5}
                                value={currentRules}
                                onChange={(e) => setCurrentRules(e.target.value)}
                                placeholder="e.g.&#10;- Always respond concisely in English&#10;- When recommending stock, focus on 128GB second units&#10;- Default warranty is 30 days"
                                className="w-full rounded-xl border border-border bg-background dark:bg-muted/30 text-foreground focus:bg-background p-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground/60 resize-none leading-relaxed"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                The assistant strictly follows these instructions whenever answering inside this chat session.
                            </p>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/30">
                            <button
                                type="button"
                                onClick={() => setIsRulesModalOpen(false)}
                                className="px-3 py-1.5 rounded-xl border border-border text-xs font-medium text-foreground hover:bg-muted transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveCustomRules}
                                disabled={isSavingRules || !currentSessionId}
                                className="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold flex items-center gap-1.5 transition shadow-xs disabled:opacity-50"
                            >
                                {isSavingRules ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Check className="h-3.5 w-3.5" />
                                )}
                                <span>Save Preferences</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Project file viewer */}
            {viewerFile && (
                <FileViewerModal
                    key={`${viewerFile.projectId}-${viewerFile.file.id}`}
                    projectId={viewerFile.projectId}
                    file={viewerFile.file}
                    onClose={() => setViewerFile(null)}
                    onDelete={(f) => deleteProjectFileEntry(viewerFile.projectId, f)}
                />
            )}

            {/* Floating corner toast — confirms a new AI memory node was saved */}
            {cornerToast && (
                <div
                    key={cornerToast.key}
                    role="status"
                    className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full bg-card/90 dark:bg-black/80 backdrop-blur-2xl border border-border/60 shadow-xl shadow-black/10 dark:shadow-black/40 animate-in slide-in-from-bottom-4 fade-in duration-300"
                >
                    <span className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Check className="h-3.5 w-3.5" />
                    </span>
                    <span className="leading-tight min-w-0">
                        <span className="block text-xs font-semibold text-foreground">
                            {cornerToast.title}
                        </span>
                        {cornerToast.detail && (
                            <span className="block text-[11px] text-muted-foreground max-w-[240px] truncate">
                                {cornerToast.detail}
                            </span>
                        )}
                    </span>
                </div>
            )}
        </AuthenticatedLayout>
    );
}
