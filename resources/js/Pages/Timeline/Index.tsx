import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link, usePage, router } from '@inertiajs/react';
import { useState, useEffect } from 'react';
import {
    ShoppingBag,
    PackagePlus,
    Clock,
    RotateCcw,
    ShieldAlert,
    Ban,
    Trash2,
    ArrowLeftRight,
    RefreshCw,
    Bookmark,
    BookmarkCheck,
    Search,
    Filter,
    Activity,
    Sparkles,
    Terminal,
    Wallet
} from 'lucide-react';

interface ActivityLog {
    id: number;
    user_id: number | null;
    action: string;
    model_type: string | null;
    model_id: number | null;
    new_values: any;
    old_values: any;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    is_saved?: boolean;
    user?: {
        id: number;
        name: string;
        email: string;
        role: string;
        store?: {
            id: number;
            name: string;
        } | null;
    };
}

interface PaginatedData<T> {
    data: T[];
    current_page: number;
    last_page: number;
    prev_page_url: string | null;
    next_page_url: string | null;
    links: Array<{ url: string | null; label: string; active: boolean }>;
}

interface TimelineProps {
    activities: PaginatedData<ActivityLog>;
}

export default function Timeline({ activities }: TimelineProps) {
    const { filters } = usePage().props as any;
    const [search, setSearch] = useState(filters?.search || '');
    const [actionType, setActionType] = useState(filters?.action_type || '');
    const [date, setDate] = useState(filters?.date || '');
    const [savedOnly, setSavedOnly] = useState(!!filters?.saved_only);
    const [showFilters, setShowFilters] = useState(!!(filters?.action_type || filters?.date));
    const [savingId, setSavingId] = useState<number | null>(null);

    const [localActivities, setLocalActivities] = useState<ActivityLog[]>(activities.data);

    useEffect(() => {
        setLocalActivities(activities.data);
    }, [activities.data]);

    const applyFilters = (newSearch = search, newAction = actionType, newDate = date, newSavedOnly = savedOnly) => {
        router.get(route('timeline.index'), {
            search: newSearch,
            action_type: newAction,
            date: newDate,
            saved_only: newSavedOnly ? 1 : undefined,
        }, {
            preserveState: true,
            replace: true
        });
    };

    const toggleSave = (logId: number) => {
        setSavingId(logId);
        // Optimistic update
        setLocalActivities(prev =>
            prev.map(item =>
                item.id === logId ? { ...item, is_saved: !item.is_saved } : item
            )
        );

        router.post(route('timeline.toggle-save', logId), {}, {
            preserveScroll: true,
            onFinish: () => setSavingId(null),
            onError: () => {
                // Revert on error
                setLocalActivities(activities.data);
            }
        });
    };

    const formatCurrency = (val: any) => {
        const num = parseFloat(val) || 0;
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(num);
    };

    const getRelativeTime = (dateStr: string) => {
        const dateObj = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - dateObj.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago (${timeStr})`;
        if (diffDays === 1) return `Yesterday, ${timeStr}`;
        return dateObj.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getActionDetails = (log: ActivityLog) => {
        const vals = log.new_values || {};
        switch (log.action) {
            case 'add_stock':
                return {
                    title: 'Stock Added',
                    icon: PackagePlus,
                    accentColor: 'text-primary bg-primary/10 border-primary/20',
                    labelColor: 'text-primary',
                    desc: (
                        <span>
                            Added new unit <strong className="text-foreground font-semibold">{vals.name || 'Unit'}</strong> ({vals.type || '-'}) with selling price of {formatCurrency(vals.sell_price)}.
                        </span>
                    )
                };
            case 'sale_checkout':
                return {
                    title: 'Sale Completed',
                    icon: ShoppingBag,
                    accentColor: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-500/15',
                    labelColor: 'text-emerald-600 dark:text-emerald-400',
                    desc: (
                        <span>
                            Completed sales transaction <strong className="text-foreground font-semibold">{vals.invoice_number}</strong> totaling <strong className="text-primary font-bold">{formatCurrency(vals.total_amount)}</strong> to buyer <strong className="text-foreground font-semibold">{vals.buyer_name || '-'}</strong>. {vals.items_detail && `(${vals.items_detail})`}
                        </span>
                    )
                };
            case 'stock_transfer_initiated':
                return {
                    title: 'Stock Transfer',
                    icon: ArrowLeftRight,
                    accentColor: 'text-sky-600 bg-sky-500/10 border-sky-500/20 dark:text-sky-400 dark:bg-sky-500/15',
                    labelColor: 'text-sky-600 dark:text-sky-400',
                    desc: (
                        <span>
                            Transferred unit <strong className="text-foreground font-semibold">{vals.stock_name || 'Unit'}</strong> {vals.serial_number && `(SN: ${vals.serial_number})`} to destination branch.
                        </span>
                    )
                };
            case 'shift_clock_in':
                return {
                    title: 'Clock In',
                    icon: Clock,
                    accentColor: 'text-indigo-600 bg-indigo-500/10 border-indigo-500/20 dark:text-indigo-400 dark:bg-indigo-500/15',
                    labelColor: 'text-indigo-600 dark:text-indigo-400',
                    desc: (
                        <span>
                            Started work shift at store <strong className="text-foreground font-semibold">{vals.store_name || '-'}</strong>.
                        </span>
                    )
                };
            case 'shift_clock_out':
                return {
                    title: 'Clock Out',
                    icon: Clock,
                    accentColor: 'text-muted-foreground bg-muted border-border',
                    labelColor: 'text-muted-foreground',
                    desc: (
                        <span>
                            Ended work shift.
                        </span>
                    )
                };
            case 'sale_void':
                return {
                    title: 'Void Sale',
                    icon: Ban,
                    accentColor: 'text-destructive bg-destructive/10 border-destructive/20',
                    labelColor: 'text-destructive',
                    desc: (
                        <span>
                            Voided sales transaction invoice <strong className="text-foreground font-semibold">{vals.invoice_number}</strong>. Reason: "{vals.void_reason || '-'}".
                        </span>
                    )
                };
            case 'sale_deleted_via_stock_restore':
                return {
                    title: 'Sale Deleted',
                    icon: Trash2,
                    accentColor: 'text-destructive bg-destructive/10 border-destructive/20',
                    labelColor: 'text-destructive',
                    desc: (
                        <span>
                            Sales invoice <strong className="text-foreground font-semibold">{vals.invoice_number}</strong> was automatically deleted because the item was restored to Ready Stock / Transit.
                        </span>
                    )
                };
            case 'sale_return':
                return {
                    title: 'Item Return',
                    icon: RotateCcw,
                    accentColor: 'text-purple-600 bg-purple-500/10 border-purple-500/20 dark:text-purple-400 dark:bg-purple-500/15',
                    labelColor: 'text-purple-600 dark:text-purple-400',
                    desc: (
                        <span>
                            Recorded return for unit <strong className="text-foreground font-semibold">{vals.stock_name || 'Unit'}</strong> from invoice <strong className="text-foreground font-semibold">{vals.invoice_number}</strong>. Refund amount: {formatCurrency(vals.refund_amount)} (Restocking fee: {formatCurrency(vals.restocking_fee)}).
                        </span>
                    )
                };
            case 'warranty_claim':
                return {
                    title: 'Warranty Claim',
                    icon: ShieldAlert,
                    accentColor: 'text-amber-600 bg-amber-500/10 border-amber-500/20 dark:text-amber-400 dark:bg-amber-500/15',
                    labelColor: 'text-amber-600 dark:text-amber-400',
                    desc: (
                        <span>
                            Submitted warranty claim for unit <strong className="text-foreground font-semibold">{vals.stock_name || 'Unit'}</strong>. Damage description: "{vals.damage_description}".
                        </span>
                    )
                };
            case 'warranty_update':
                return {
                    title: 'Warranty Updated',
                    icon: ShieldAlert,
                    accentColor: 'text-primary bg-primary/10 border-primary/20',
                    labelColor: 'text-primary',
                    desc: (
                        <span>
                            Warranty claim for <strong className="text-foreground font-semibold">{vals.stock_name || 'Unit'}</strong> updated to status <strong className="font-bold text-primary">{vals.status}</strong> {vals.repair_cost > 0 && `with repair cost ${formatCurrency(vals.repair_cost)}`}.
                        </span>
                    )
                };
            case 'stock_updated':
                return {
                    title: 'Stock Updated',
                    icon: RefreshCw,
                    accentColor: 'text-primary bg-primary/10 border-primary/20',
                    labelColor: 'text-primary',
                    desc: (
                        <span>
                            Updated unit details for <strong className="text-foreground font-semibold">{vals.name || log.old_values?.name || 'Unit'}</strong> {vals.serial_number ? `(SN: ${vals.serial_number})` : (log.old_values?.serial_number ? `(SN: ${log.old_values.serial_number})` : '')}.
                        </span>
                    )
                };
            case 'stock_deleted':
                return {
                    title: 'Stock Deleted',
                    icon: Trash2,
                    accentColor: 'text-destructive bg-destructive/10 border-destructive/20',
                    labelColor: 'text-destructive',
                    desc: (
                        <span>
                            Deleted unit <strong className="text-foreground font-semibold">{log.old_values?.name || 'Unit'}</strong> {log.old_values?.serial_number && `(SN: ${log.old_values.serial_number})`}.
                        </span>
                    )
                };
            case 'stock_restored':
                return {
                    title: 'Stock Restored',
                    icon: RefreshCw,
                    accentColor: 'text-primary bg-primary/10 border-primary/20',
                    labelColor: 'text-primary',
                    desc: (
                        <span>
                            Restored unit <strong className="text-foreground font-semibold">{vals.name || 'Unit'}</strong> {vals.serial_number && `(SN: ${vals.serial_number})`} from Trash.
                        </span>
                    )
                };
            case 'ai_sell_stock':
                return {
                    title: 'AI: Sale Completed',
                    icon: ShoppingBag,
                    accentColor: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-500/15',
                    labelColor: 'text-emerald-600 dark:text-emerald-400',
                    isAi: true,
                    desc: (
                        <span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold text-[10px] mr-1 border border-primary/20">
                                <Sparkles className="h-2.5 w-2.5" /> AI Executed
                            </span>
                            Recorded sale <strong className="text-foreground font-semibold">{vals.invoice || 'INV'}</strong> for unit <strong className="text-foreground font-semibold">{log.old_values?.name || 'Unit'}</strong> to <strong className="text-foreground font-semibold">{vals.buyer || '-'}</strong> at <strong className="text-primary font-bold">{formatCurrency(vals.price)}</strong>.
                        </span>
                    )
                };
            case 'ai_update_stock':
                return {
                    title: 'AI: Stock Updated',
                    icon: RefreshCw,
                    accentColor: 'text-blue-600 bg-blue-500/10 border-blue-500/20 dark:text-blue-400 dark:bg-blue-500/15',
                    labelColor: 'text-blue-600 dark:text-blue-400',
                    isAi: true,
                    desc: (
                        <span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold text-[10px] mr-1 border border-primary/20">
                                <Sparkles className="h-2.5 w-2.5" /> AI Executed
                            </span>
                            Updated stock unit <strong className="text-foreground font-semibold">{vals.name || log.old_values?.name || 'Unit'}</strong> {vals.serial_number && `(SN: ${vals.serial_number})`}.
                        </span>
                    )
                };
            case 'ai_add_stock':
                return {
                    title: 'AI: Stock Added',
                    icon: PackagePlus,
                    accentColor: 'text-primary bg-primary/10 border-primary/20',
                    labelColor: 'text-primary',
                    isAi: true,
                    desc: (
                        <span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold text-[10px] mr-1 border border-primary/20">
                                <Sparkles className="h-2.5 w-2.5" /> AI Executed
                            </span>
                            Added new stock unit <strong className="text-foreground font-semibold">{vals.name || 'Unit'}</strong> {vals.serial_number && `(SN: ${vals.serial_number})`} with sell price <strong className="text-primary font-bold">{formatCurrency(vals.sell_price)}</strong>.
                        </span>
                    )
                };
            case 'ai_delete_stock':
                return {
                    title: 'AI: Stock Deleted',
                    icon: Trash2,
                    accentColor: 'text-destructive bg-destructive/10 border-destructive/20',
                    labelColor: 'text-destructive',
                    isAi: true,
                    desc: (
                        <span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold text-[10px] mr-1 border border-primary/20">
                                <Sparkles className="h-2.5 w-2.5" /> AI Executed
                            </span>
                            Deleted unit <strong className="text-foreground font-semibold">{log.old_values?.name || 'Unit'}</strong> {log.old_values?.serial_number && `(SN: ${log.old_values.serial_number})`}.
                        </span>
                    )
                };
            case 'ai_create_money_note':
                return {
                    title: 'AI: Money Note',
                    icon: Wallet,
                    accentColor: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-500/15',
                    labelColor: 'text-emerald-600 dark:text-emerald-400',
                    isAi: true,
                    desc: (
                        <span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold text-[10px] mr-1 border border-primary/20">
                                <Sparkles className="h-2.5 w-2.5" /> AI Executed
                            </span>
                            Recorded {vals.type === 'income' ? 'income' : 'expense'} <strong className="text-foreground font-semibold">{formatCurrency(vals.amount)}</strong> under category <strong className="text-foreground font-semibold">{vals.category || 'Operasional'}</strong> ({vals.description || '-'}).
                        </span>
                    )
                };
            case 'ai_run_python':
                return {
                    title: 'AI: Python Executed',
                    icon: Terminal,
                    accentColor: 'text-purple-600 bg-purple-500/10 border-purple-500/20 dark:text-purple-400 dark:bg-purple-500/15',
                    labelColor: 'text-purple-600 dark:text-purple-400',
                    isAi: true,
                    desc: (
                        <span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold text-[10px] mr-1 border border-primary/20">
                                <Sparkles className="h-2.5 w-2.5" /> AI Executed
                            </span>
                            Executed Python script with exit code <strong className="font-mono text-foreground">{vals.exit_code}</strong>. Snippet: <code className="bg-muted px-1 py-0.5 rounded font-mono text-[10px]">{vals.code_snippet}</code>.
                        </span>
                    )
                };
            default:
                return {
                    title: log.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    icon: Activity,
                    accentColor: 'text-muted-foreground bg-muted border-border',
                    labelColor: 'text-muted-foreground',
                    desc: <span>Performed activity {log.action} on the system.</span>
                };
        }
    };

    return (
        <AuthenticatedLayout>
            <Head title="Activities" />

            <div className="py-2 sm:py-6">
                <div className="mx-auto max-w-2xl px-0 sm:px-6 lg:px-8 space-y-4 sm:space-y-5">

                    {/* View Switcher: All Activities vs Saved Activities */}
                    <div className="flex items-center justify-between mx-3 sm:mx-0">
                        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/60">
                            <button
                                onClick={() => {
                                    setSavedOnly(false);
                                    applyFilters(search, actionType, date, false);
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                                    !savedOnly
                                        ? 'bg-card text-foreground shadow-xs'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                All Activities
                            </button>
                            <button
                                onClick={() => {
                                    setSavedOnly(true);
                                    applyFilters(search, actionType, date, true);
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                                    savedOnly
                                        ? 'bg-primary text-primary-foreground shadow-xs'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <Bookmark className="h-3.5 w-3.5" />
                                Saved
                            </button>
                        </div>

                        <span className="text-xs font-medium text-muted-foreground">
                            {activities.data.length} logs
                        </span>
                    </div>

                    {/* Filter & Search Bar */}
                    <div className="mx-3 sm:mx-0 rounded-2xl border border-border/80 bg-card p-4 text-card-foreground shadow-xs">
                        <div className="flex flex-col sm:flex-row gap-2.5 items-center">
                            <div className="relative flex-1 w-full">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search activity, user, IP..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    onKeyDown={e => {
                                         if (e.key === 'Enter') applyFilters(search, actionType, date, savedOnly);
                                    }}
                                    className="w-full rounded-xl border border-border/70 bg-background py-2 pl-9 pr-3 text-xs sm:text-sm text-foreground focus:outline-none focus:border-primary"
                                />
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <button
                                    onClick={() => setShowFilters(!showFilters)}
                                    className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition ${
                                        showFilters || actionType || date
                                            ? 'bg-primary/10 text-primary border-primary/20'
                                            : 'bg-background hover:bg-muted border-border/80 text-foreground'
                                    }`}
                                >
                                    <Filter className="h-3.5 w-3.5" />
                                    Filter
                                </button>
                                <button
                                    onClick={() => applyFilters(search, actionType, date, savedOnly)}
                                    className="flex-1 sm:flex-initial rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
                                >
                                    Search
                                </button>
                            </div>
                        </div>

                        {showFilters && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 mt-3 border-t border-border/50 animate-in fade-in duration-200">
                                <div>
                                    <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Activity</label>
                                    <select
                                        value={actionType}
                                        onChange={e => {
                                            setActionType(e.target.value);
                                            applyFilters(search, e.target.value, date, savedOnly);
                                        }}
                                        className="w-full rounded-xl border border-border/70 bg-background py-1.5 px-2.5 text-xs text-foreground focus:outline-none focus:border-primary"
                                    >
                                        <option value="">All Activities</option>
                                        <option value="ai_sell_stock">🤖 AI: Sale Completed</option>
                                        <option value="ai_add_stock">🤖 AI: Stock Added</option>
                                        <option value="ai_update_stock">🤖 AI: Stock Updated</option>
                                        <option value="ai_delete_stock">🤖 AI: Stock Deleted</option>
                                        <option value="ai_create_money_note">🤖 AI: Money Note</option>
                                        <option value="ai_run_python">🤖 AI: Python Script</option>
                                        <option value="add_stock">Stock Added</option>
                                        <option value="sale_checkout">Sale Completed</option>
                                        <option value="stock_transfer_initiated">Stock Transfer</option>
                                        <option value="shift_clock_in">Clock In</option>
                                        <option value="shift_clock_out">Clock Out</option>
                                        <option value="sale_void">Void Sale</option>
                                        <option value="sale_deleted_via_stock_restore">Sale Deleted</option>
                                        <option value="sale_return">Item Return</option>
                                        <option value="warranty_claim">Warranty Claim</option>
                                        <option value="warranty_update">Warranty Updated</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Date</label>
                                    <input
                                        type="date"
                                        value={date}
                                        onChange={e => {
                                            setDate(e.target.value);
                                            applyFilters(search, actionType, e.target.value, savedOnly);
                                        }}
                                        className="w-full rounded-xl border border-border/70 bg-background py-1.5 px-2.5 text-xs text-foreground focus:outline-none focus:border-primary"
                                    />
                                </div>

                                {(search || actionType || date) && (
                                    <div className="sm:col-span-2 flex justify-end pt-1">
                                        <button
                                            onClick={() => {
                                                setSearch('');
                                                setActionType('');
                                                setDate('');
                                                router.get(route('timeline.index'), { saved_only: savedOnly ? 1 : undefined }, { replace: true });
                                            }}
                                            className="text-xs font-semibold text-destructive hover:underline"
                                        >
                                            Reset Filter
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Timeline Activity Stream */}
                    <div className="divide-y divide-border/60 sm:space-y-4 sm:divide-y-0">
                        {localActivities.length === 0 ? (
                            <div className="p-12 text-center text-muted-foreground bg-card sm:rounded-2xl sm:border sm:border-border/60 mx-3 sm:mx-0">
                                <p className="font-semibold text-sm">
                                    {savedOnly ? 'No saved activities yet. Bookmark any activity to review it here.' : 'No recorded activities found.'}
                                </p>
                            </div>
                        ) : (
                            localActivities.map((log) => {
                                const details = getActionDetails(log);
                                const IconComponent = details.icon;
                                const userName = log.user?.name || 'System';
                                const userEmail = log.user?.email || 'system@dailyphone.com';
                                const initials = userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

                                return (
                                    <article
                                        key={log.id}
                                        className="bg-card w-full py-4 px-4 sm:p-5 sm:rounded-2xl sm:border sm:border-border/60 transition-colors relative"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {/* Category-colored Icon */}
                                                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${details.accentColor}`}>
                                                    <IconComponent className="h-4.5 w-4.5" />
                                                </div>

                                                <div className="min-w-0">
                                                    <p className="text-xs sm:text-sm font-bold text-foreground truncate leading-tight">{userName}</p>
                                                    <p className="text-[11px] text-muted-foreground truncate leading-none mt-0.5">{userEmail}</p>
                                                </div>
                                            </div>

                                            {/* Action Type & Relative Time & Bookmark Button */}
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-[11px] text-muted-foreground font-medium">{getRelativeTime(log.created_at)}</span>

                                                {/* Instagram style bookmark save button */}
                                                <button
                                                    onClick={() => toggleSave(log.id)}
                                                    disabled={savingId === log.id}
                                                    title={log.is_saved ? 'Remove bookmark' : 'Save activity'}
                                                    className={`p-1.5 rounded-lg border transition ${
                                                        log.is_saved
                                                            ? 'bg-primary/10 border-primary/30 text-primary'
                                                            : 'bg-background hover:bg-muted border-border/70 text-muted-foreground hover:text-foreground'
                                                    }`}
                                                >
                                                    {log.is_saved ? (
                                                        <BookmarkCheck className="h-3.5 w-3.5 fill-current" />
                                                    ) : (
                                                        <Bookmark className="h-3.5 w-3.5" />
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-3 text-xs sm:text-sm leading-relaxed text-foreground/90">
                                            {details.desc}
                                        </div>

                                        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                                            <span className={`font-semibold ${details.labelColor}`}>
                                                {details.title}
                                            </span>
                                            <span className="truncate ml-2 text-[10px]">
                                                {log.user?.role === 'superadmin' ? 'Superadmin' : (log.user?.store?.name || 'Main')}
                                            </span>
                                        </div>
                                    </article>
                                );
                            })
                        )}
                    </div>

                    {/* Pagination */}
                    {activities.last_page > 1 && (
                        <div className="flex flex-wrap items-center justify-center gap-1.5 px-3 py-4 max-w-full overflow-x-auto">
                            {activities.links.map((link, idx) => {
                                const labelClean = link.label
                                    .replace(/&laquo;/g, '«')
                                    .replace(/&raquo;/g, '»');

                                if (!link.url) {
                                    return (
                                        <span
                                            key={idx}
                                            className="px-2.5 py-1 text-xs font-semibold rounded-lg text-muted-foreground/60 bg-muted/30 border border-border/40 cursor-not-allowed select-none shrink-0"
                                        >
                                            {labelClean}
                                        </span>
                                    );
                                }
                                return (
                                    <Link
                                        key={idx}
                                        href={link.url}
                                        className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition shrink-0 ${
                                            link.active
                                                ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                                                : 'bg-card text-muted-foreground hover:bg-muted border-border/80 hover:text-foreground'
                                        }`}
                                    >
                                        {labelClean}
                                    </Link>
                                );
                            })}
                        </div>
                    )}

                </div>
            </div>
        </AuthenticatedLayout>
    );
}
