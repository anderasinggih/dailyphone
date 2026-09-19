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
    FileSpreadsheet
} from 'lucide-react';
import GeminiStar from '@/Components/GeminiStar';
import Markdown from '@/Components/Markdown';
import AiActionProposalCard, { ActionProposalData } from '@/Components/AiActionProposalCard';
import NeuronFiringMap from '@/Components/NeuronFiringMap';

interface AccessedNeuron {
    id: number;
    title: string;
    kind: 'rule' | 'knowledge';
}

interface NeuronLink {
    source: number;
    target: number;
}

// Consume an application/x-ndjson streaming response from the Assistant chat
// endpoint. Progress events are forwarded to handlers as they arrive; the last
// 'done' / 'error' event is returned once the stream closes.
async function consumeNdjson(
    res: Response,
    handlers: {
        onNeurons?: (nodes: AccessedNeuron[], edges: NeuronLink[]) => void;
        onToken?: (text: string) => void;
    }
): Promise<any> {
    if (!res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let last: any = null;

    const digest = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let evt: any;
        try {
            evt = JSON.parse(trimmed);
        } catch {
            return;
        }
        if (!evt || typeof evt !== 'object') return;
        if (evt.type === 'neurons' && handlers.onNeurons) {
            handlers.onNeurons(
                Array.isArray(evt.nodes) ? evt.nodes : [],
                Array.isArray(evt.edges) ? evt.edges : []
            );
        }
        if (evt.type === 'chunk' && handlers.onToken && typeof evt.text === 'string') {
            handlers.onToken(evt.text);
        }
        if (evt.type === 'done' || evt.type === 'error') last = evt;
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            digest(line);
        }
    }
    if (buffer.trim()) {
        digest(buffer);
    }
    return last;
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
    title: string;
    custom_rules?: string | null;
    ai_model?: string | null;
    created_at: string;
    updated_at: string;
}

const AVAILABLE_MODELS = [
    { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Recommended)' },
    { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Fast)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
];

interface AssistantProps {
    aiConfig: {
        is_configured: boolean;
        is_enabled: boolean;
        model: string;
    };
    userRole: string;
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
    // Live token-by-token draft rendered while Gemini streams its answer.
    const [draftStream, setDraftStream] = useState<string>('');
    // Collapsible "AI is thinking" panel — arrow toggles, like opencode's thought.
    const [streamCollapsed, setStreamCollapsed] = useState(false);

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

    // Handle selecting a different session
    const selectSession = (sessionId: number) => {
        setIsSidebarOpen(false);
        router.get(route('assistant.index'), { session_id: sessionId }, {
            preserveState: false,
            preserveScroll: true,
        });
    };

