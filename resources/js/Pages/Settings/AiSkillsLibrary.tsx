import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, router, Link, usePage, useForm } from '@inertiajs/react';
import { FormEvent, useMemo } from 'react';
import {
    ChevronLeft,
    Layers,
    GitBranch,
    FileCode2,
    Plus,
    Trash2,
    Power,
    Check,
    ExternalLink,
    RefreshCw,
} from 'lucide-react';
import type { PageProps } from '@/types';

interface SkillFile {
    id: number;
    kind: 'rule' | 'knowledge';
    title: string;
    content: string;
    is_active: boolean;
    author_name: string | null;
    updated_at: string;
    source_label: string;
    source_url: string | null;
}

interface SkillRepo {
    label: string;
    url: string;
    total: number;
    active: number;
    files: SkillFile[];
}

interface AiSkillsLibraryProps {
    repos: SkillRepo[];
}

interface Flash {
    success?: string;
    error?: string;
}

export default function AiSkillsLibrary({ repos }: AiSkillsLibraryProps) {
    const { props } = usePage<PageProps<{ flash?: Flash }>>();
    const safeRepos = Array.isArray(repos) ? repos : [];

    const form = useForm({ repo: '' });

    const stats = useMemo(() => {
        const files = safeRepos.flatMap(r => r.files);
        return {
            repos: safeRepos.length,
            total: files.length,
            active: files.filter(f => f.is_active).length,
        };
    }, [safeRepos]);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!form.data.repo.trim()) return;

        form.post(route('settings.ai.skills.store'), {
            preserveScroll: true,
            onSuccess: () => form.reset(),
        });
    };

    const toggleFile = (file: SkillFile) => {
        router.post(route('settings.ai.training-notes.toggle', file.id), {}, {
            preserveScroll: true,
        });
    };

    const deleteFile = (file: SkillFile) => {
        if (confirm(`Delete skill file "${file.title}" permanently from AI memory?`)) {
            router.delete(route('settings.ai.training-notes.destroy', file.id), {
                preserveScroll: true,
            });
        }
    };

    const rescanRepo = (repo: SkillRepo) => {
        router.post(route('settings.ai.skills.store'), { repo: repo.label }, {
            preserveScroll: true,
        });
    };

    return (
        <AuthenticatedLayout>
            <Head title="AI Skills Library" />

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
                                    <Layers className="h-5 w-5 text-primary" />
                                    <span>AI Skills Library</span>
                                </h1>
                                <p className="text2 mt-0.5">
                                    Skill files learned from GitHub repositories — pause, rescan or delete each file anytime.
                                </p>
                            </div>
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
                                <GitBranch className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-xl font-bold text-foreground font-mono leading-none">{stats.repos}</div>
                                <div className="caption text-muted-foreground mt-1">Skill repos</div>
                            </div>
                        </div>
                        <div className="apple-card p-4 flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                <FileCode2 className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-xl font-bold text-foreground font-mono leading-none">{stats.total}</div>
                                <div className="caption text-muted-foreground mt-1">Skill files</div>
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
                    </div>

                    {/* Learn new repo */}
                    <div className="apple-card p-5 space-y-3">
                        <div className="flex items-center gap-2">
                            <Plus className="h-4 w-4 text-primary" />
                            <h3 className="text-sm font-semibold text-foreground">Learn a Skill Repo from GitHub</h3>
                            <p className="text2">Paste a public repository and its readable files join the AI skill library.</p>
                        </div>
                        <form onSubmit={submit} className="space-y-3">
                            <div className="flex flex-col sm:flex-row gap-2">
                                <input
                                    type="text"
                                    value={form.data.repo}
                                    onChange={e => form.setData('repo', e.target.value)}
                                    placeholder="e.g. https://github.com/pinchbench/skill or pinchbench/skill"
                                    spellCheck={false}
                                    autoComplete="off"
                                    className="flex-1 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                                />
                                <button
                                    type="submit"
                                    disabled={form.processing || !form.data.repo.trim()}
                                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] transition flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    {form.processing ? 'Learning…' : 'Learn Repo'}
                                </button>
                            </div>
                            <p className="caption text-muted-foreground">
                                Duplicate files are ignored automatically via content hash, so rescanning is always safe.
                            </p>
                        </form>
                    </div>

                    {/* Repos */}
                    {safeRepos.length === 0 ? (
                        <div className="apple-card p-12 text-center text-muted-foreground space-y-3">
                            <Layers className="h-8 w-8 mx-auto text-muted-foreground/50" />
                            <div className="space-y-1">
                                <p className="text1">No skill repos yet.</p>
                                <p className="text2">
                                    Paste a public GitHub repo above such as <span className="font-mono">pinchbench/skill</span>
                                    {' '}and its skill files will appear here for management.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {safeRepos.map(repo => (
                                <div key={repo.label} className="apple-card overflow-hidden">
                                    {/* Repo header */}
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-border/40 bg-muted/20">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                <GitBranch className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-foreground truncate flex items-center gap-1.5">
                                                    {repo.label}
                                                    <a
                                                        href={repo.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center text-muted-foreground hover:text-primary transition"
                                                        title="Open on GitHub"
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                    </a>
                                                </p>
                                                <p className="caption text-muted-foreground mt-0.5">
                                                    {repo.total} files · {repo.active} active
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => rescanRepo(repo)}
                                            className="rounded-xl border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-semibold text-foreground hover:border-primary/50 hover:text-primary transition flex items-center gap-1.5 shrink-0"
                                            title="Re-learn every file of this repo (duplicates are skipped)"
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                            Rescan
                                        </button>
                                    </div>

                                    {/* Files */}
                                    <div className="divide-y divide-border/60">
                                        {repo.files.map(file => (
                                            <div
                                                key={file.id}
                                                className={`p-4 flex flex-col sm:flex-row sm:items-center gap-3 transition ${file.is_active ? '' : 'bg-muted/30 opacity-70'}`}
                                            >
                                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                                    <span className="mt-0.5 inline-flex items-center shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold tracking-wide border bg-muted text-muted-foreground border-border">
                                                        FILE
                                                    </span>
                                                    <div className="min-w-0">
                                                        <p className="text2 text-foreground truncate">{file.title}</p>
                                                        <p className="caption text-muted-foreground mt-1 truncate">
                                                            {String(file.content).slice(0, 220)}
                                                        </p>
                                                        <p className="caption text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                                            <span>{file.author_name || 'System'}</span>
                                                            <span>•</span>
                                                            <span>{file.updated_at}</span>
                                                            {!file.is_active && (
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
                                                        onClick={() => toggleFile(file)}
                                                        className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold tracking-wider transition flex items-center gap-1 ${
                                                            file.is_active
                                                                ? 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                                                : 'bg-primary/10 text-primary hover:bg-primary/20'
                                                        }`}
                                                        title={file.is_active ? 'Pause this skill file' : 'Activate this skill file'}
                                                    >
                                                        <Power className="h-3 w-3" />
                                                        {file.is_active ? 'Pause' : 'Activate'}
                                                    </button>
                                                    <button
                                                        onClick={() => deleteFile(file)}
                                                        className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                                                        title="Delete this skill file permanently"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                </div>
            </div>
        </AuthenticatedLayout>
    );
}