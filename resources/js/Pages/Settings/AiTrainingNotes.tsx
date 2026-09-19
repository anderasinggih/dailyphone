import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, router, Link, usePage, useForm } from '@inertiajs/react';
import { FormEvent, useMemo } from 'react';
import {
    ChevronLeft,
    BrainCircuit,
    Plus,
    Trash2,
    Power,
    BookOpen,
    CircleDot,
    Sparkles,
    Check
} from 'lucide-react';
import type { PageProps } from '@/types';

interface TrainingNote {
    id: number;
    kind: 'rule' | 'knowledge';
    content: string;
    is_active: boolean;
    author_name: string | null;
    author_role: string | null;
    updated_at: string;
}

interface AiTrainingNotesProps {
    notes: TrainingNote[];
}

interface Flash {
    success?: string;
    error?: string;
}

export default function AiTrainingNotes({ notes }: AiTrainingNotesProps) {
    const { props } = usePage<PageProps<{ flash?: Flash }>>();
    const safeNotes = Array.isArray(notes) ? notes : [];

    const stats = useMemo(() => {
        const total = safeNotes.length;
        const active = safeNotes.filter(n => n.is_active).length;
        const rules = safeNotes.filter(n => n.kind === 'rule').length;
        return { total, active, rules };
    }, [safeNotes]);

    const form = useForm({
        content: '',
        kind: 'rule' as 'rule' | 'knowledge',
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
        if (confirm(`Delete this ${note.kind === 'rule' ? 'rule' : 'knowledge note'} permanently from AI memory?`)) {
            router.delete(route('settings.ai.training-notes.destroy', note.id), {
                preserveScroll: true,
            });
        }
    };

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
                                    Persistent notes the AI reads in every chat. Rules are always prioritized over knowledge.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                    </div>

                    {/* Add Manual Note */}
                    <div className="apple-card p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <Plus className="h-4 w-4 text-primary" />
                            <h3 className="text-sm font-semibold text-foreground">Add Training Note Manually</h3>
                            <p className="text2">No chat needed — write a rule or knowledge note directly into AI memory.</p>
                        </div>
                        <form onSubmit={submit} className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-2">
                                <select
                                    value={form.data.kind}
                                    onChange={e => form.setData('kind', e.target.value as 'rule' | 'knowledge')}
                                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
                                >
                                    <option value="rule">Rule [RULE] — superadmin directive</option>
                                    <option value="knowledge">Knowledge — factual note</option>
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

                    {/* Notes List */}
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
                                {safeNotes.map(note => (
                                    <div
                                        key={note.id}
                                        className={`p-4 flex flex-col sm:flex-row sm:items-center gap-3 transition ${note.is_active ? '' : 'bg-muted/30 opacity-70'}`}
                                    >
                                        <div className="flex items-start gap-3 min-w-0 flex-1">
                                            <span className={`mt-0.5 inline-flex items-center shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold tracking-wide border ${
                                                note.kind === 'rule'
                                                    ? 'bg-primary/10 text-primary border-primary/20'
                                                    : 'bg-muted text-muted-foreground border-border'
                                            }`}>
                                                {note.kind === 'rule' ? '[RULE]' : '[NOTE]'}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text2 text-foreground break-words whitespace-pre-wrap">
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
                                                    {!note.is_active && (
                                                        <>
                                                            <span>•</span>
                                                            <span className="text-destructive font-semibold">paused</span>
                                                        </>
                                                    )}
                                                </p>
                                            </div>
                                        </div>

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
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </AuthenticatedLayout>
    );
}