    // Handle creating a new chat session
    const createNewChat = async () => {
        setIsSidebarOpen(false);
        try {
            const res = await fetch(route('assistant.session.create'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                }
            });
            const data = await res.json();
            if (data.success && data.session) {
                setSessionList(prev => [data.session, ...prev]);
                setCurrentSessionId(data.session.id);
                setMessages([welcomeMessage]);
            }
        } catch (e) {
            // fallback: reset state locally
            setCurrentSessionId(null);
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

            setSessionList(prev => prev.filter(s => s.id !== sessionId));

            if (currentSessionId === sessionId) {
                const remaining = sessionList.filter(s => s.id !== sessionId);
                if (remaining.length > 0) {
                    selectSession(remaining[0].id);
                } else {
                    setCurrentSessionId(null);
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
                setSessionList(prev =>
                    prev.map(s => (s.id === sessionId ? { ...s, title: trimmedTitle } : s))
                );
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
        if ((!rawQuery && uploaded.length === 0) || isLoading || isUploading) return;

        let query = rawQuery;

        if (replyingTo) {
            const cleanQuote = replyingTo.content.replace(/```action_proposal[\s\S]*?```/g, '').trim();
            const snippet = cleanQuote.length > 80 ? cleanQuote.slice(0, 80) + '...' : cleanQuote;
            query = `[Membalas pesan: "${snippet}"]\n${rawQuery}`;
        }

        const tempId = 'temp-' + Date.now();
        const userMsg: Message = {
            id: tempId,
            role: 'user',
            content: rawQuery || '📎 ' + uploaded.map(a => a.original_name).join(', '),
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
        setAccessedNetwork({ nodes: [], edges: [] });
        setDraftStream('');
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

            // Update session list with new session or updated title
            if (data.session_id) {
                setCurrentSessionId(data.session_id);
                setSessionList(prev => {
                    const exists = prev.find(s => s.id === data.session_id);
                    if (exists) {
                        return prev.map(s => s.id === data.session_id ? { ...s, title: data.session_title || s.title } : s);
                    } else {
                        return [{
                            id: data.session_id,
                            title: data.session_title || query.substring(0, 80),
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }, ...prev];
                    }
                });
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
                    attachments: uploaded.map(a => a.id),
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
        }
    };

    const csrfToken = (): string =>
        (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';

    const handlePickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (files.length === 0) return;

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

    const removeAttachment = (id: number) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    };

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const copyMessage = async (id: string, text: string) => {
        // Strip markdown formatting for clean plain text copy without ** or #
        const cleanText = text
            .replace(/\*\*(.*?)\*\*/g, '$1')       // bold **text** -> text
            .replace(/\*(.*?)\*/g, '$1')           // italic *text* -> text
            .replace(/^#{1,6}\s+/gm, '')           // headers # Header -> Header
            .replace(/`{1,3}(.*?)`{1,3}/gs, '$1')  // code `code` -> code
            .trim();

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

    return (
        <AuthenticatedLayout hideMobileNav={true}>
            <Head title="Assistant - Daily Phone Intelligence" />

            {/* Container: Fullscreen on mobile/tablet, wide & spacious on desktop (w-full max-w-7xl) */}
            <div className="p-0 sm:p-0 md:py-4 md:px-4 lg:px-6 w-full max-w-7xl mx-auto h-[100dvh] sm:h-[100dvh] md:h-[calc(100vh-80px)] flex flex-col">

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
                        {/* New Chat Button */}
                        <div className="p-3 border-b border-border/40 flex items-center justify-between gap-2">
                            <button
                                onClick={createNewChat}
                                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95 active:scale-[0.98] transition shadow-2xs"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                <span>New Chat</span>
                            </button>
                            <button
                                onClick={() => setIsSidebarOpen(false)}
                                className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:bg-muted/70"
                            >
                                <PanelLeftClose className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Sessions List */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {sessionList.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground text-center py-6 px-3">
                                    No past chat sessions yet. Send a message to start!
                                </p>
                            ) : (
                                sessionList.map((s) => {
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
                                                        title="Ubah nama obrolan"
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
                                })
                            )}
                        </div>

                        {/* Footer in Sidebar */}
                        <div className="p-2.5 border-t border-border/40 space-y-1.5">
                            <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                                <span className="truncate">{sessionList.length} Sessions saved</span>
                            </div>
                            {userRole === 'superadmin' && (
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
                            className="absolute inset-0 bg-black/40 z-25 md:hidden backdrop-blur-xs"
                        />
                    )}

                    {/* Right Area: Active Chat */}
                    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background md:bg-card relative">

                        {/* Floating Top Header - Liquid Glass Capsule (like mobile ChatGPT app) */}
                        <div className="absolute top-3 left-3 right-3 z-15 pointer-events-none flex justify-center">
                            <div className="pointer-events-auto w-full max-w-3xl flex items-center justify-between px-3.5 py-2 rounded-2xl bg-background/80 dark:bg-card/75 backdrop-blur-2xl border border-border/50 shadow-lg shadow-black/5 dark:shadow-black/20">
                                <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
                                    <Link
                                        href={route('dashboard')}
                                        title="Back to Dashboard"
                                        className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/70 active:scale-95 transition shrink-0"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Link>
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
                                        onClick={createNewChat}
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

                                    <div className="flex-1 flex items-center min-w-0">
                                        <textarea
                                            ref={inputRef}
                                            rows={1}
                                            value={inputQuery}
                                            onChange={e => setInputQuery(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            placeholder={attachments.length > 0 ? 'Add a question about the file...' : "Ask anything or propose actions... (Enter to send)"}
                                            disabled={isLoading || !aiConfig.is_configured}
                                            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground border-none outline-none focus:outline-none focus:ring-0 p-0 resize-none max-h-24 min-h-[24px] leading-5"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={isLoading || isUploading || (!inputQuery.trim() && attachments.length === 0) || !aiConfig.is_configured}
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
        </AuthenticatedLayout>
    );
}
