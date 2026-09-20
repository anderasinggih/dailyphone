import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, router, Link, usePage, useForm } from '@inertiajs/react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronLeft,
    ChevronDown,
    BrainCircuit,
    Plus,
    Trash2,
    Power,
    BookOpen,
    CircleDot,
    Sparkles,
    Check,
    List,
    Network,
    Activity,
    CalendarDays,
    MapPin,
    Users,
    Send,
    Loader2,
    Radio
} from 'lucide-react';
import type { PageProps } from '@/types';
import NeuralMindMap from '@/Components/NeuralMindMap';
import { consumeNdjson, type StreamEdge, type StreamNeuron } from '@/lib/ndjson';
import { echo } from '@/lib/echo';
import { relationName } from '@/lib/relations';
import { kindOf, kindMeta, kindList, type Kind } from '@/lib/kinds';

interface SynapseRef {
    id: number;
    title: string | null;
    label: string | null;
    relation: string | null;
    weight: number | null;
    reason: string | null;
}

interface TrainingNote {
    id: number;
    kind: string;
    title: string | null;
    content: string;
    is_active: boolean;
    used_count?: number;
    last_used_at?: string | null;
    author_name: string | null;
    author_role: string | null;
    updated_at: string;
    occurred_at?: string | null;
    occurred_place?: string | null;
    involved_with?: string | null;
    links: SynapseRef[];
}

interface MindGraphNode {
    id: number;
    title: string;
    content: string;
    kind: string;
    is_active: boolean;
    author_name: string | null;
    degree: number;
    used_count?: number;
}

interface MindGraphLink {
    id: number;
    source: number;
    target: number;
    label: string | null;
}

interface AiTrainingNotesProps {
    notes: TrainingNote[];
    graph: {
        nodes: MindGraphNode[];
        links: MindGraphLink[];
    };
}

interface Flash {
    success?: string;
    error?: string;
}

const VIEW_KEY = 'dp-ai-training-view';

