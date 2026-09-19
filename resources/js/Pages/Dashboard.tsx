import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link, router, usePage } from '@inertiajs/react';
import { useState, useEffect } from 'react';
import {
    TrendingUp,
    Store as StoreIcon,
    Clock,
    ChevronDown,
    ChevronUp,
    RefreshCw,
    Loader2,
    Sparkles,
    CircleAlert,
    ExternalLink
} from 'lucide-react';
import DonutChart from '@/Components/Charts/DonutChart';
import LineChart from '@/Components/Charts/LineChart';
import GeminiStar from '@/Components/GeminiStar';
import Markdown from '@/Components/Markdown';

interface DashboardProps {
    stats: {
        totalRevenue: number;
        totalHpp: number;
        totalRepairs: number;
        totalReturnPenalty: number;
        netProfit: number;
        totalAffiliatorFee: number;
        soldItemsCount: number;
        pendingProfit: number;
        activeAffiliatorsCount: number;
    };
    allTimeStats: {
        revenue: number;
        actualProfit: number;
        affiliatorFee: number;
        netProfit: number;
        soldItems: number;
    };
    typeData: Array<{ type: string; total: number; revenue: number }>;
    affiliatorData: Array<{ affiliator: string; total_sales: number; total_fee: number }>;
    paymentData: Array<{ method: string; count: number; revenue: number }>;
    monthlyRevenue: Array<{ month: string; revenue: number }>;
    stores: Array<{ id: number; name: string; location: string }>;
    recentSales: Array<{
        id: number;
        invoice_number: string;
        total_amount: number;
        payment_method: string;
        status: string;
        created_at: string;
        buyer?: { name: string };
        user?: { name: string };
    }>;
    topProducts: Array<{
        name: string;
        total_sold: number;
    }>;
    activeStoreName: string;
    filters: {
        store_id: string | null;
        month: number;
        year: number;
    };
    todayStats: {
        gabungan: {
            revenue: number;
            netProfit: number;
            soldItems: number;
            transactions: number;
            store_name: string;
        } | null;
        stores: Array<{
            revenue: number;
            netProfit: number;
            soldItems: number;
            transactions: number;
            store_name: string;
        }>;
        store: {
            revenue: number;
            netProfit: number;
            soldItems: number;
            transactions: number;
            store_name: string;
        } | null;
    };
    aiConfig: {
        is_configured: boolean;
        is_enabled: boolean;
        model: string;
    };
}

