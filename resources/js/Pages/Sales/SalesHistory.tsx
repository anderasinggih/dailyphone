import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm, usePage } from '@inertiajs/react';
import { useState } from 'react';
import {
    Receipt,
    Search,
    Ban,
    RotateCcw,
    ShieldAlert,
    ArrowLeft,
    AlertTriangle,
    Coins,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
} from 'lucide-react';

interface StockItem {
    id: number;
    name: string;
    serial_number: string | null;
    imei_1: string | null;
    category?: string;
    brand?: { value: string };
}

interface SaleItem {
    id: number;
    sale_id: number;
    stock_id: number;
    qty: number;
    actual_sell_price: number;
    buy_price_snap: number;
    is_trade_in_item: boolean;
    stock: StockItem;
}

interface SaleExtra {
    id: number;
    sale_id: number;
    extra_id: number;
    charge_to: 'buyer' | 'seller' | 'free_promotion';
    sell_price: number;
    buy_price: number;
    extra: { name: string };
}

interface ReturnLog {
    id: number;
    sale_id: number;
    stock_id: number;
    restocking_fee: number;
    refund_amount: number;
    notes: string | null;
    created_at: string;
}

interface WarrantyRepair {
    id: number;
    sale_id: number;
    stock_id: number;
    damage_description: string;
    repair_cost: number;
    status: 'pending' | 'approved' | 'in_repair' | 'repaired' | 'rejected';
    notes: string | null;
    approved_by: number | null;
    created_at: string;
}

interface Sale {
    id: number;
    invoice_number: string;
    store_id: number;
    user_id: number;
    buyer_id: number;
    shift_id: number;
    payment_method: 'cash' | 'online';
    payment_detail: string | null;
    total_amount: number;
    dp_amount: number;
    status: 'booking' | 'completed' | 'cancelled';
    affiliate_user_id: number | null;
    affiliate_fee: number;
    void_reason: string | null;
    created_at: string;
    buyer?: { name: string; phone: string; address: string | null };
    user?: { name: string };
    items: SaleItem[];
    extras: SaleExtra[];
    returns: ReturnLog[];
    repairs: WarrantyRepair[];
}

interface Store {
    id: number;
    name: string;
}

interface SalesHistoryProps {
    sales: Sale[];
    affiliates: any[];
    stores: Store[];
    filters: {
        store_id: string | null;
    };
}

const PAGE_SIZE = 50;