export default function AiTrainingNotes({ notes, graph }: AiTrainingNotesProps) {
    const { props } = usePage<PageProps<{ flash?: Flash }>>();
    const safeNotes = Array.isArray(notes) ? notes : [];
    const safeGraph = graph && Array.isArray(graph.nodes) ? graph : { nodes: [], links: [] };

    const [view, setView] = useState<'list' | 'map'>(() => {
        try {
            return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map';
        } catch {
            return 'map';
        }
    });

    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

    const toggleExpanded = (id: number) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const switchView = (next: 'list' | 'map') => {
        setView(next);
        try {
            localStorage.setItem(VIEW_KEY, next);
        } catch {
            // ignore
        }
    };

    const stats = useMemo(() => {
        const total = safeNotes.length;
        const active = safeNotes.filter(n => n.is_active).length;
        const rules = safeNotes.filter(n => n.kind === 'rule').length;
        const uses = safeNotes.reduce((sum, n) => sum + (n.used_count || 0), 0);
        const topNote = safeNotes.reduce<{ title: string; used: number } | null>((best, n) => {
            if (!n.used_count || n.used_count < 1) return best;
            if (!best || n.used_count > best.used) {
                return { title: n.title || n.content.slice(0, 42).replace(/\s+/g, ' ').trim(), used: n.used_count };
            }
            return best;
        }, null);
        return { total, active, rules, uses, topNote };
    }, [safeNotes]);

    const form = useForm({
        content: '',
        kind: 'note' as Kind,
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!form.data.content.trim()) return;

        form.post(route('settings.ai.training-notes.store'), {
            preserveScroll: true,
            onSuccess: () => {
                form.reset();
            },
        });
    };

    const toggleNote = (note: TrainingNote) => {
        router.post(route('settings.ai.training-notes.toggle', note.id), {}, {
            preserveScroll: true,
        });
    };

    const deleteNote = (note: TrainingNote) => {
        if (confirm(`Delete this ${kindMeta(note.kind).label} node permanently from AI memory?`)) {
            router.delete(route('settings.ai.training-notes.destroy', note.id), {
                preserveScroll: true,
            });
        }
    };

    // ── Live Watch: run a real query against assistant.chat and let the map
    // show exactly which neurons the retrieval lights, in stage order, plus
    // which nodes the model cites back at the end.
    const [liveQuery, setLiveQuery] = useState('');
    const [liveRunning, setLiveRunning] = useState(false);
    const [liveNodes, setLiveNodes] = useState<StreamNeuron[]>([]);
    const [liveEdges, setLiveEdges] = useState<StreamEdge[]>([]);
    const [liveUsedIds, setLiveUsedIds] = useState<number[]>([]);
    const [liveError, setLiveError] = useState<string | null>(null);
    const [liveNote, setLiveNote] = useState<string | null>(null);
    const [socketActive, setSocketActive] = useState(false);
    const [socketQuery, setSocketQuery] = useState<string | null>(null);
    const liveAutoClear = useRef<number | null>(null);
    const liveRunningRef = useRef(false);

    const clearLive = () => {
        setLiveNodes([]);
        setLiveEdges([]);
        setLiveUsedIds([]);
        setLiveError(null);
        setLiveNote(null);
        setSocketActive(false);
        setSocketQuery(null);
    };

    const scheduleLiveClear = () => {
        if (liveAutoClear.current) window.clearTimeout(liveAutoClear.current);
        liveAutoClear.current = window.setTimeout(() => {
            setLiveNodes([]);
            setLiveEdges([]);
            setLiveUsedIds([]);
            setLiveNote(null);
        }, 6000);
    };

    useEffect(() => {
        return () => {
            if (liveAutoClear.current) window.clearTimeout(liveAutoClear.current);
        };
    }, []);

    // Real-time cross-tab mirror: the superadmin starts a chat in the
    // Assistant (or anywhere else), and every stage the retrieval emits is
    // pushed to the `superadmin.live` private channel over Reverb. This page
    // subscribes so the map lights up even when the run started elsewhere.
    const socketClearTimer = useRef<number | null>(null);
    useEffect(() => {
        const resetSocketInactive = (afterMs = 8000) => {
            if (socketClearTimer.current) window.clearTimeout(socketClearTimer.current);
            socketClearTimer.current = window.setTimeout(() => {
                setSocketActive(false);
                setSocketQuery(null);
            }, afterMs);
        };

        const applyPulses = (nodes: StreamNeuron[]) => {
            setLiveNodes(prev => {
                const seen = new Set(prev.map(n => n.id));
                const fresh = nodes.filter(n => !seen.has(n.id));
                return fresh.length > 0 ? [...prev, ...fresh] : prev;
            });
        };

        const conn = echo();
        if (!conn) return;

        const channel = conn.private('superadmin.live');
        const onProgress = (data: any) => {
            // This tab is already watching its own run over NDJSON — the socket
            // would only echo the same events back at it.
            if (liveRunningRef.current) return;

            const payload = data && typeof data.payload === 'object' ? data.payload : data;
            if (!payload || typeof payload !== 'object') return;

            setSocketActive(true);
            if (typeof payload.query === 'string' && payload.query) {
                setSocketQuery(payload.query);
            }

            if (payload.kind === 'stage' && Array.isArray(payload.nodes)) {
                applyPulses(payload.nodes);
                resetSocketInactive();
            } else if (payload.kind === 'neurons' && Array.isArray(payload.nodes)) {
                setLiveNodes(payload.nodes);
                setLiveEdges(Array.isArray(payload.edges) ? payload.edges : []);
                resetSocketInactive();
            } else if (payload.kind === 'trace' && Array.isArray(payload.used)) {
                setLiveUsedIds(prev =>
                    Array.from(new Set([
                        ...prev,
                        ...payload.used.map(Number).filter((n: number) => Number.isFinite(n) && n > 0),
                    ]))
                );
                resetSocketInactive();
            } else if (payload.kind === 'done') {
                if (Array.isArray(payload.used)) {
                    setLiveUsedIds(payload.used.map(Number).filter((n: number) => Number.isFinite(n) && n > 0));
                }
                setSocketActive(false);
                setSocketQuery(null);
                scheduleLiveClear();
            } else if (payload.kind === 'error') {
                setLiveError(payload.message || 'The remote run failed.');
                setSocketActive(false);
                setSocketQuery(null);
                scheduleLiveClear();
            }
        };

        channel.listen('.ai.progress', onProgress);

        return () => {
            channel.stopListening('.ai.progress');
            conn.leaveChannel('private-superadmin.live');
            if (socketClearTimer.current) window.clearTimeout(socketClearTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const runLive = async () => {
        const q = liveQuery.trim();
        if (!q || liveRunning) return;
        if (liveAutoClear.current) window.clearTimeout(liveAutoClear.current);

        liveRunningRef.current = true;
        setLiveRunning(true);
        setLiveError(null);
        setLiveNote(null);
        setLiveNodes([]);
        setLiveEdges([]);
        setLiveUsedIds([]);

        const started = Date.now();
        try {
            const res = await fetch(route('assistant.chat'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                },
                body: JSON.stringify({ message: q }),
            });

            if (!res.ok) {
                let msg = `Server error (${res.status})`;
                try {
                    const parsed = await res.json();
                    if (parsed.message) msg = parsed.message;
                } catch {
                    // server returned a non-JSON error page
                }
                throw new Error(msg);
            }

            if ((res.headers.get('content-type') || '').includes('ndjson')) {
                const last = await consumeNdjson(res, {
                    onStage: (_stage, nodes) => {
                        setLiveNodes(prev => {
                            const seen = new Set(prev.map(n => n.id));
                            const fresh = nodes.filter(n => !seen.has(n.id));
                            return fresh.length > 0 ? [...prev, ...fresh] : prev;
                        });
                    },
                    onNeurons: (nodes, edges) => {
                        setLiveNodes(nodes);
                        setLiveEdges(edges);
                    },
                    onTrace: used => setLiveUsedIds(used),
                });
                if (!last || last.type === 'error') {
                    throw new Error(last?.reply || 'The AI did not reply on this run.');
                }
            } else {
                await res.json();
            }

            const elapsed = Math.max(1, Date.now() - started);
            setLiveNote(`Watch complete in ${(elapsed / 1000).toFixed(1)}s`);
            scheduleLiveClear();
        } catch (e: any) {
            setLiveError(e?.message || 'Live watch failed.');
        } finally {
            liveRunningRef.current = false;
            setLiveRunning(false);
        }
    };

    const runLiveStats = useMemo(() => {
        let rules = 0, semantic = 0, contextual = 0;
        liveNodes.forEach(n => {
            if (n.stage === 'rule') rules++;
            else if (n.stage === 'contextual') contextual++;
            else semantic++;
        });
        return { rules, semantic, contextual };
    }, [liveNodes]);

    return (
        <AuthenticatedLayout>
            <Head title="AI Training & Memory" />

            <div className="py-6 sm:py-8">
                <div className="mx-auto max-w-5xl px-4 sm:px-6 space-y-6">

                    {/* Navigation Bar Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/40 pb-4">
                        <div className="flex items-center gap-3">
                            <Link
                                href={route('settings.general')}
                                className="p-2 rounded-xl border border-border/80 bg-card hover:bg-muted text-foreground transition flex items-center justify-center shrink-0 shadow-2xs"
                                title="Back to Settings"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Link>
                            <div>
                                <h1 className="h2 flex items-center gap-2">
                                    <BrainCircuit className="h-5 w-5 text-primary" />
                                    <span>AI Training & Memory</span>
                                </h1>
                                <p className="text2 mt-0.5">
                                    The AI's living neuron network — every memory is a node that auto-connects to related ones. Rules are always prioritized over knowledge.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center gap-1 p-1 rounded-xl border border-border/50 bg-card/70 backdrop-blur-xl">
                                <button
                                    onClick={() => switchView('map')}
                                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition flex items-center gap-1.5 ${view === 'map' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <Network className="h-3.5 w-3.5" />
                                    Mind Map
                                </button>
                                <button
                                    onClick={() => switchView('list')}
                                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition flex items-center gap-1.5 ${view === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    <List className="h-3.5 w-3.5" />
                                    List
                                </button>
                            </div>
                            <span className="rounded-xl bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5" />
                                Superadmin
                            </span>
                        </div>
                    </div>

                    {props.flash?.success && (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-4 py-3 text-xs font-semibold flex items-center gap-2">
                            <Check className="h-4 w-4 shrink-0" />
                            {props.flash.success}
                        </div>
                    )}
                    {props.flash?.error && (
                        <div className="rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-xs font-semibold">
                            {props.flash.error}
                        </div>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="apple-card p-4 flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                <BookOpen className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-xl font-bold text-foreground font-mono leading-none">{stats.total}</div>
                                <div className="caption text-muted-foreground mt-1">Total notes</div>
                            </div>
                        </div>
                        <div className="apple-card p-4 flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                <Power className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-xl font-bold text-foreground font-mono leading-none">{stats.active}</div>
                                <div className="caption text-muted-foreground mt-1">Active in prompts</div>
                            </div>
                        </div>
                        <div className="apple-card p-4 flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center shrink-0">
                                <CircleDot className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-xl font-bold text-foreground font-mono leading-none">{stats.rules}</div>
                                <div className="caption text-muted-foreground mt-1">Rules (prioritized)</div>
                            </div>
                        </div>
                        <div className="apple-card p-4 flex items-center gap-3"
                            title={stats.topNote ? `Most consulted: ${stats.topNote.title} (${stats.topNote.used}×)` : 'No node consulted in chat replies yet'}>
                            <div className="h-9 w-9 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 flex items-center justify-center shrink-0">
                                <Activity className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-xl font-bold text-foreground font-mono leading-none">{stats.uses}</div>
                                <div className="caption text-muted-foreground mt-1 truncate">
                                    {stats.topNote ? `Most used: ${stats.topNote.title}` : 'Node consultations'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Add Manual Note */}
                    <div className="apple-card p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <Plus className="h-4 w-4 text-primary" />
                            <h3 className="text-sm font-semibold text-foreground">Add Training Note Manually</h3>
                            <p className="text2">No chat needed — write any brain node type directly into AI memory.</p>
                        </div>
                        <form onSubmit={submit} className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-2">
                                <select
                                    value={form.data.kind}
                                    onChange={e => form.setData('kind', e.target.value as Kind)}
                                    className="rounded-xl border bg-background px-3 py-2 text-xs font-semibold focus:outline-none focus:border-primary"
                                    style={{
                                        borderColor: `${kindMeta(form.data.kind).color}73`,
                                        color: kindMeta(form.data.kind).color,
                                    }}
                                >
                                    {kindList().map(k => (
                                        <option key={k} value={k} style={{ color: kindMeta(k).color }}>
                                            {kindMeta(k).label} — {k}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    value={form.data.content}
                                    onChange={e => form.setData('content', e.target.value)}
                                    placeholder="e.g. Discriminasi harga maksimal Rp 200.000; warna unit wajib diisi sebelum dijual…"
                                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                                />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <p className="caption text-muted-foreground">
                                    Duplicate content is automatically ignored via content hash.
                                </p>
                                <button
                                    type="submit"
                                    disabled={form.processing || !form.data.content.trim()}
                                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    {form.processing ? 'Saving…' : 'Save Note'}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* Mind Map View */}
                    {view === 'map' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="h3 text-foreground">Neuron Mind Map</h3>
                                    <p className="text2 mt-0.5">
                                        Click a node to open its memory below the map. Hit the refresh button to auto-arrange the network, or pause any node when you want the AI to ignore it.
                                    </p>
                                </div>
                                <span className="caption font-mono bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full">
                                    {safeGraph.links.length} synapses
                                </span>
                            </div>
                            <div className="apple-card p-4 space-y-3">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        <Radio className={`h-4 w-4 ${liveRunning ? 'text-primary animate-pulse' : 'text-primary'}`} />
                                        <h3 className="text-sm font-semibold text-foreground">Live Watch</h3>
                                        <p className="text2 text-muted-foreground">
                                            Fire a real query and watch which neurons the AI actually accesses — in retrieval order.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {(liveRunning || liveNote) && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-[10.5px] font-semibold">
                                                {liveRunning ? (
                                                    <>
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                        Streaming…
                                                    </>
                                                ) : (
                                                    <>
                                                        <Check className="h-3 w-3" />
                                                        {liveNote}
                                                    </>
                                                )}
                                            </span>
                                        )}
                                        {socketActive && !liveRunning && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-[10.5px] font-semibold">
                                                <Radio className="h-3 w-3 animate-pulse" />
                                                Live elsewhere
                                                {socketQuery ? `: ${socketQuery.length > 44 ? socketQuery.slice(0, 44) + '…' : socketQuery}` : ''}
                                            </span>
                                        )}
                                        {liveNodes.length > 0 && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 text-muted-foreground border border-border/50 px-2 py-0.5 text-[10px] font-mono">
                                                {liveNodes.length} neurons · {runLiveStats.rules} rules · {runLiveStats.semantic} semantic · {runLiveStats.contextual} situational
                                            </span>
                                        )}
                                        {liveError && (
                                            <span className="inline-flex items-center rounded-full bg-destructive/10 text-destructive border border-destructive/30 px-2.5 py-0.5 text-[10.5px] font-semibold">
                                                {liveError}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={liveQuery}
                                        onChange={e => setLiveQuery(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                runLive();
                                            }
                                        }}
                                        disabled={liveRunning}
                                        placeholder="Ask the assistant any question — watch its memory light up… e.g. cek penjualan hari ini"
                                        className="flex-1 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary disabled:opacity-60"
                                    />
                                    <button
                                        type="button"
                                        onClick={runLive}
                                        disabled={liveRunning || !liveQuery.trim()}
                                        className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] transition shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Send className="h-3.5 w-3.5" />
                                        {liveRunning ? 'Running…' : 'Watch'}
                                    </button>
                                    {(liveNodes.length > 0 || liveError) && (
                                        <button
                                            type="button"
                                            onClick={clearLive}
                                            title="Clear live watch"
                                            className="shrink-0 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                                    <span><span className="text-primary font-semibold">•</span> Rules always fire first</span>
                                    <span><span className="text-primary font-semibold">•</span> Semantic matches next</span>
                                    <span><span className="text-primary font-semibold">•</span> Situational / momentum anchors last</span>
                                    <span><span className="text-white font-semibold">•</span> White flash = nodes the AI cited in its reply</span>
                                </div>
                            </div>

                            <NeuralMindMap
                                nodes={safeGraph.nodes}
                                links={safeGraph.links}
                                liveNodes={liveNodes}
                                liveUsedIds={liveUsedIds}
                                onToggleActive={node =>
                                    router.post(
                                        route('settings.ai.training-notes.toggle', node.id),
                                        {},
                                        { preserveScroll: true },
                                    )
                                }
                                onReclassify={(node, kind) =>
                                    router.post(
                                        route('settings.ai.training-notes.kind', node.id),
                                        { kind },
                                        { preserveScroll: true },
                                    )
                                }
                                onTidy={() =>
                                    router.post(
                                        route('settings.ai.training-notes.tidy'),
                                        {},
                                        { preserveScroll: true },
                                    )
                                }
                            />
                            {safeNotes.length === 0 && (
                                <div className="rounded-xl border border-dashed border-border/80 px-4 py-3 text-xs text-muted-foreground text-center">
                                    The map grows by itself — every time the AI records something new in a chat, a node appears
                                    and links to related memories.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Notes List View */}
                    {view === 'list' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="h3 text-foreground">Training Notes</h3>
                                <span className="caption font-mono bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full">{stats.total}</span>
                            </div>

                            {safeNotes.length === 0 ? (
                                <div className="apple-card p-12 text-center text-muted-foreground space-y-3">
                                    <BrainCircuit className="h-8 w-8 mx-auto text-muted-foreground/50" />
                                    <div className="space-y-1">
                                        <p className="text1">No training notes yet.</p>
                                        <p className="text2">Notes are saved automatically when the AI encounters "remember this" instructions in chats, or add one manually above.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="apple-card overflow-hidden divide-y divide-border/60">
                                    {safeNotes.map(note => {
                                        const expanded = expandedIds.has(note.id);
                                        const noteTitle = note.title
                                            || note.content.slice(0, 96).replace(/\s+/g, ' ').trim();
                                        return (
                                            <div
                                                key={note.id}
                                                className={`transition ${note.is_active ? '' : 'bg-muted/30 opacity-70'}`}
                                            >
                                                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                                    <button
                                                        onClick={() => toggleExpanded(note.id)}
                                                        className="flex items-start gap-3 min-w-0 flex-1 text-left group"
                                                        title={expanded ? 'Collapse this note' : 'Expand this note'}
                                                    >
                                                        <span
                                                            className={`mt-0.5 inline-flex items-center gap-1 shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold tracking-wide border ${
                                                                note.kind === 'rule' ? 'font-semibold' : ''
                                                            }`}
                                                            style={{
                                                                backgroundColor: `${kindMeta(note.kind).color}1f`,
                                                                borderColor: `${kindMeta(note.kind).color}73`,
                                                                color: kindMeta(note.kind).color,
                                                            }}
                                                        >
                                                            <span
                                                                className="h-1.5 w-1.5 rounded-full"
                                                                style={{ backgroundColor: kindMeta(note.kind).color }}
                                                            />
                                                            {kindMeta(note.kind).label.toUpperCase()}
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm font-semibold text-foreground truncate">
                                                                {noteTitle}
                                                            </p>
                                                            <p className="text2 text-muted-foreground mt-0.5 truncate">
                                                                {note.content}
                                                            </p>
                                                            <p className="caption text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                                                <span>{note.author_name || 'System'}</span>
                                                                {note.author_role && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="capitalize">{note.author_role}</span>
                                                                    </>
                                                                )}
                                                                <span>•</span>
                                                                <span>{note.updated_at}</span>
                                                                {note.links.length > 0 && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="inline-flex items-center gap-1 text-primary font-semibold">
                                                                            <Network className="h-3 w-3 shrink-0" />
                                                                            {note.links.length} synapse{note.links.length === 1 ? '' : 's'}
                                                                        </span>
                                                                    </>
                                                                )}
                                                                {(note.used_count || 0) > 0 && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400 font-semibold">
                                                                            <Activity className="h-3 w-3 shrink-0" />
                                                                            {note.used_count}× used
                                                                        </span>
                                                                    </>
                                                                )}
                                                                {note.last_used_at && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span>last {note.last_used_at}</span>
                                                                    </>
                                                                )}
                                                                {note.occurred_at && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="inline-flex items-center gap-1 text-primary font-semibold" title={`Episode frame: ${note.occurred_at} — retrieval can recall this memory by when, not just text`}>
                                                                            <CalendarDays className="h-3 w-3 shrink-0" />
                                                                            {note.occurred_at}
                                                                        </span>
                                                                    </>
                                                                )}
                                                                {note.occurred_place && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="inline-flex items-center gap-1 text-primary font-semibold" title="Episode frame: where this memory happened">
                                                                            <MapPin className="h-3 w-3 shrink-0" />
                                                                            {note.occurred_place}
                                                                        </span>
                                                                    </>
                                                                )}
                                                                {note.involved_with && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="inline-flex items-center gap-1 text-primary font-semibold" title="Episode frame: with whom this memory happened">
                                                                            <Users className="h-3 w-3 shrink-0" />
                                                                            {note.involved_with}
                                                                        </span>
                                                                    </>
                                                                )}
                                                                {!note.is_active && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span className="text-destructive font-semibold">paused</span>
                                                                    </>
                                                                )}
                                                            </p>
                                                        </div>
                                                        <ChevronDown
                                                            className={`h-4 w-4 text-muted-foreground shrink-0 mt-1 transition-transform duration-200 group-hover:text-primary ${expanded ? 'rotate-180' : ''}`}
                                                        />
                                                    </button>

                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button
                                                            onClick={() => toggleNote(note)}
                                                            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold tracking-wider transition flex items-center gap-1 ${
                                                                note.is_active
                                                                    ? 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                                                    : 'bg-primary/10 text-primary hover:bg-primary/20'
                                                            }`}
                                                            title={note.is_active ? 'Pause this note' : 'Activate this note'}
                                                        >
                                                            <Power className="h-3 w-3" />
                                                            {note.is_active ? 'Pause' : 'Activate'}
                                                        </button>
                                                        <button
                                                            onClick={() => deleteNote(note)}
                                                            className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                                                            title="Delete this note permanently"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>

                                                {expanded && (
                                                    <div className="px-4 pb-4 -mt-1.5 space-y-3">
                                                        <p className="text-xs text-foreground/95 leading-relaxed whitespace-pre-wrap max-h-[34vh] overflow-y-auto rounded-xl bg-background/50 border border-border/40 px-3.5 py-3">
                                                            {note.content}
                                                        </p>

                                                        {note.links.length > 0 && (
                                                            <div className="border-t border-border/40 pt-3 space-y-2">
                                                                <p className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                                                                    Synapses ({note.links.length})
                                                                </p>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {note.links.map(link => (
                                                                        <span
                                                                            key={link.id}
                                                                            title={link.reason ?? relationName(link.relation, link.label)}
                                                                            className="px-2 py-1 rounded-lg border border-border/60 bg-background/70 text-[10.5px] font-medium text-foreground"
                                                                        >
                                                                            {link.title || `Memory #${link.id}`}
                                                                            <span className="ml-1.5 inline-flex items-center gap-1 text-[9px] font-semibold text-primary uppercase">
                                                                                {relationName(link.relation, link.label)}
                                                                                {link.weight !== null && link.weight !== undefined && (
                                                                                    <span className="font-mono text-muted-foreground">
                                                                                        {Math.round(link.weight * 100)}%
                                                                                    </span>
                                                                                )}
                                                                            </span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </AuthenticatedLayout>
    );
}