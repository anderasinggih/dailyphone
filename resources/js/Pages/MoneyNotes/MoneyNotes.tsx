import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm } from '@inertiajs/react';
import { useState } from 'react';
import {
    Plus,
    Trash2,
    ArrowUpRight,
    ArrowDownRight,
    TrendingUp,
    TrendingDown,
    Wallet,
    Calendar,
    Tag,
    FileText,
    DollarSign,
    FolderPlus,
    X,
    Search,
    Filter
} from 'lucide-react';
import StatCard from '@/Components/StatCard';

interface Category {
    id: number;
    name: string;
    type: 'in' | 'out';
}

interface MoneyLog {
    id: number;
    type: 'in' | 'out';
    amount: number;
    category: string;
    description: string | null;
    date: string;
    created_at: string;
}

interface MoneyNotesProps {
    logs: MoneyLog[];
    categories: Category[];
    summary: {
        total_income: number;
        total_expense: number;
        balance: number;
    };
}

export default function MoneyNotes({ logs, categories, summary }: MoneyNotesProps) {
    const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all');
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const [showTransactionModal, setShowTransactionModal] = useState(false);

    const { data, setData, post, processing, reset, errors } = useForm({
        type: 'in' as 'in' | 'out',
        amount: '',
        category: '',
        description: '',
        date: new Date().toISOString().split('T')[0]
    });

    const [showNewCatModal, setShowNewCatModal] = useState(false);
    const catForm = useForm({
        name: '',
        type: 'in' as 'in' | 'out'
    });

    const activeCategories = categories.filter(c => c.type === data.type);

    const submitTransaction = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('money-notes.store'), {
            onSuccess: () => {
                reset('amount', 'description');
                setShowTransactionModal(false);
                alert('Transaction recorded successfully!');
            }
        });
    };

    const submitCategory = (e: React.FormEvent) => {
        e.preventDefault();
        catForm.post(route('money-notes.category.store'), {
            onSuccess: () => {
                setShowNewCatModal(false);
                catForm.reset();
                alert('New category added successfully!');
            }
        });
    };

    const handleDelete = (id: number) => {
        if (confirm('Are you sure you want to delete this financial note?')) {
            post(route('money-notes.destroy', id), {
                _method: 'DELETE',
                onSuccess: () => {
                    alert('Note deleted successfully.');
                }
            } as any);
        }
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    const filteredLogs = logs.filter(log => {
        const matchesType = filterType === 'all' ? true : log.type === filterType;
        const matchesCategory = filterCategory === 'all' ? true : log.category === filterCategory;
        const matchesSearch =
            log.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (log.description && log.description.toLowerCase().includes(searchQuery.toLowerCase()));

        let matchesDate = true;
        if (startDate) {
            matchesDate = matchesDate && log.date >= startDate;
        }
        if (endDate) {
            matchesDate = matchesDate && log.date <= endDate;
        }

        return matchesType && matchesCategory && matchesSearch && matchesDate;
    });

    const dynamicSummary = filteredLogs.reduce((acc, log) => {
        const amt = Number(log.amount);
        if (log.type === 'in') {
            acc.total_income += amt;
            acc.balance += amt;
        } else {
            acc.total_expense += amt;
            acc.balance -= amt;
        }
        return acc;
    }, { total_income: 0, total_expense: 0, balance: 0 });

    return (
        <AuthenticatedLayout>
            <Head title="Money Notes - Business Finance" />

            <div className="py-8">
                <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 space-y-8">

                    {}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold text-foreground tracking-tight">Money Notes</h2>
                            <p className="text-xs font-medium text-muted-foreground mt-1">Independent operational cash and petty expense ledger.</p>
                        </div>
                        <button
                            onClick={() => setShowTransactionModal(true)}
                            className="rounded-2xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] shadow-sm transition flex items-center gap-2"
                        >
                            <Plus className="h-4 w-4" /> Record Transaction
                        </button>
                    </div>

                    {}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <StatCard
                            title="Total Income"
                            value={dynamicSummary.total_income}
                            icon={<TrendingUp className="h-4 w-4" />}
                        />
                        <StatCard
                            title="Total Expenses"
                            value={dynamicSummary.total_expense}
                            icon={<TrendingDown className="h-4 w-4" />}
                        />
                        <StatCard
                            title="Cash Balance"
                            value={dynamicSummary.balance}
                            icon={<Wallet className="h-4 w-4" />}
                        />
                    </div>


                    <div className="space-y-6">
                        {}
                        <div className="space-y-4">

                            {}
                            <div className="apple-card p-4 text-card-foreground flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    {}
                                    <select
                                        value={filterType}
                                        onChange={e => setFilterType(e.target.value as any)}
                                        className="rounded-xl border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                                    >
                                        <option value="all">All Types</option>
                                        <option value="in">Income (+)</option>
                                        <option value="out">Expense (-)</option>
                                    </select>

                                    {}
                                    <select
                                        value={filterCategory}
                                        onChange={e => setFilterCategory(e.target.value)}
                                        className="rounded-xl border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                                    >
                                        <option value="all">All Categories</option>
                                        {Array.from(new Set(categories.map(c => c.name))).map(catName => (
                                             <option key={catName} value={catName}>{catName}</option>
                                        ))}
                                    </select>

                                    {}
                                    <div className="flex items-center gap-1.5 text-xs">
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={e => setStartDate(e.target.value)}
                                            className="rounded-xl border border-border/60 bg-card px-2.5 py-1.5 text-[11px] font-medium text-foreground focus:outline-none focus:border-primary"
                                        />
                                        <span className="text-muted-foreground font-medium">to</span>
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={e => setEndDate(e.target.value)}
                                            className="rounded-xl border border-border/60 bg-card px-2.5 py-1.5 text-[11px] font-medium text-foreground focus:outline-none focus:border-primary"
                                        />
                                        {(startDate || endDate) && (
                                            <button
                                                onClick={() => {
                                                    setStartDate('');
                                                    setEndDate('');
                                                }}
                                                className="text-[10px] text-destructive hover:opacity-80 font-bold ml-1 "
                                            >
                                                Reset
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="relative">
                                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="Search description..."
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="rounded-xl border border-border/60 bg-card pl-9 pr-4 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:border-primary w-full md:w-60"
                                    />
                                </div>
                            </div>

                            {}
                            <div className="apple-card p-5 text-card-foreground">
                                <h3 className="text-base font-semibold text-foreground mb-4">Financial Ledger History</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[600px] text-left border-collapse text-sm">
                                        <thead>
                                            <tr className="border-b border-border/60 text-xs font-semibold tracking-wider text-muted-foreground">
                                                <th className="pb-3 font-semibold">Date</th>
                                                <th className="pb-3 font-semibold">Category</th>
                                                <th className="pb-3 font-semibold">Description</th>
                                                <th className="pb-3 font-semibold text-right">Amount</th>
                                                <th className="pb-3 font-semibold text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/40 text-sm font-medium text-muted-foreground">
                                            {filteredLogs.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="py-8 text-center text-muted-foreground">No financial records found.</td>
                                                </tr>
                                            ) : (
                                                filteredLogs.map(log => (
                                                    <tr key={log.id} className="hover:bg-muted/40 transition">
                                                        <td className="py-4 font-semibold text-xs whitespace-nowrap text-foreground">
                                                            {new Date(log.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                                        </td>
                                                        <td className="py-4">
                                                            <span className="rounded-lg bg-primary/10 text-primary px-2 py-0.5 text-xs font-semibold border border-primary/20">
                                                                {log.category}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 text-xs font-medium text-foreground max-w-xs truncate" title={log.description || '-'}>
                                                            {log.description || '-'}
                                                        </td>
                                                        <td className={`py-4 text-right font-bold ${
                                                            log.type === 'in'
                                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                                : 'text-foreground'
                                                        }`}>
                                                            {log.type === 'in' ? '+' : '-'} {formatCurrency(log.amount)}
                                                        </td>
                                                        <td className="py-4 text-right">
                                                            <button
                                                                onClick={() => handleDelete(log.id)}
                                                                className="text-muted-foreground hover:text-destructive p-1 rounded-lg transition"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {}
            {showTransactionModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border/80 text-card-foreground my-8 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center pb-4 border-b border-border/60 mb-4">
                            <h4 className="text-lg font-bold text-foreground tracking-tight">Record Transaction</h4>
                            <button onClick={() => setShowTransactionModal(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={submitTransaction} className="space-y-4">
                            {}
                            <div>
                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Transaction Type</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setData(prev => ({ ...prev, type: 'in', category: '' }));
                                        }}
                                        className={`rounded-xl py-2.5 text-xs font-semibold border transition ${
                                            data.type === 'in'
                                                ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                                                : 'border-border/60 hover:bg-muted text-foreground'
                                        }`}
                                    >
                                        Income (+)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setData(prev => ({ ...prev, type: 'out', category: '' }));
                                        }}
                                        className={`rounded-xl py-2.5 text-xs font-semibold border transition ${
                                            data.type === 'out'
                                                ? 'bg-destructive border-destructive text-destructive-foreground shadow-sm'
                                                : 'border-border/60 hover:bg-muted text-foreground'
                                        }`}
                                    >
                                        Expense (-)
                                    </button>
                                </div>
                            </div>

                            {}
                            <div>
                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Amount (IDR)</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-xs font-bold text-muted-foreground">
                                        Rp
                                    </div>
                                    <input
                                        type="number"
                                        required
                                        min="0.01"
                                        step="any"
                                        value={data.amount}
                                        onChange={e => setData('amount', e.target.value)}
                                        className="w-full rounded-xl border border-border/60 bg-card pl-10 pr-4 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                        placeholder="0"
                                    />
                                </div>
                                {errors.amount && <p className="text-xs text-destructive mt-1">{errors.amount}</p>}
                            </div>

                            {}
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="block text-[10px] font-bold text-muted-foreground">Category</label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            catForm.setData('type', data.type);
                                            setShowNewCatModal(true);
                                        }}
                                        className="text-[10px] font-semibold text-primary hover:opacity-80 flex items-center gap-1"
                                    >
                                        <FolderPlus className="h-3 w-3" /> Add Category
                                    </button>
                                </div>
                                <select
                                    required
                                    value={data.category}
                                    onChange={e => setData('category', e.target.value)}
                                    className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                >
                                    <option value="">-- Select Category --</option>
                                    {activeCategories.map(cat => (
                                        <option key={cat.id} value={cat.name}>{cat.name}</option>
                                    ))}
                                </select>
                                {errors.category && <p className="text-xs text-destructive mt-1">{errors.category}</p>}
                            </div>

                            {}
                            <div>
                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Date</label>
                                <input
                                    type="date"
                                    required
                                    value={data.date}
                                    onChange={e => setData('date', e.target.value)}
                                    className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                />
                                {errors.date && <p className="text-xs text-destructive mt-1">{errors.date}</p>}
                            </div>

                            {}
                            <div>
                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Description / Details</label>
                                <textarea
                                    value={data.description}
                                    onChange={e => setData('description', e.target.value)}
                                    className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-medium text-foreground focus:outline-none focus:border-primary h-24 resize-none"
                                    placeholder="e.g. Monthly internet bill..."
                                />
                                {errors.description && <p className="text-xs text-destructive mt-1">{errors.description}</p>}
                            </div>

                            <button
                                type="submit"
                                disabled={processing}
                                className="w-full rounded-xl bg-primary py-3 text-xs font-semibold text-primary-foreground hover:opacity-90 shadow-sm transition disabled:opacity-50"
                            >
                                {processing ? 'Saving...' : 'Save Transaction'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {}
            {showNewCatModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border/80 text-card-foreground animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex justify-between items-center pb-4 border-b border-border/60 mb-4">
                            <h4 className="text-lg font-bold text-foreground tracking-tight">Add New Category</h4>
                            <button onClick={() => setShowNewCatModal(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={submitCategory} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Category Type</label>
                                <select
                                    required
                                    value={catForm.data.type}
                                    onChange={e => catForm.setData('type', e.target.value as any)}
                                    className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                >
                                    <option value="in">Income (+)</option>
                                    <option value="out">Expense (-)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Category Name</label>
                                <input
                                    type="text"
                                    required
                                    value={catForm.data.name}
                                    onChange={e => catForm.setData('name', e.target.value)}
                                    className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                    placeholder="e.g. Utilities, Stationery, Transport..."
                                />
                                {catForm.errors.name && <p className="text-xs text-destructive mt-1">{catForm.errors.name}</p>}
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-border/60">
                                <button
                                    type="button"
                                    onClick={() => setShowNewCatModal(false)}
                                    className="flex-1 rounded-xl border border-border/60 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={catForm.processing}
                                    className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                                >
                                    {catForm.processing ? 'Saving...' : 'Save Category'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}