export default function SalesHistory({ sales, affiliates, stores, filters }: SalesHistoryProps) {
    const authUser = usePage().props.auth.user as any;

    const [searchQuery, setSearchQuery] = useState('');
    const [storeFilterId, setStoreFilterId] = useState(filters.store_id || '');
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

    const [currentPage, setCurrentPage] = useState(1);

    const [isVoidOpen, setIsVoidOpen] = useState(false);
    const [isReturnOpen, setIsReturnOpen] = useState(false);
    const [isWarrantyOpen, setIsWarrantyOpen] = useState(false);
    const [isRepairUpdateOpen, setIsRepairUpdateOpen] = useState(false);
    const [selectedRepair, setSelectedRepair] = useState<WarrantyRepair | null>(null);

    const voidForm = useForm({ void_reason: '' });
    const returnForm = useForm({
        sale_id: '',
        stock_id: '',
        restocking_fee: 0,
        notes: ''
    });
    const warrantyForm = useForm({
        sale_id: '',
        stock_id: '',
        damage_description: ''
    });
    const repairForm = useForm({
        status: 'pending' as any,
        repair_cost: 0,
        notes: ''
    });

    const filteredSales = sales.filter(s => {
        const q = searchQuery.toLowerCase();
        return (
            s.invoice_number.toLowerCase().includes(q) ||
            (s.buyer?.name && s.buyer.name.toLowerCase().includes(q)) ||
            (s.buyer?.phone && s.buyer.phone.includes(searchQuery))
        );
    });

    const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
    const paginatedSales = filteredSales.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

    const handleSelectSale = (sale: Sale) => {
        setSelectedSale(sale);
        setMobileDetailOpen(true);
    };

    const submitVoid = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedSale) return;
        voidForm.post(route('sales.void', selectedSale.id), {
            onSuccess: () => {
                setIsVoidOpen(false);
                voidForm.reset();
                setSelectedSale(null);
                setMobileDetailOpen(false);
            }
        });
    };

    const openReturnModal = (sale: Sale) => {
        setSelectedSale(sale);
        const returnable = sale.items.filter(
            item => !sale.returns.some(r => r.stock_id === item.stock_id)
        );
        returnForm.setData({
            sale_id: sale.id.toString(),
            stock_id: returnable[0]?.stock_id.toString() || '',
            restocking_fee: (returnable[0]?.actual_sell_price || 0) * 0.1,
            notes: ''
        });
        setIsReturnOpen(true);
    };

    const submitReturn = (e: React.FormEvent) => {
        e.preventDefault();
        returnForm.post(route('sales.return'), {
            onSuccess: () => {
                setIsReturnOpen(false);
                setSelectedSale(null);
                setMobileDetailOpen(false);
            }
        });
    };

    const openWarrantyModal = (sale: Sale) => {
        setSelectedSale(sale);
        warrantyForm.setData({
            sale_id: sale.id.toString(),
            stock_id: sale.items[0]?.stock_id.toString() || '',
            damage_description: ''
        });
        setIsWarrantyOpen(true);
    };

    const submitWarranty = (e: React.FormEvent) => {
        e.preventDefault();
        warrantyForm.post(route('sales.warranty'), {
            onSuccess: () => {
                setIsWarrantyOpen(false);
                setSelectedSale(null);
            }
        });
    };

    const openRepairUpdateModal = (repair: WarrantyRepair) => {
        setSelectedRepair(repair);
        repairForm.setData({
            status: repair.status,
            repair_cost: repair.repair_cost,
            notes: repair.notes || ''
        });
        setIsRepairUpdateOpen(true);
    };

    const submitRepairUpdate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRepair) return;
        repairForm.post(route('sales.warranty.update', selectedRepair.id), {
            onSuccess: () => {
                setIsRepairUpdateOpen(false);
                setSelectedSale(null);
            }
        });
    };

    const renderStatusBadge = (sale: Sale) => {
        if (sale.status === 'cancelled') {
            return (
                <span className="text-[11px] font-semibold text-destructive">
                    Cancelled
                </span>
            );
        }
        if (sale.status === 'booking') {
            return (
                <span className="text-[11px] font-semibold text-muted-foreground">
                    Booking
                </span>
            );
        }

        const returnedItemsCount = sale.items.filter(item =>
            sale.returns.some(r => r.stock_id === item.stock_id)
        ).length;

        const hasRepair = sale.repairs.length > 0;

        if (returnedItemsCount > 0) {
            if (returnedItemsCount === sale.items.length) {
                return (
                    <span className="text-[11px] font-semibold text-muted-foreground">
                        Returned
                    </span>
                );
            } else {
                return (
                    <span className="text-[11px] font-semibold text-muted-foreground">
                        Partial Return
                    </span>
                );
            }
        }

        if (hasRepair) {
            const activeRepairs = sale.repairs.filter(r => ['pending', 'approved', 'in_repair'].includes(r.status));
            if (activeRepairs.length > 0) {
                return (
                    <span className="text-[11px] font-semibold text-destructive">
                        Warranty Claim ({activeRepairs.length})
                    </span>
                );
            } else {
                return (
                    <span className="text-[11px] font-semibold text-primary">
                        Warranty Resolved
                    </span>
                );
            }
        }

        return (
            <span className="text-[11px] font-semibold text-primary">
                Completed
            </span>
        );
    };

    const DetailPanel = ({ sale }: { sale: Sale }) => {
        const returnableItems = sale.items.filter(
            item => !sale.returns.some(r => r.stock_id === item.stock_id)
        );
        const isAllReturned = sale.items.length > 0 && returnableItems.length === 0;

        return (
            <div className="space-y-5 text-sm">
                {}
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <p className="font-bold text-foreground text-base leading-tight">{sale.invoice_number}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(sale.created_at).toLocaleString('en-US')}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {renderStatusBadge(sale)}
                        <a
                            href={route('public.invoice', sale.invoice_number)}
                            target="_blank"
                            className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition"
                            title="View Invoice"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </div>
                </div>

                {}
                <div className="bg-muted/50 rounded-xl p-3 space-y-1.5 border border-border/50">
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground font-semibold">Customer</span>
                        <span className="text-foreground font-semibold">{sale.buyer?.name || 'General'}</span>
                    </div>
                    {sale.buyer?.phone && (
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground font-semibold">Phone</span>
                            <span className="text-primary font-bold">{sale.buyer.phone}</span>
                        </div>
                    )}
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground font-semibold">Cashier</span>
                        <span className="text-foreground font-semibold">{sale.user?.name || '—'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground font-semibold">Payment</span>
                        <span className="font-bold text-foreground">{sale.payment_method} {sale.payment_detail ? `(${sale.payment_detail})` : ''}</span>
                    </div>
                    {sale.dp_amount > 0 && (
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground font-semibold">Down Payment</span>
                            <span className="font-bold text-primary">{formatCurrency(sale.dp_amount)}</span>
                        </div>
                    )}
                </div>

                {}
                <div className="space-y-2 border-t border-border/50 pt-3">
                    <p className="text-[10px] font-bold tracking-wider text-muted-foreground">Items Sold</p>
                    {sale.items.map(item => {
                        const isReturned = sale.returns.some(r => r.stock_id === item.stock_id);
                        return (
                            <div key={item.id} className="flex justify-between bg-muted/40 p-2.5 rounded-xl gap-2 border border-border/40">
                                <div className="min-w-0">
                                    <p className="font-semibold text-foreground text-xs leading-snug truncate">
                                        {item.stock?.name}
                                        {item.is_trade_in_item && <span className="ml-1 text-primary text-[10px] font-bold ">(Trade-In)</span>}
                                        {isReturned && <span className="ml-1.5 text-destructive text-[9px] font-bold bg-destructive/10 border border-destructive/20 rounded px-1.5 py-0.5">Returned</span>}
                                    </p>
                                    {item.stock?.category !== 'extra' && item.stock?.serial_number && (
                                        <p className="text-[10px] text-muted-foreground font-mono">SN: {item.stock?.serial_number}</p>
                                    )}
                                </div>
                                <div className="text-right text-xs flex-shrink-0">
                                    <p className="font-bold text-foreground">{formatCurrency(item.actual_sell_price)}</p>
                                    {item.qty > 1 && <p className="text-muted-foreground">x{item.qty}</p>}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {}
                {sale.extras.length > 0 && (
                    <div className="space-y-2 border-t border-border/50 pt-3">
                        <p className="text-[10px] font-bold tracking-wider text-muted-foreground">Add-On / Services</p>
                        {sale.extras.map(ex => (
                            <div key={ex.id} className="flex justify-between text-xs font-semibold bg-muted/40 p-2.5 rounded-xl border border-border/40">
                                <div>
                                    <p className="text-foreground">{ex.extra?.name}</p>
                                    <p className="text-[10px] text-muted-foreground font-normal">{ex.charge_to === 'buyer' ? 'Billed to Customer' : ex.charge_to === 'seller' ? 'Covered by Store' : 'Complimentary Promo'}</p>
                                </div>
                                <p className="text-foreground font-bold">{ex.charge_to === 'buyer' ? formatCurrency(ex.sell_price) : '—'}</p>
                            </div>
                        ))}
                    </div>
                )}

                {}
                <div className="border-t border-border pt-2 flex justify-between items-center">
                    <span className="font-bold text-foreground">Total Paid</span>
                    <span className="font-bold text-primary text-lg">{formatCurrency(sale.total_amount)}</span>
                </div>

                {}
                {sale.returns.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-border">
                        <p className="text-[10px] font-bold tracking-wider text-destructive">Return Records</p>
                        {sale.returns.map(ret => (
                            <div key={ret.id} className="bg-destructive/5 border border-destructive/20 p-2.5 rounded-xl text-xs space-y-1">
                                <div className="flex justify-between font-semibold">
                                    <span>Restocking Fee:</span>
                                    <span className="text-destructive font-bold">{formatCurrency(ret.restocking_fee)}</span>
                                </div>
                                <div className="flex justify-between font-semibold">
                                    <span>Refund:</span>
                                    <span className="text-primary font-bold">{formatCurrency(ret.refund_amount)}</span>
                                </div>
                                {ret.notes && <p className="text-[10px] text-muted-foreground italic">"{ret.notes}"</p>}
                            </div>
                        ))}
                    </div>
                )}

                {}
                <div className="space-y-2 pt-3 border-t border-border">
                    {}
                    {sale.status === 'completed' && authUser.role !== 'viewer' && (
                        <div className="flex gap-2">
                            {!isAllReturned && (
                                <button
                                    onClick={() => openReturnModal(sale)}
                                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-card border border-input py-2.5 text-xs font-semibold text-foreground hover:bg-muted transition shadow-sm"
                                >
                                    <RotateCcw className="h-4 w-4 text-muted-foreground" /> Return
                                </button>
                            )}
                            <button
                                onClick={() => openWarrantyModal(sale)}
                                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm"
                            >
                                <ShieldAlert className="h-4 w-4" /> Warranty Claim
                            </button>
                        </div>
                    )}
                </div>

            {}
            {sale.repairs.length > 0 && (
                <div className="space-y-3 pt-3 border-t border-border">
                    <p className="text-[10px] font-bold tracking-wider text-muted-foreground">Warranty Repair Status</p>
                    {sale.repairs.map(rep => (
                        <div key={rep.id} className="border border-border p-3 rounded-xl space-y-2 bg-muted/20">
                            <div className="flex justify-between text-xs font-semibold">
                                <span className="truncate pr-2">{rep.damage_description}</span>
                                <span className="capitalize text-primary font-bold flex-shrink-0">{rep.status}</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                                <span>Repair Cost:</span>
                                <span className="font-bold text-foreground">{formatCurrency(rep.repair_cost)}</span>
                            </div>
                            <button
                                onClick={() => openRepairUpdateModal(rep)}
                                className="w-full rounded-xl bg-card border border-input py-1.5 text-[10px] font-semibold text-foreground hover:bg-muted transition"
                            >
                                Update Status
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

    const Pagination = () => {
        if (totalPages <= 1) return null;
        return (
            <div className="flex items-center justify-between px-2 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground font-medium">
                    {filteredSales.length} transactions • Page {currentPage}/{totalPages}
                </p>
                <div className="flex gap-1">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1.5 rounded-lg border border-border disabled:opacity-30 hover:bg-muted transition"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1.5 rounded-lg border border-border disabled:opacity-30 hover:bg-muted transition"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <AuthenticatedLayout>
            <Head title="Sales History" />

            <div className="py-6 sm:py-8">
                <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 space-y-6">

                    {}
                    {mobileDetailOpen && selectedSale && (
                        <div className="lg:hidden fixed inset-0 z-40 bg-card overflow-y-auto">
                            <div className="p-4 space-y-4">
                                {}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => { setMobileDetailOpen(false); }}
                                        className="flex items-center gap-1 text-sm font-semibold text-primary hover:opacity-80"
                                    >
                                        <ArrowLeft className="h-4 w-4" /> Back
                                    </button>
                                    <span className="text-muted-foreground">/</span>
                                    <span className="text-sm font-semibold text-foreground truncate">History</span>
                                    <span className="text-muted-foreground">/</span>
                                    <span className="text-sm font-semibold text-muted-foreground truncate">{selectedSale.invoice_number}</span>
                                </div>
                                <DetailPanel sale={selectedSale} />
                            </div>
                        </div>
                    )}

                    {}
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <input
                                type="text"
                                placeholder="Search invoice, customer name, or phone..."
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="w-full rounded-xl border border-input bg-background pl-9 pr-4 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        {authUser.role === 'superadmin' && (
                            <div className="w-full sm:w-48">
                                <select
                                    value={storeFilterId}
                                    onChange={(e) => {
                                        setStoreFilterId(e.target.value);
                                        window.location.href = route('sales-history.index', { store_id: e.target.value });
                                    }}
                                    className="w-full rounded-xl border border-input bg-background py-2 px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="">All Branches</option>
                                    {stores.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {}
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">

                        {}
                        <div className="lg:col-span-2 apple-card p-4 sm:p-5 shadow-sm text-card-foreground space-y-3">
                            <h3 className="text-base font-semibold text-foreground">
                                Transactions
                                <span className="ml-2 text-xs font-semibold text-muted-foreground">({filteredSales.length})</span>
                            </h3>
                            <div className="divide-y divide-border/40">
                                {paginatedSales.length === 0 ? (
                                    <p className="text-center text-sm text-muted-foreground py-8">No transactions found.</p>
                                ) : (
                                    paginatedSales.map((sale) => (
                                        <div
                                            key={sale.id}
                                            onClick={() => handleSelectSale(sale)}
                                            className={`flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 px-3 my-1 cursor-pointer hover:bg-muted/50 rounded-xl transition ${
                                                selectedSale?.id === sale.id ? 'bg-primary/10 ring-1 ring-primary/30' : ''
                                            }`}
                                        >
                                            <div className="space-y-0.5">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-sm text-foreground">{sale.invoice_number}</span>
                                                    {renderStatusBadge(sale)}
                                                </div>
                                                <p className="text-xs text-muted-foreground font-medium">
                                                    {sale.buyer?.name || 'General'} {sale.buyer?.phone ? `(${sale.buyer.phone})` : ''} • {new Date(sale.created_at).toLocaleDateString('en-US')}
                                                </p>
                                            </div>
                                            <div className="mt-1.5 sm:mt-0 text-right">
                                                <p className="text-sm font-bold text-primary">{formatCurrency(sale.total_amount)}</p>
                                                <p className="text-[10px] font-semibold text-muted-foreground">{sale.payment_method}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            <Pagination />
                        </div>

                        {}
                        <div className="hidden lg:block lg:sticky lg:top-4">
                            <div className="apple-card p-5 text-card-foreground max-h-[calc(100vh-6rem)] overflow-y-auto">
                                <h3 className="text-base font-semibold text-foreground mb-4">Invoice Details</h3>
                                {selectedSale ? (
                                    <DetailPanel sale={selectedSale} />
                                ) : (
                                    <p className="text-center text-sm text-muted-foreground py-12">Select a transaction to view details.</p>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {}
            {isReturnOpen && selectedSale && (() => {
                const returnableItems = selectedSale.items.filter(
                    item => !selectedSale.returns.some(r => r.stock_id === item.stock_id)
                );
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                        <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
                            <h4 className="text-lg font-bold text-foreground">Process Return</h4>
                            <p className="text-xs text-muted-foreground mt-1 mb-4">Return item from Invoice {selectedSale.invoice_number}.</p>
                            <form onSubmit={submitReturn} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Returned Item</label>
                                    <select
                                        required
                                        value={returnForm.data.stock_id}
                                        onChange={(e) => {
                                            const stockId = e.target.value;
                                            const matchedItem = returnableItems.find(i => i.stock_id.toString() === stockId);
                                            const price = matchedItem ? matchedItem.actual_sell_price : 0;
                                            returnForm.setData(prev => ({ ...prev, stock_id: stockId, restocking_fee: price * 0.1 }));
                                        }}
                                        className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground"
                                    >
                                        {returnableItems.map(item => (
                                            <option key={item.stock_id} value={item.stock_id}>
                                                {item.stock?.name} - {formatCurrency(item.actual_sell_price)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Restocking Fee (default 10%)</label>
                                    <input
                                        type="number" required
                                        value={returnForm.data.restocking_fee === 0 ? '' : returnForm.data.restocking_fee}
                                        onChange={(e) => returnForm.setData('restocking_fee', parseFloat(e.target.value) || 0)}
                                        className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Reason / Notes</label>
                                    <input
                                        type="text"
                                        value={returnForm.data.notes}
                                        onChange={(e) => returnForm.setData('notes', e.target.value)}
                                        className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground"
                                        placeholder="e.g. Device color exchange, camera defect"
                                    />
                                </div>
                                <div className="flex gap-3 pt-2 border-t border-border">
                                    <button type="button" onClick={() => setIsReturnOpen(false)} className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                                    <button type="submit" disabled={returnForm.processing} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition">Confirm Return</button>
                                </div>
                            </form>
                        </div>
                    </div>
                );
            })()}

            {}
            {isWarrantyOpen && selectedSale && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
                        <h4 className="text-lg font-bold text-foreground">Warranty Claim</h4>
                        <p className="text-xs text-muted-foreground mt-1 mb-4">Invoice {selectedSale.invoice_number}.</p>
                        <form onSubmit={submitWarranty} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Defective Item</label>
                                <select
                                    required value={warrantyForm.data.stock_id}
                                    onChange={(e) => warrantyForm.setData('stock_id', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground"
                                >
                                    {selectedSale.items.map(item => (
                                        <option key={item.stock_id} value={item.stock_id}>
                                            {item.stock?.name} - SN: {item.stock?.serial_number || '-'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Damage Description</label>
                                <textarea
                                    required rows={3}
                                    value={warrantyForm.data.damage_description}
                                    onChange={(e) => warrantyForm.setData('damage_description', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground"
                                    placeholder="e.g. Screen flickering after iOS update"
                                />
                            </div>
                            <div className="flex gap-3 pt-2 border-t border-border">
                                <button type="button" onClick={() => setIsWarrantyOpen(false)} className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                                <button type="submit" disabled={warrantyForm.processing} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition">Submit Claim</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {}
            {isRepairUpdateOpen && selectedRepair && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
                        <h4 className="text-lg font-bold text-foreground">Update Repair Status</h4>
                        <form onSubmit={submitRepairUpdate} className="space-y-4 mt-4">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Status</label>
                                <select value={repairForm.data.status} onChange={(e) => repairForm.setData('status', e.target.value as any)} className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground">
                                    <option value="pending">Pending</option>
                                    <option value="approved">Approved</option>
                                    <option value="in_repair">In Repair</option>
                                    <option value="repaired">Repaired</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Repair Cost</label>
                                <input type="number" value={repairForm.data.repair_cost} onChange={(e) => repairForm.setData('repair_cost', parseFloat(e.target.value) || 0)} className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Notes</label>
                                <input type="text" value={repairForm.data.notes} onChange={(e) => repairForm.setData('notes', e.target.value)} className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground" placeholder="Additional details" />
                            </div>
                            <div className="flex gap-3 pt-2 border-t border-border">
                                <button type="button" onClick={() => setIsRepairUpdateOpen(false)} className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
                                <button type="submit" disabled={repairForm.processing} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition">Save Status</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}

