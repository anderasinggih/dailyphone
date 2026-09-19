import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import {
    Users,
    Search,
    User,
    Phone,
    MapPin,
    TrendingUp,
    Award,
    Calendar,
    ShoppingBag,
    Tag,
    Edit3,
    Check,
    X,
    MessageSquare,
    SlidersHorizontal
} from 'lucide-react';
import StatCard from '@/Components/StatCard';
import { getParamBadgeClass } from './Settings/Parameters';

interface Customer {
    id: number;
    name: string;
    phone: string;
    address: string | null;
    flag: string;
    notes: string | null;
    total_purchases: number;
    total_spent: number;
    total_items_bought: number;
    created_at: string;
}

interface FlagOption {
    value: string;
    color: string;
}

interface CustomersProps {
    customers: Customer[];
    flagOptions: FlagOption[];
}

const DEFAULT_FLAGS: FlagOption[] = [
    { value: 'Regular', color: 'slate' },
    { value: 'VIP Client', color: 'amber' },
    { value: 'Reseller', color: 'blue' },
    { value: 'Warning / Blacklist', color: 'red' },
];

export default function Customers({ customers, flagOptions = [] }: CustomersProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [flagFilter, setFlagFilter] = useState<string>('all');
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [editFlag, setEditFlag] = useState<string>('Regular');
    const [editNotes, setEditNotes] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);

    // Merge system dynamic parameters with defaults if empty
    const availableFlags = flagOptions.length > 0 ? flagOptions : DEFAULT_FLAGS;

    const filteredCustomers = customers.filter(c => {
        const matchesQuery =
            c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.phone.includes(searchQuery) ||
            (c.address && c.address.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (c.notes && c.notes.toLowerCase().includes(searchQuery.toLowerCase()));

        if (flagFilter === 'all') return matchesQuery;
        return matchesQuery && (c.flag || '').toLowerCase() === flagFilter.toLowerCase();
    });

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    const totalCustomers = customers.length;
    const totalSalesVolume = customers.reduce((acc, curr) => acc + curr.total_spent, 0);
    const avgSpent = totalCustomers > 0 ? totalSalesVolume / totalCustomers : 0;
    const vipCustomer = customers.reduce((prev, curr) => (prev.total_spent > curr.total_spent) ? prev : curr, {} as Customer);

    const openEditModal = (cust: Customer) => {
        setSelectedCustomer(cust);
        setEditFlag(cust.flag || availableFlags[0]?.value || 'Regular');
        setEditNotes(cust.notes || '');
    };

    const submitFlagAndNotes = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCustomer) return;
        setIsSaving(true);
        router.patch(route('customers.update-flag', selectedCustomer.id), {
            flag: editFlag,
            notes: editNotes,
        }, {
            preserveScroll: true,
            onSuccess: () => {
                setSelectedCustomer(null);
            },
            onFinish: () => setIsSaving(false)
        });
    };

    const getFlagColor = (flagValue: string) => {
        const found = availableFlags.find(f => f.value.toLowerCase() === (flagValue || '').toLowerCase());
        return found?.color || 'slate';
    };

    return (
        <AuthenticatedLayout>
            <Head title="Customers" />

            <div className="py-6 sm:py-8">
                <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 space-y-6">

                    {/* Metric Cards */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <StatCard
                            title="Total Customers"
                            value={totalCustomers}
                            description="Active registered clients"
                            icon={<Users className="h-4 w-4" />}
                            isCurrency={false}
                            suffix="Clients"
                        />
                        <StatCard
                            title="Total Revenue"
                            value={totalSalesVolume}
                            description="Accumulated gross volume"
                            icon={<TrendingUp className="h-4 w-4" />}
                        />
                        <StatCard
                            title="Average Order"
                            value={avgSpent}
                            description="Average spend per client"
                            icon={<ShoppingBag className="h-4 w-4" />}
                        />
                        <StatCard
                            title="Top Customer"
                            value={vipCustomer?.name || 'None yet'}
                            description={vipCustomer?.total_spent ? formatCurrency(vipCustomer.total_spent) : '-'}
                            icon={<Award className="h-4 w-4" />}
                            isCurrency={false}
                        />
                    </div>

                    {/* Search & Dynamic Flag Filter Tabs */}
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search customer, phone, notes..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-xl border border-border/70 bg-card pl-9 pr-4 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none transition"
                            />
                        </div>

                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                            <button
                                onClick={() => setFlagFilter('all')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition whitespace-nowrap ${
                                    flagFilter === 'all'
                                        ? 'bg-primary text-primary-foreground shadow-xs'
                                        : 'bg-card text-muted-foreground hover:bg-muted border border-border/60 hover:text-foreground'
                                }`}
                            >
                                All Flags
                            </button>
                            {availableFlags.map((flg) => {
                                const isSelected = flagFilter.toLowerCase() === flg.value.toLowerCase();
                                const badgeClass = getParamBadgeClass(flg.color);
                                return (
                                    <button
                                        key={flg.value}
                                        onClick={() => setFlagFilter(flg.value)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap border ${
                                            isSelected
                                                ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                                                : `${badgeClass} hover:opacity-80`
                                        }`}
                                    >
                                        {flg.value}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Customers Table */}
                    <div className="apple-card p-5 text-card-foreground">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[950px] text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-border/60 text-[11px] font-semibold tracking-wider text-muted-foreground">
                                        <th className="pb-3 font-semibold">Customer</th>
                                        <th className="pb-3 font-semibold">Status Flag</th>
                                        <th className="pb-3 font-semibold">Phone</th>
                                        <th className="pb-3 font-semibold">Address / Notes</th>
                                        <th className="pb-3 font-semibold text-center">Orders</th>
                                        <th className="pb-3 font-semibold text-center">Units</th>
                                        <th className="pb-3 font-semibold">Total Spent (IDR)</th>
                                        <th className="pb-3 font-semibold text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40 text-sm font-medium text-foreground">
                                    {filteredCustomers.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="py-8 text-center text-muted-foreground">No customers found.</td>
                                        </tr>
                                    ) : (
                                        filteredCustomers.map((cust) => {
                                            const flagColor = getFlagColor(cust.flag);
                                            const badgeClass = getParamBadgeClass(flagColor);

                                            return (
                                                <tr key={cust.id} className="hover:bg-muted/40 transition">
                                                    <td className="py-3.5">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="rounded-full bg-muted p-2">
                                                                <User className="h-4 w-4 text-muted-foreground" />
                                                            </div>
                                                            <div>
                                                                <p className="font-semibold text-foreground leading-tight">
                                                                    {cust.name}
                                                                </p>
                                                                <span className="text-[11px] text-muted-foreground">
                                                                    Joined {new Date(cust.created_at).toLocaleDateString('en-US')}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-4">
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${badgeClass}`}>
                                                            {cust.flag || 'Regular'}
                                                        </span>
                                                    </td>
                                                    <td className="py-4">
                                                        <span className="flex items-center gap-1 text-muted-foreground font-mono text-xs">
                                                            <Phone className="h-3 w-3 text-muted-foreground/70" />
                                                            {cust.phone}
                                                        </span>
                                                    </td>
                                                    <td className="py-4 max-w-[260px]">
                                                        <div className="space-y-0.5">
                                                            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground" title={cust.address || ''}>
                                                                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                                                                {cust.address || '-'}
                                                            </span>
                                                            {cust.notes && (
                                                                <span className="flex items-center gap-1 truncate text-[11px] font-medium text-foreground/80 bg-muted/60 px-1.5 py-0.5 rounded" title={cust.notes}>
                                                                    <MessageSquare className="h-2.5 w-2.5 shrink-0 text-primary" />
                                                                    {cust.notes}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-4 text-center font-semibold text-foreground text-xs">
                                                        {cust.total_purchases}
                                                    </td>
                                                    <td className="py-4 text-center text-primary font-bold text-xs">
                                                        {cust.total_items_bought} units
                                                    </td>
                                                    <td className="py-4 font-semibold text-foreground text-xs">
                                                        {formatCurrency(cust.total_spent)}
                                                    </td>
                                                    <td className="py-4 text-right">
                                                        <button
                                                            onClick={() => openEditModal(cust)}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-border/80 bg-card hover:bg-muted text-foreground transition"
                                                        >
                                                            <Edit3 className="h-3 w-3 text-primary" />
                                                            Edit Flag
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal: Edit Flag & Notes */}
            {selectedCustomer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card border border-border/80 p-5 shadow-xl animate-in fade-in duration-150">
                        <div className="flex items-center justify-between pb-3 border-b border-border/50">
                            <div>
                                <h3 className="text-sm font-bold text-foreground">Customer Flag & Notes</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">{selectedCustomer.name} ({selectedCustomer.phone})</p>
                            </div>
                            <button
                                onClick={() => setSelectedCustomer(null)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <form onSubmit={submitFlagAndNotes} className="mt-4 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                    Select Status Flag
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {availableFlags.map((opt) => {
                                        const isSelected = editFlag.toLowerCase() === opt.value.toLowerCase();
                                        const badgeClass = getParamBadgeClass(opt.color);

                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setEditFlag(opt.value)}
                                                className={`py-2 px-3 rounded-xl border text-xs font-bold text-center transition ${
                                                    isSelected
                                                        ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                                                        : `bg-background hover:bg-muted ${badgeClass}`
                                                }`}
                                            >
                                                {opt.value}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                    Internal Notes
                                </label>
                                <textarea
                                    rows={3}
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    placeholder="Add client preferences, payment terms, or warnings..."
                                    className="w-full rounded-xl border border-border/70 bg-background p-3 text-xs text-foreground focus:outline-none focus:border-primary"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
                                <button
                                    type="button"
                                    onClick={() => setSelectedCustomer(null)}
                                    className="px-3 py-1.5 rounded-xl border border-border/70 text-xs font-semibold text-muted-foreground hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
                                >
                                    {isSaving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}