export default function Dashboard({
    stats,
    allTimeStats,
    typeData,
    affiliatorData,
    paymentData,
    monthlyRevenue,
    stores,
    recentSales,
    topProducts,
    activeStoreName,
    filters,
    todayStats,
    aiConfig,
}: DashboardProps) {
    const authUser = usePage().props.auth.user as any;
    const isKaryawan = authUser.role === 'karyawan';

    const formatIDR = (val: number) => {
        return `IDR ${new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val)}`;
    };

    const applyFilters = (storeId: string | null, m: number, y: number) => {
        router.get(route('dashboard'), {
            store_id: storeId,
            month: m,
            year: y
        }, { preserveState: true });
    };

    const [currentTime, setCurrentTime] = useState('');
    const [currentDate, setCurrentDate] = useState('');

    useEffect(() => {
        const updateClock = () => {
            const now = new Date();
            setCurrentTime(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
            setCurrentDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }));
        };
        updateClock();
        const interval = setInterval(updateClock, 1000);
        return () => clearInterval(interval);
    }, []);

    const blueChartPalette = [
        '#007AFF',
        '#2563EB',
        '#3B82F6',
        '#60A5FA',
        '#93C5FD',
        '#1D4ED8'
    ];

    const formattedTypeData = typeData.map((t, idx) => ({
        label: t.type,
        value: t.total,
        color: blueChartPalette[idx % blueChartPalette.length]
    }));

    const formattedPaymentData = paymentData.map((p, idx) => ({
        label: p.method,
        value: p.count,
        color: blueChartPalette[(idx + 2) % blueChartPalette.length]
    }));

    const formattedAffiliatorData = affiliatorData.map((a, idx) => ({
        label: a.affiliator,
        value: a.total_sales,
        color: blueChartPalette[(idx + 1) % blueChartPalette.length]
    }));

    const maxVal = Math.max(stats.totalRevenue, 1);
    const hppPercent = Math.min((stats.totalHpp / maxVal) * 100, 100);
    const repairPercent = Math.min((stats.totalRepairs / maxVal) * 100, 100);
    const netProfitPercent = Math.min((stats.netProfit / maxVal) * 100, 100);

    const getMonthName = (m: number) => {
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return months[m - 1] || '';
    };

    const [aiExpanded, setAiExpanded] = useState(false);
    const [aiInsight, setAiInsight] = useState<string | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);

    const aiFetchInsight = async () => {
        if (aiLoading) return;

        if (!aiConfig?.is_configured || !aiConfig?.is_enabled) {
            setAiInsight(null);
            setAiError(
                aiConfig && !aiConfig.is_configured
                    ? 'Gemini API key is not configured yet. Ask the Superadmin to set it in Settings > General.'
                    : 'AI Assistant is currently disabled in system settings.'
            );
            return;
        }

        setAiLoading(true);
        setAiError(null);

        try {
            const res = await fetch(route('dashboard.ai-insight'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                },
                body: JSON.stringify({
                    store_id: filters.store_id,
                    month: filters.month,
                    year: filters.year,
                }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                setAiInsight(null);
                setAiError(data.message || `Server error (${res.status})`);
                return;
            }

            setAiInsight(data.insight);
            setAiGeneratedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } catch (err: any) {
            setAiInsight(null);
            setAiError('Network error while reaching the AI: ' + (err?.message || 'Unknown error'));
        } finally {
            setAiLoading(false);
        }
    };

    const aiToggle = async () => {
        const next = !aiExpanded;
        setAiExpanded(next);
        if (next && aiInsight === null && aiError === null) {
            await aiFetchInsight();
        }
    };

    const aiRefresh = async () => {
        setAiInsight(null);
        setAiGeneratedAt(null);
        await aiFetchInsight();
    };

    return (
        <AuthenticatedLayout>
            <Head title="Financial Dashboard" />

            <div className="py-2 sm:py-4">
                <div className="mx-auto max-w-none px-3 sm:px-6 lg:px-8 space-y-6">

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-border/40">
                        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                            <span className="text-xs font-semibold text-primary">
                                {activeStoreName}
                            </span>
                            <div className="h-3.5 w-px bg-border/60 hidden sm:block" />
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="h-3.5 w-3.5 text-primary" />
                                <span>{currentDate}</span>
                                <span className="font-semibold text-foreground">{currentTime || '--:--'}</span>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
                            {stores.length > 0 && (
                                <select
                                    value={filters.store_id || ''}
                                    onChange={(e) => applyFilters(e.target.value || null, filters.month, filters.year)}
                                    className="rounded-lg border border-border/80 bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-xs focus:border-primary focus:outline-none"
                                >
                                    <option value="">All Branches</option>
                                    {stores.map((store) => (
                                        <option key={store.id} value={store.id}>
                                            {store.name}
                                        </option>
                                    ))}
                                </select>
                            )}

                            <select
                                value={filters.month}
                                onChange={(e) => applyFilters(filters.store_id, parseInt(e.target.value, 10), filters.year)}
                                className="rounded-lg border border-border/80 bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-xs focus:border-primary focus:outline-none"
                            >
                                {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((name, i) => (
                                    <option key={i + 1} value={i + 1}>
                                        {name}
                                    </option>
                                ))}
                            </select>

                            <select
                                value={filters.year}
                                onChange={(e) => applyFilters(filters.store_id, filters.month, parseInt(e.target.value, 10))}
                                className="rounded-lg border border-border/80 bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-xs focus:border-primary focus:outline-none"
                            >
                                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((yr) => (
                                    <option key={yr} value={yr}>
                                        {yr}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="apple-card border border-border/60 overflow-hidden shadow-xs">
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                            <button
                                type="button"
                                onClick={aiToggle}
                                className="flex-1 flex items-center gap-3 min-w-0 text-left rounded-xl px-1.5 py-1 -ml-1.5 transition hover:bg-muted/30"
                            >
                                <div className="h-8 w-8 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                                    <GeminiStar className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold tracking-tight text-foreground">
                                            AI Business Overview
                                        </span>
                                        {aiLoading && (
                                            <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                                        )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground truncate">
                                        {aiExpanded
                                            ? 'Executive summary of this period'
                                            : aiInsight
                                                ? 'Tap to view the saved AI summary'
                                                : 'Gemini-powered summary • Tap to generate'}
                                    </p>
                                </div>
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                                {aiExpanded && aiInsight && !aiLoading && (
                                    <button
                                        type="button"
                                        onClick={aiRefresh}
                                        title="Regenerate insight"
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted/70 transition"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={aiToggle}
                                    title={aiExpanded ? 'Collapse' : 'Expand'}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 transition"
                                >
                                    {aiExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>

                        {aiExpanded && (
                            <div className="border-t border-border/40 bg-muted/20">
                                <div className="px-4 py-3.5">
                                    {aiLoading ? (
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                                            <span>
                                                Analyzing {getMonthName(filters.month)} {filters.year} — {activeStoreName}...
                                            </span>
                                        </div>
                                    ) : aiError ? (
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-2 text-xs text-destructive">
                                                <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                                <span className="break-words">{aiError}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={aiRefresh}
                                                className="shrink-0 flex items-center gap-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:border-primary/50 hover:bg-primary/5 transition"
                                            >
                                                <RefreshCw className="h-3 w-3" />
                                                Retry
                                            </button>
                                        </div>
                                    ) : aiInsight ? (
                                        <div className="space-y-2">
                                            <Markdown content={aiInsight} />
                                            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[10px] text-muted-foreground/70">
                                                <span className="flex items-center gap-1">
                                                    <Sparkles className="h-3 w-3 text-primary" />
                                                    Generated by Gemini
                                                </span>
                                                <span>{aiGeneratedAt}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary" />
                                            <span>No summary yet. Click the refresh button above to generate one.</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between px-0.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                All-Time Overview
                            </span>
                            <span className="text-xs text-muted-foreground">Cumulative</span>
                        </div>

                        <div className="apple-card overflow-hidden divide-y divide-border/40 sm:divide-y-0 sm:divide-x sm:grid sm:grid-cols-5 border border-border/60">
                            <div className="p-4 relative">
                                <div className="text-xs text-muted-foreground mb-1">
                                    All-Time Revenue
                                </div>
                                <p className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                                    {formatIDR(allTimeStats.revenue)}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Total recorded sales</p>
                            </div>

                            {!isKaryawan && (
                                <>
                                    <div className="p-4 relative">
                                        <div className="text-xs text-muted-foreground mb-1">
                                            Gross Profit
                                        </div>
                                        <p className="text-lg sm:text-xl font-bold tracking-tight text-primary">
                                            {formatIDR(allTimeStats.actualProfit)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">Total margin</p>
                                    </div>

                                    <div className="p-4 relative">
                                        <div className="text-xs text-muted-foreground mb-1">
                                            Affiliate Fees
                                        </div>
                                        <p className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                                            {formatIDR(allTimeStats.affiliatorFee)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">Paid commissions</p>
                                    </div>

                                    <div className="p-4 relative bg-primary/5">
                                        <div className="text-xs text-primary font-semibold mb-1">
                                            All-Time Net Profit
                                        </div>
                                        <p className={`text-lg sm:text-xl font-bold tracking-tight ${
                                            allTimeStats.netProfit >= 0 ? 'text-primary' : 'text-destructive'
                                        }`}>
                                            {formatIDR(allTimeStats.netProfit)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">Bottom line net</p>
                                    </div>
                                </>
                            )}

                            <div className="p-4 relative">
                                <div className="text-xs text-muted-foreground mb-1">
                                    Volume Sold
                                </div>
                                <p className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                                    {allTimeStats.soldItems} <span className="text-xs font-normal text-muted-foreground">Units</span>
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Total units sold</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between px-0.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Today's Performance
                            </span>
                            <span className="text-xs text-muted-foreground">Active Session</span>
                        </div>

                        {authUser.role === 'superadmin' ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                {todayStats.gabungan && (
                                    <div className="apple-card p-4 border border-primary/40 bg-primary/5 shadow-xs flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-center justify-between text-xs font-bold text-primary pb-2 mb-2 border-b border-primary/20">
                                                <span className="flex items-center gap-1.5">
                                                    <StoreIcon className="h-3.5 w-3.5" />
                                                    {todayStats.gabungan.store_name}
                                                </span>
                                                <span className="text-[10px] uppercase">All Branches</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 mt-1">
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
                                                    <p className="text-sm font-bold text-foreground">{formatIDR(todayStats.gabungan.revenue)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Net Margin</p>
                                                    <p className={`text-sm font-bold ${todayStats.gabungan.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                                        {formatIDR(todayStats.gabungan.netProfit)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Volume</p>
                                                    <p className="text-xs font-semibold text-foreground">{todayStats.gabungan.soldItems} Units</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Executions</p>
                                                    <p className="text-xs font-semibold text-foreground">{todayStats.gabungan.transactions} TRX</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {todayStats.stores.map((storeStat, idx) => (
                                    <div key={idx} className="apple-card p-4 border border-border/70 shadow-xs flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground pb-2 mb-2 border-b border-border/40">
                                                <StoreIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span className="truncate">{storeStat.store_name}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 mt-1">
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
                                                    <p className="text-xs font-bold text-foreground">{formatIDR(storeStat.revenue)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Net Margin</p>
                                                    <p className={`text-xs font-bold ${storeStat.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                                        {formatIDR(storeStat.netProfit)}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Volume</p>
                                                    <p className="text-xs font-semibold text-foreground">{storeStat.soldItems} Units</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Executions</p>
                                                    <p className="text-xs font-semibold text-foreground">{storeStat.transactions} TRX</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="max-w-md">
                                {todayStats.store && (
                                    <div className="apple-card p-4 border border-border/70 shadow-xs flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-center gap-1.5 text-xs font-bold text-primary pb-2 mb-2 border-b border-border/40">
                                                <StoreIcon className="h-3.5 w-3.5" />
                                                <span>{todayStats.store.store_name}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 mt-1">
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Today Revenue</p>
                                                    <p className="text-xs font-bold text-foreground">{formatIDR(todayStats.store.revenue)}</p>
                                                </div>
                                                {!isKaryawan && (
                                                    <div>
                                                        <p className="text-[10px] text-muted-foreground uppercase">Net Margin</p>
                                                        <p className={`text-xs font-bold ${todayStats.store.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                                            {formatIDR(todayStats.store.netProfit)}
                                                        </p>
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Volume</p>
                                                    <p className="text-xs font-semibold text-foreground">{todayStats.store.soldItems} Units</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-muted-foreground uppercase">Executions</p>
                                                    <p className="text-xs font-semibold text-foreground">{todayStats.store.transactions} TRX</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-border/40 pb-2">
                            <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                                <span>Period: {getMonthName(filters.month)} {filters.year}</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    • {activeStoreName}
                                </span>
                            </h2>
                            <span className="text-xs text-muted-foreground">Monthly Summary</span>
                        </div>

                        <div className="apple-card overflow-hidden border border-border/60">
                            <div className={`grid grid-cols-1 divide-y divide-border/40 sm:divide-y-0 sm:divide-x sm:grid-cols-2 ${isKaryawan ? '' : 'md:grid-cols-4'}`}>
                                <div className="p-4">
                                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                                        Revenue ({getMonthName(filters.month).slice(0, 3)})
                                    </div>
                                    <p className="text-xl font-bold tracking-tight text-foreground">{formatIDR(stats.totalRevenue)}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">Total sales and addons</p>
                                </div>

                                {isKaryawan ? (
                                     <div className="p-4">
                                         <div className="text-xs font-semibold text-muted-foreground mb-1">
                                             Sold Units
                                         </div>
                                         <p className="text-xl font-bold tracking-tight text-foreground">{stats.soldItemsCount} Units</p>
                                         <p className="text-[10px] text-muted-foreground mt-0.5">Recorded units this period</p>
                                     </div>
                                 ) : (
                                     <>
                                         <div className="p-4">
                                             <div className="text-xs font-semibold text-muted-foreground mb-1">
                                                 Total COGS
                                             </div>
                                             <p className="text-xl font-bold tracking-tight text-foreground">{formatIDR(stats.totalHpp)}</p>
                                             <p className="text-[10px] text-muted-foreground mt-0.5">Cost of sold devices</p>
                                         </div>

                                         <div className="p-4">
                                             <div className="text-xs font-semibold text-muted-foreground mb-1">
                                                 Warranty & Claims
                                             </div>
                                             <p className="text-xl font-bold tracking-tight text-destructive">{formatIDR(stats.totalRepairs)}</p>
                                             <p className="text-[10px] text-muted-foreground mt-0.5">Repair expenses</p>
                                         </div>

                                         <div className="p-4">
                                             <div className="text-xs font-semibold text-muted-foreground mb-1">
                                                 Restocking Penalty
                                             </div>
                                             <p className="text-xl font-bold tracking-tight text-foreground">{formatIDR(stats.totalReturnPenalty)}</p>
                                             <p className="text-[10px] text-muted-foreground mt-0.5">10% return fees</p>
                                         </div>
                                     </>
                                 )}
                            </div>

                            {!isKaryawan && (
                                <div className="grid grid-cols-1 divide-y divide-border/40 sm:divide-y-0 sm:divide-x sm:grid-cols-3 border-t border-border/40">
                                    <div className="p-4">
                                        <div className="text-xs font-semibold text-muted-foreground mb-1">
                                            Affiliate Fees
                                        </div>
                                        <p className="text-xl font-bold tracking-tight text-foreground">{formatIDR(stats.totalAffiliatorFee)}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">Partner commissions</p>
                                    </div>

                                    <div className="p-4 bg-primary/5">
                                        <div className="text-xs font-bold text-primary mb-1">
                                            Net Period Margin
                                        </div>
                                        <p className={`text-xl font-bold tracking-tight ${
                                            stats.netProfit >= 0 ? 'text-primary' : 'text-destructive'
                                        }`}>
                                            {formatIDR(stats.netProfit)}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">Net profit after all costs</p>
                                    </div>

                                    <div className="p-4">
                                        <div className="text-xs font-semibold text-muted-foreground mb-1">
                                            Units Executed
                                        </div>
                                        <p className="text-xl font-bold tracking-tight text-foreground">{stats.soldItemsCount} Units</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">Total units sold this period</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {!isKaryawan && (
                        <div className="apple-card p-4 sm:p-5 border border-border/60">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3">
                                <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                                    Capital Allocation & Margin Breakdown
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {getMonthName(filters.month)} {filters.year}
                                </span>
                            </div>

                            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted flex border border-border/40">
                                <div style={{ width: `${hppPercent}%` }} className="bg-primary/50 transition-all duration-500" title={`COGS: ${hppPercent.toFixed(1)}%`} />
                                <div style={{ width: `${repairPercent}%` }} className="bg-destructive transition-all duration-500" title={`Repairs: ${repairPercent.toFixed(1)}%`} />
                                <div style={{ width: `${netProfitPercent}%` }} className="bg-primary transition-all duration-500" title={`Net Margin: ${netProfitPercent.toFixed(1)}%`} />
                            </div>

                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-border/40 text-xs">
                                <div className="flex items-center justify-between bg-muted/30 p-2 rounded-lg border border-border/40">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-primary/60" />
                                        <span className="text-muted-foreground">COGS</span>
                                    </div>
                                    <span className="font-semibold text-foreground">{formatIDR(stats.totalHpp)} ({hppPercent.toFixed(1)}%)</span>
                                </div>
                                <div className="flex items-center justify-between bg-muted/30 p-2 rounded-lg border border-border/40">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-destructive" />
                                        <span className="text-muted-foreground">Warranty</span>
                                    </div>
                                    <span className="font-semibold text-destructive">{formatIDR(stats.totalRepairs)} ({repairPercent.toFixed(1)}%)</span>
                                </div>
                                <div className="flex items-center justify-between bg-muted/30 p-2 rounded-lg border border-border/40">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2 w-2 rounded-full bg-primary" />
                                        <span className="text-muted-foreground">Net Margin</span>
                                    </div>
                                    <span className={`font-semibold ${stats.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                        {formatIDR(stats.netProfit)} ({netProfitPercent.toFixed(1)}%)
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="w-full">
                        <LineChart data={monthlyRevenue} />
                    </div>

                    <div className={`grid grid-cols-1 gap-4 ${isKaryawan ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
                        <DonutChart data={formattedTypeData} title="Best Selling Models" />
                        <DonutChart data={formattedPaymentData} title="Payment Methods" />
                        {!isKaryawan && <DonutChart data={formattedAffiliatorData} title="Affiliate Commissions" />}
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2 apple-card p-4 sm:p-5 border border-border/60">
                            <div className="flex items-center justify-between mb-3 border-b border-border/40 pb-2.5">
                                <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                                    Order Execution Ledger
                                </span>
                                <Link
                                    href={route('sales-history.index')}
                                    className="text-xs font-semibold text-primary hover:underline"
                                >
                                    View All &rarr;
                                </Link>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[620px] text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-border/60 text-xs uppercase text-muted-foreground">
                                            <th className="pb-2">Invoice</th>
                                            <th className="pb-2">Customer</th>
                                            <th className="pb-2">Cashier</th>
                                            <th className="pb-2">Total</th>
                                            <th className="pb-2">Method</th>
                                            <th className="pb-2 text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40 text-xs text-foreground">
                                        {recentSales.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                                                    No transactions recorded.
                                                </td>
                                            </tr>
                                        ) : (
                                            recentSales.map((sale) => (
                                                <tr key={sale.id} className="hover:bg-muted/40 transition-colors">
                                                    <td className="py-2.5 font-semibold text-foreground">{sale.invoice_number}</td>
                                                    <td className="py-2.5 text-muted-foreground">{sale.buyer?.name || 'Walk-in Customer'}</td>
                                                    <td className="py-2.5 text-muted-foreground">
                                                        <span>{sale.user?.name || '-'}</span>
                                                    </td>
                                                    <td className="py-2.5 font-semibold text-primary">
                                                        {formatIDR(sale.total_amount)}
                                                    </td>
                                                    <td className="py-2.5">
                                                        <span className="text-[11px] text-muted-foreground font-medium">
                                                            {sale.payment_method}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 text-right">
                                                        <span className={`text-[11px] font-semibold ${
                                                            sale.status === 'completed'
                                                                ? 'text-primary'
                                                                : 'text-destructive'
                                                        }`}>
                                                            {sale.status === 'completed' ? 'Completed' : 'Cancelled'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="apple-card p-4 sm:p-5 border border-border/60 flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between mb-3 border-b border-border/40 pb-2.5">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                                        Top Selling Products
                                    </span>
                                </div>
                                <div className="space-y-3.5 mt-2">
                                    {topProducts.length === 0 ? (
                                        <p className="text-center text-xs text-muted-foreground py-8">No inventory sold yet.</p>
                                    ) : (
                                        topProducts.map((prod, idx) => {
                                            const totalSold = parseInt(prod.total_sold as any, 10);
                                            const highestSold = parseInt(topProducts[0]?.total_sold as any || 1, 10);
                                            const fillPercent = Math.min((totalSold / highestSold) * 100, 100);

                                            return (
                                                <div key={idx} className="space-y-1">
                                                    <div className="flex justify-between text-xs">
                                                        <span className="truncate max-w-[170px] text-foreground font-medium">{prod.name}</span>
                                                        <span className="text-primary font-bold">{prod.total_sold} Units</span>
                                                    </div>
                                                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                                        <div
                                                            style={{ width: `${fillPercent}%` }}
                                                            className="h-full rounded-full bg-primary transition-all duration-300"
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            <div className="mt-6 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground border border-border/50">
                                Dynamic aggregate volumes across all stores in selected timeframe.
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </AuthenticatedLayout>
    );
}
