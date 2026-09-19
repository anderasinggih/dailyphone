import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm, usePage } from '@inertiajs/react';
import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import {
    Search,
    Smartphone,
    Layers,
    Plus,
    ArrowLeftRight,
    Check,
    Info,
    User,
    Phone,
    MapPin,
    DollarSign,
    CheckCircle,
    ArrowUpRight,
    Wrench,
    Tag,
    Share2,
    QrCode,
    MessageCircle,
    Send,
    ExternalLink,
    Filter,
    Sparkles,
    RefreshCw,
    ShieldCheck,
    AlertTriangle
} from 'lucide-react';

interface ParameterValue {
    id: number;
    value: string;
}

interface Parameter {
    id: number;
    name: string;
    category: string;
    values: ParameterValue[];
}

interface StockItem {
    id: number;
    store_id: number;
    category: 'iphone' | 'android' | 'accessories' | 'extra';
    type: 'new' | 'second';
    name: string;
    brand_id: number | null;
    color_id: number | null;
    memory_id: number | null;
    license_id: number | null;
    serial_number: string | null;
    imei_1: string | null;
    supplier: string | null;
    warranty_duration_days: number;
    buy_price: number;
    sell_price: number;
    sell_price_reseller: number | null;
    qty: number;
    status: 'available' | 'transit' | 'sold';
    created_by?: string | null;
    default_charge_to?: 'buyer' | 'seller' | 'free_promotion';
    brand?: { value: string };
    color?: { value: string };
    memory?: { value: string };
    license?: { value: string };
}

interface Buyer {
    id: number;
    name: string;
    phone: string;
    address: string | null;
}

interface Store {
    id: number;
    name: string;
    location?: string;
    address?: string;
}

interface Transfer {
    id: number;
    stock_id: number;
    from_store_id: number;
    to_store_id: number;
    requested_by: number;
    approved_by: number | null;
    status: 'transit' | 'approved' | 'rejected';
    created_at: string;
    stock: StockItem;
    from_store?: Store;
    to_store?: Store;
    requester?: { name: string };
}

interface UserOption {
    id: number;
    name: string;
    role: string;
}

interface ReadyStockProps {
    stocks: StockItem[];
    stores: Store[];
    transfers: Transfer[];
    storesFilter: Store[];
    parameters: Parameter[];
    users?: UserOption[];
    buyers?: Buyer[];
    filters: {
        store_id: string | null;
    };
}

const normalizePhone = (raw: string): string => {
    let phone = raw.replace(/[^\d+]/g, '');
    if (phone.startsWith('+62')) phone = '0' + phone.slice(3);
    else if (phone.startsWith('62') && phone.length > 10) phone = '0' + phone.slice(2);
    return phone;
};

const toWANumber = (phone: string): string => {
    const clean = normalizePhone(phone);
    if (clean.startsWith('0')) return '62' + clean.slice(1);
    return clean;
};

export default function ReadyStock({ stocks, stores, transfers, storesFilter, parameters, users = [], buyers = [], filters }: ReadyStockProps) {
    const authUser = usePage().props.auth.user as any;

    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'all' | 'iphone' | 'android' | 'accessories' | 'extra'>('all');
    const [storeFilterId, setStoreFilterId] = useState(filters.store_id || '');
    const [showFilters, setShowFilters] = useState(false);

    const [selectedStockDetail, setSelectedStockDetail] = useState<StockItem | null>(null);
    const [selectedStock, setSelectedStock] = useState<StockItem | null>(null);
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
    const [isTransferOpen, setIsTransferOpen] = useState(false);
    const [showBuyerSearchModal, setShowBuyerSearchModal] = useState(false);
    const [buyerSearchQuery, setBuyerSearchQuery] = useState('');

    const [successData, setSuccessData] = useState<{ invoiceNumber: string; buyerPhone: string; buyerName: string; total: number } | null>(null);

    const [aiSummary, setAiSummary] = useState<{
        checks: Array<{ type: 'ok' | 'warn' | 'info'; label: string; detail: string }>;
        upsell: string | null;
        ai_enabled: boolean;
    } | null>(null);
    const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

    const imeiInputRef = useRef<HTMLInputElement>(null);

    const brandOptions = parameters.find(p => ['brand', 'merek'].includes(p.name.toLowerCase()))?.values || [];
    const colorOptions = parameters.find(p => ['color', 'warna'].includes(p.name.toLowerCase()))?.values || [];
    const memoryOptions = parameters.find(p => ['storage capacity', 'capacity', 'kapasitas memori', 'memori'].includes(p.name.toLowerCase()))?.values || [];
    const licenseOptions = parameters.find(p => ['license type', 'tipe lisensi', 'lisensi'].includes(p.name.toLowerCase()))?.values || [];

    const extraAddons = stocks.filter(s => s.category === 'extra' && s.status === 'available');

    const filteredBuyers = buyers.filter(b =>
        b.name.toLowerCase().includes(buyerSearchQuery.toLowerCase()) ||
        b.phone.includes(buyerSearchQuery)
    );

    const getLocalDateTimeString = () => {
        const tzoffset = (new Date()).getTimezoneOffset() * 60000;
        return (new Date(Date.now() - tzoffset)).toISOString().slice(0, 16);
    };

    const checkoutForm = useForm({
        store_id: '' as string | number,
        buyer_name: '',
        buyer_phone: '',
        buyer_address: '',
        payment_method: 'cash' as 'cash' | 'online',
        payment_detail: '',
        dp_amount: '' as string | number,
        status: 'completed' as 'booking' | 'completed',
        affiliate_user_id: '' as string | number,
        affiliate_fee: '' as string | number,
        transaction_date: getLocalDateTimeString(),
        items: [] as Array<{ stock_id: number; qty: number; actual_sell_price: string | number }>,
        trade_in: null as null | {
            name: string;
            brand_id: number | string;
            color_id: number | string;
            memory_id: number | string;
            license_id: number | string;
            serial_number: string;
            imei_1: string;
            buy_price: string | number;
        },
        extras: [] as Array<{ extra_id: number; charge_to: 'buyer' | 'seller' | 'free_promotion'; sell_price: number; buy_price: number }>
    });

    const transferForm = useForm({
        stock_id: '',
        to_store_id: ''
    });

    const filteredStocks = stocks.filter((item) => {
        const matchesCategory = activeTab === 'all'
            ? true
            : item.category === activeTab;
        const matchesSearch =
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.serial_number && item.serial_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (item.imei_1 && item.imei_1.includes(searchQuery)) ||
            (item.color?.value && item.color.value.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (item.brand?.value && item.brand.value.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesCategory && matchesSearch;
    });

    const openCheckout = (stock: StockItem) => {
        setSelectedStock(stock);

        const availableExtras = stocks
            .filter(s => s.category === 'extra' && s.status === 'available')
            .map(addon => ({
                extra_id: addon.id,
                charge_to: (addon.default_charge_to || 'buyer') as 'buyer' | 'seller' | 'free_promotion',
                sell_price: addon.sell_price,
                buy_price: addon.buy_price,
            }));
        checkoutForm.setData({
            store_id: stock.store_id || '',
            buyer_name: '',
            buyer_phone: '',
            buyer_address: '',
            payment_method: 'cash',
            payment_detail: '',
            dp_amount: '',
            status: 'completed',
            affiliate_user_id: '',
            affiliate_fee: '',
            transaction_date: getLocalDateTimeString(),
            items: [{ stock_id: stock.id, qty: 1, actual_sell_price: stock.sell_price }],
            trade_in: null,
            extras: availableExtras,
        });
        setIsCheckoutOpen(true);
    };

    const fetchCheckoutSummary = async () => {
        if (!selectedStock) return;

        const price = Number(checkoutForm.data.items[0]?.actual_sell_price) || 0;
        setAiSummaryLoading(true);
        try {
            const res = await axios.post(route('assistant.checkout-summary'), {
                stock_id: selectedStock.id,
                price,
                buyer_phone: checkoutForm.data.buyer_phone,
            });
            setAiSummary(res.data);
        } catch {
            setAiSummary(null);
        } finally {
            setAiSummaryLoading(false);
        }
    };

    useEffect(() => {
        if (!isCheckoutOpen || !selectedStock) {
            setAiSummary(null);
            return;
        }
        setAiSummary(null);
        const t = setTimeout(fetchCheckoutSummary, 500);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isCheckoutOpen, selectedStock?.id, checkoutForm.data.buyer_phone]);

    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();

        const handleKeyDown = (e: KeyboardEvent) => {

            if (isCheckoutOpen) return;

            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

            if (isInput && target.id !== 'search-ready-stock-input') {
                return;
            }

            const currentTime = Date.now();

            if (currentTime - lastKeyTime > 80) {
                buffer = '';
            }

            lastKeyTime = currentTime;

            if (e.key === 'Enter') {
                if (buffer.length > 3) {
                    const cleanCode = buffer.trim();
                    const found = stocks.find(item =>
                        (item.serial_number && item.serial_number.toLowerCase() === cleanCode.toLowerCase()) ||
                        (item.imei_1 && item.imei_1 === cleanCode)
                    );
                    if (found) {
                        e.preventDefault();
                        openCheckout(found);
                    }
                    buffer = '';
                }
            } else if (e.key.length === 1) {
                buffer += e.key;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [stocks, isCheckoutOpen]);

    const openTransfer = (stock: StockItem) => {
        setSelectedStock(stock);
        transferForm.setData({
            stock_id: stock.id.toString(),
            to_store_id: ''
        });
        setIsTransferOpen(true);
    };

    const submitTransfer = (e: React.FormEvent) => {
        e.preventDefault();
        transferForm.post(route('stocks.transfer'), {
            onSuccess: () => {
                setIsTransferOpen(false);
                setSelectedStock(null);
            }
        });
    };

    const submitCheckout = (e: React.FormEvent) => {
        e.preventDefault();

        const buyerName = checkoutForm.data.buyer_name;
        const buyerPhone = checkoutForm.data.buyer_phone;
        const total = calculateTotal();

        checkoutForm.post(route('sales.checkout'), {
            onSuccess: (page) => {
                setIsCheckoutOpen(false);
                setSelectedStock(null);

                const flash = (page.props as any).flash;
                const invoiceNumber = flash?.invoice_number || '';
                setSuccessData({ invoiceNumber, buyerPhone, buyerName, total });
            },
            onError: () => {

            }
        });
    };

    const toggleTradeIn = () => {
        if (checkoutForm.data.trade_in) {
            checkoutForm.setData('trade_in', null);
        } else {
            checkoutForm.setData('trade_in', {
                name: '',
                brand_id: brandOptions[0]?.id || '',
                color_id: colorOptions[0]?.id || '',
                memory_id: memoryOptions[0]?.id || '',
                license_id: licenseOptions[0]?.id || '',
                serial_number: '',
                imei_1: '',
                buy_price: ''
            });
        }
    };

    const toggleAddon = (addon: StockItem) => {
        const exists = checkoutForm.data.extras.find(e => e.extra_id === addon.id);
        if (exists) {
            checkoutForm.setData('extras', checkoutForm.data.extras.filter(e => e.extra_id !== addon.id));
        } else {

            const defaultCharge = addon.default_charge_to || 'buyer';
            checkoutForm.setData('extras', [
                ...checkoutForm.data.extras,
                { extra_id: addon.id, charge_to: defaultCharge, sell_price: addon.sell_price, buy_price: addon.buy_price }
            ]);
        }
    };

    const updateAddonCharge = (addonId: number, chargeTo: 'buyer' | 'seller' | 'free_promotion') => {
        checkoutForm.setData('extras', checkoutForm.data.extras.map(e => {
            if (e.extra_id === addonId) {
                return { ...e, charge_to: chargeTo };
            }
            return e;
        }));
    };

    const calculateTotal = () => {
        if (!selectedStock) return 0;
        const rawPrice = checkoutForm.data.items[0]?.actual_sell_price;
        const mainItemPrice = Number(rawPrice) || 0;

        let addonsCost = 0;
        checkoutForm.data.extras.forEach(e => {
            if (e.charge_to === 'buyer') {
                addonsCost += Number(e.sell_price) || 0;
            }
        });

        const rawTradeIn = checkoutForm.data.trade_in?.buy_price;
        const tradeInDeduction = Number(rawTradeIn) || 0;

        return Math.max(0, mainItemPrice + addonsCost - tradeInDeduction);
    };

    const formatCurrency = (val: number) => {
        const cleanVal = isNaN(val) ? 0 : val;
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(cleanVal);
    };

    const formatNumberInput = (val: string | number) => {
        if (val === undefined || val === null || val === '') return '';

        const digits = val.toString().replace(/[^0-9]/g, '');
        if (!digits) return '';
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(Number(digits));
    };

    const parseFormattedNumber = (val: string): string => {
        return val.replace(/[^0-9]/g, '');
    };

    const renderBadges = (item: StockItem) => {
        return (
            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-muted-foreground font-medium">
                {item.category !== 'accessories' && item.category !== 'extra' && (
                    <span className={item.type === 'new' ? 'text-primary font-semibold' : 'text-muted-foreground'}>
                        {item.type === 'new' ? 'New' : 'Used'}
                    </span>
                )}
                {item.memory?.value && (
                    <>
                        <span>•</span>
                        <span>{item.memory.value}</span>
                    </>
                )}
                {item.license?.value && (
                    <>
                        <span>•</span>
                        <span className="text-primary font-semibold">{item.license.value}</span>
                    </>
                )}
            </div>
        );
    };

    const selectBuyer = (buyer: Buyer) => {
        checkoutForm.setData({
            ...checkoutForm.data,
            buyer_name: buyer.name,
            buyer_phone: buyer.phone,
            buyer_address: buyer.address || '',
        });
    };

    const openWAChat = (phone: string, buyerName: string) => {
        const waNum = toWANumber(phone);
        const msg = encodeURIComponent(`Hello ${buyerName}, thank you for shopping at Daily Phone! How can we assist you today?`);
        window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
    };

    const openWAInvoice = (phone: string, buyerName: string, invoiceNumber: string, total: number) => {
        const waNum = toWANumber(phone);
        const invoiceUrl = `${window.location.origin}/invoice/${invoiceNumber}`;
        const storeName = selectedStock
            ? stores.find(s => s.id === selectedStock.store_id)?.name || 'Daily Phone'
            : 'Daily Phone';
        const lines = [
            `Hello ${buyerName},`,
            ``,
            `Thank you for shopping at *${storeName}*!`,
            `Here are your transaction details:`,
            ``,
            `*Invoice No. :* ${invoiceNumber}`,
            `*Total Payment :* ${formatCurrency(total)}`,
            ``,
            `Please view your complete receipt at the following link:`,
            invoiceUrl,
            ``,
            `Keep this receipt as your official product warranty proof.`,
            ``,
            `Best regards,`,
            `*${storeName} Team*`,
        ];
        const msg = encodeURIComponent(lines.join('\n'));
        window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
    };

    return (
        <AuthenticatedLayout>
            <Head title="Selling" />

            <div className="py-8">
                <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 space-y-8">

                    {}
                    <div className="flex items-stretch gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-gray-400" />
                            <input
                                id="search-ready-stock-input"
                                type="text"
                                placeholder="Search product name, serial number, IMEI..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && searchQuery.trim().length > 3) {
                                        const cleanQuery = searchQuery.trim().toLowerCase();
                                        const found = stocks.find(item =>
                                            (item.serial_number && item.serial_number.toLowerCase() === cleanQuery) ||
                                            (item.imei_1 && item.imei_1 === cleanQuery)
                                        );
                                        if (found) {
                                            e.preventDefault();
                                            openCheckout(found);
                                        }
                                    }
                                }}
                                className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-2.5 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowFilters(!showFilters)}
                            className={`flex items-center justify-center px-3 rounded-xl border transition shrink-0 ${
                                showFilters
                                    ? 'bg-primary/10 text-primary border-primary/20'
                                    : 'bg-card hover:bg-muted border-input text-foreground'
                            }`}
                        >
                            <Filter className="h-4 w-4" />
                        </button>
                    </div>

                    {}
                    {showFilters && (
                        <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-2xl border border-border shadow-sm transition-all duration-300">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full">
                                <div className="flex-1 min-w-[200px]">
                                    <label className="block text-[10px] font-bold text-muted-foreground mb-1">Category</label>
                                    <select
                                        value={activeTab}
                                        onChange={(e) => setActiveTab(e.target.value as any)}
                                        className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm focus:border-primary focus:outline-none"
                                    >
                                        <option value="all">All Inventory</option>
                                        <option value="iphone">iPhone</option>
                                        <option value="android">Android</option>
                                        <option value="accessories">Accessories</option>
                                        <option value="extra">Add-On / Services</option>
                                    </select>
                                </div>

                                {authUser.role === 'superadmin' && (
                                    <div className="flex-1 min-w-[200px]">
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Branch</label>
                                        <select
                                            value={storeFilterId}
                                            onChange={(e) => {
                                                setStoreFilterId(e.target.value);
                                                window.location.href = route('selling.index', { store_id: e.target.value });
                                            }}
                                            className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm focus:border-primary focus:outline-none"
                                        >
                                            <option value="">All Branches</option>
                                            {storesFilter.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {}
                    <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                        {}
                        <div className={`rounded-none sm:rounded-2xl border-x-0 sm:border border-y sm:border-y-0 border-border/60 bg-transparent sm:bg-card shadow-none sm:shadow-sm text-card-foreground -mx-4 sm:mx-0 transition-all duration-300 ${
                            selectedStockDetail ? 'hidden lg:block lg:col-span-2' : 'col-span-1 lg:col-span-3'
                        }`}>
                            <div className="p-0 sm:p-6">
                                {}
                                <div className="md:hidden space-y-3 px-4 py-2">
                                    {filteredStocks.length === 0 ? (
                                        <div className="py-8 text-center text-gray-400">
                                            Stok unit tidak ditemukan.
                                        </div>
                                    ) : (
                                        filteredStocks.map((item) => {
                                            const isSelected = selectedStockDetail?.id === item.id;
                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() => setSelectedStockDetail(item)}
                                                    className={`p-4 rounded-xl border border-border bg-card/45 hover:bg-muted/30 transition cursor-pointer space-y-2 ${
                                                        isSelected ? 'ring-2 ring-primary bg-primary/5' : ''
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-start gap-3">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="font-semibold text-foreground truncate block text-sm" title={item.name}>
                                                                {item.name} {item.color?.value ? `(${item.color.value})` : ''}
                                                            </p>
                                                            {renderBadges(item)}
                                                            <p className="text-[10px] font-bold text-muted-foreground tracking-wider mt-0.5 truncate">
                                                                {item.category !== 'accessories' && item.category !== 'extra'
                                                                    ? `${item.serial_number || item.imei_1 || '-'} (${item.license?.value || item.supplier || 'N/A'})`
                                                                    : `${item.category} • ${item.brand?.value || '-'}`
                                                                }
                                                            </p>
                                                        </div>
                                                        <div className="text-right flex-shrink-0">
                                                            <p className="text-sm font-bold text-primary">
                                                                {formatCurrency(item.sell_price)}
                                                            </p>
                                                            <p className="text-[11px] font-medium text-muted-foreground mt-0.5">
                                                                Stock: {item.qty} pcs
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                {}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full min-w-0 text-left border-collapse text-sm">
                                        <thead>
                                            <tr className="border-b border-border text-xs font-semibold tracking-wider text-muted-foreground">
                                                <th className="pb-3 px-4 font-semibold text-left">Unit</th>
                                                <th className="pb-3 px-4 font-semibold text-left">Price</th>
                                                <th className="pb-3 px-4 font-semibold text-center">Stock</th>
                                                {authUser.role !== 'viewer' && <th className="pb-3 px-4 font-semibold text-right">Action</th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/40 text-sm font-medium text-foreground">
                                            {filteredStocks.length === 0 ? (
                                                <tr>
                                                    <td colSpan={4} className="py-8 text-center text-muted-foreground px-4">
                                                        No inventory items found.
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredStocks.map((item) => {
                                                    const isSelected = selectedStockDetail?.id === item.id;
                                                    return (
                                                        <tr
                                                            key={item.id}
                                                            onClick={() => setSelectedStockDetail(item)}
                                                            className={`cursor-pointer transition duration-150 hover:bg-muted/50 ${
                                                                isSelected ? 'bg-primary/5 hover:bg-primary/10' : ''
                                                            }`}
                                                        >
                                                            <td className="py-2.5 px-4 text-left">
                                                                <p className="font-semibold text-foreground truncate block max-w-xs" title={item.name}>
                                                                    {item.name} {item.color?.value ? `(${item.color.value})` : ''}
                                                                </p>
                                                                {renderBadges(item)}
                                                                <p className="text-[10px] font-medium text-muted-foreground tracking-wider mt-0.5 truncate max-w-xs">
                                                                    {item.category !== 'accessories' && item.category !== 'extra'
                                                                        ? `${item.serial_number || item.imei_1 || '-'} (${item.license?.value || item.supplier || 'N/A'})`
                                                                        : `${item.category} • ${item.brand?.value || '-'}`
                                                                    }
                                                                </p>
                                                            </td>
                                                            <td className="py-2.5 px-4 font-bold text-foreground whitespace-nowrap text-left">
                                                                {formatCurrency(item.sell_price)}
                                                            </td>
                                                            <td className="py-2.5 px-4 text-center font-semibold whitespace-nowrap">
                                                                {item.qty} pcs
                                                            </td>
                                                            {authUser.role !== 'viewer' && (
                                                                <td className="py-2.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        <button
                                                                            onClick={() => openCheckout(item)}
                                                                            className="rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition whitespace-nowrap"
                                                                        >
                                                                            Sell
                                                                        </button>
                                                                        {authUser.role === 'superadmin' && (
                                                                            <button
                                                                                onClick={() => openTransfer(item)}
                                                                                className="rounded-xl border border-input px-3.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition whitespace-nowrap"
                                                                            >
                                                                                Transfer
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            )}
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        {}
                        {selectedStockDetail && (
                            <div className="w-full lg:col-span-1 apple-card p-6 shadow-sm text-card-foreground space-y-6 self-start lg:sticky lg:top-4 transition-all duration-300">
                                {}
                                <div className="flex items-center justify-between border-b border-border pb-3">
                                    <nav className="flex items-center text-[10px] font-semibold tracking-wider text-muted-foreground overflow-hidden" aria-label="Breadcrumb">
                                        <span className="hover:text-foreground cursor-pointer whitespace-nowrap" onClick={() => setSelectedStockDetail(null)}>Selling</span>
                                        <span className="mx-1.5 flex-shrink-0">/</span>
                                        <span className="hover:text-foreground cursor-pointer whitespace-nowrap" onClick={() => setSelectedStockDetail(null)}>Detail</span>
                                        <span className="mx-1.5 flex-shrink-0">/</span>
                                        <span className="text-primary truncate max-w-[120px]" title={selectedStockDetail.name}>
                                            {selectedStockDetail.name} {selectedStockDetail.color?.value ? `${selectedStockDetail.color.value}` : ''} {selectedStockDetail.memory?.value ? `/ ${selectedStockDetail.memory.value}` : ''}
                                        </span>
                                    </nav>
                                    <button
                                        onClick={() => setSelectedStockDetail(null)}
                                        className="text-muted-foreground hover:text-foreground p-1.5 hover:bg-muted rounded-lg text-lg transition-colors font-bold"
                                    >
                                        ✕
                                    </button>
                                </div>

                                {}
                                <div>
                                    <h4 className="text-sm font-bold text-foreground">
                                        {selectedStockDetail.name} {selectedStockDetail.color?.value ? `${selectedStockDetail.color.value}` : ''} {selectedStockDetail.memory?.value ? `/ ${selectedStockDetail.memory.value}` : ''}
                                    </h4>
                                    <div className="flex gap-2 mt-2">
                                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                            {selectedStockDetail.type}
                                        </span>
                                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                            Available
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-4 text-xs font-medium text-foreground">
                                    <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                        <span className="text-muted-foreground text-[10px]">Category</span>
                                        <span className="text-right capitalize text-foreground">{selectedStockDetail.category === 'extra' ? 'Add-On / Service' : selectedStockDetail.category}</span>
                                    </div>
                                    {selectedStockDetail.category !== 'extra' && (
                                        <>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">Brand</span>
                                                <span className="text-right text-foreground">{selectedStockDetail.brand?.value || '-'}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">Color</span>
                                                <span className="text-right text-foreground">{selectedStockDetail.color?.value || '-'}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">Storage</span>
                                                <span className="text-right text-foreground">{selectedStockDetail.memory?.value || '-'}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">Network / License</span>
                                                <span className="text-right text-foreground">{selectedStockDetail.license?.value || '-'}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">Serial Number</span>
                                                <span className="text-right font-mono text-foreground">{selectedStockDetail.serial_number || '-'}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">IMEI</span>
                                                <span className="text-right font-mono text-foreground">{selectedStockDetail.imei_1 || '-'}</span>
                                            </div>
                                        </>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                        <span className="text-muted-foreground text-[10px]">Selling Price</span>
                                        <span className="text-right font-bold text-primary">
                                            {formatCurrency(selectedStockDetail.sell_price)}
                                        </span>
                                    </div>
                                    {['superadmin', 'viewer'].includes(authUser.role) && (
                                        <>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">Cost Price (COGS)</span>
                                                <span className="text-right font-semibold text-foreground">
                                                    {formatCurrency(selectedStockDetail.buy_price)}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                                <span className="text-muted-foreground text-[10px]">Expected Margin</span>
                                                <span className="text-right font-bold text-primary">
                                                    {formatCurrency((selectedStockDetail.sell_price - selectedStockDetail.buy_price) * selectedStockDetail.qty)}
                                                </span>
                                            </div>
                                        </>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                        <span className="text-muted-foreground text-[10px]">Warranty</span>
                                        <span className="text-right text-foreground">{selectedStockDetail.warranty_duration_days} Days</span>
                                    </div>
                                    {authUser.role === 'superadmin' && (
                                        <div className="grid grid-cols-2 gap-2 border-b border-border/50 pb-2">
                                            <span className="text-muted-foreground text-[10px]">Supplier</span>
                                            <span className="text-right text-foreground">{selectedStockDetail.supplier || '-'}</span>
                                        </div>
                                    )}
                                </div>

                                {authUser.role !== 'viewer' && (
                                    <div className="flex gap-3 pt-4 border-t border-border">
                                        <button
                                            onClick={() => openCheckout(selectedStockDetail)}
                                            className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm"
                                        >
                                            Process Sale
                                        </button>
                                        {authUser.role === 'superadmin' && (
                                            <button
                                                onClick={() => openTransfer(selectedStockDetail)}
                                                className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-foreground hover:bg-muted transition shadow-sm"
                                            >
                                                Transfer
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {}
            {isTransferOpen && selectedStock && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
                        <h4 className="text-lg font-semibold text-foreground">Propose Stock Transfer</h4>
                        <p className="text-xs text-muted-foreground mt-1 mb-4">Transfer unit <span className="font-bold text-foreground">{selectedStock.name}</span> to another branch.</p>

                        <form onSubmit={submitTransfer} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold tracking-wider text-muted-foreground mb-1">Destination Branch</label>
                                <select
                                    required
                                    value={transferForm.data.to_store_id}
                                    onChange={(e) => transferForm.setData('to_store_id', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
                                >
                                    <option value="">-- Select Branch --</option>
                                    {stores.map(store => (
                                        <option key={store.id} value={store.id}>{store.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-border">
                                <button type="button" onClick={() => setIsTransferOpen(false)} className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">
                                    Cancel
                                </button>
                                <button type="submit" disabled={transferForm.processing} className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition">
                                    {transferForm.processing ? 'Submitting...' : 'Submit Transfer'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {}
            {isCheckoutOpen && selectedStock && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
                    <div className="w-full max-w-2xl rounded-lg bg-card p-6 shadow-sm dark:bg-background border dark:border-input my-8">
                        <div className="flex justify-between items-center pb-4 border-b border-border dark:border-input">
                            <div>
                                <h4 className="text-xl font-semibold text-foreground">Cashier Checkout Form</h4>
                                <p className="text-xs text-gray-400">Unit: {selectedStock.name} {selectedStock.color?.value ? `${selectedStock.color.value}` : ''} {selectedStock.memory?.value ? `/ ${selectedStock.memory.value}` : ''} ({selectedStock.serial_number || selectedStock.imei_1 || '-'})</p>
                            </div>
                            <button onClick={() => setIsCheckoutOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 hover:bg-muted rounded-lg text-lg transition-colors">✕</button>
                        </div>

                        {}
                        {Object.keys(checkoutForm.errors).length > 0 && (
                            <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 p-3 text-xs font-bold text-rose-600 dark:text-rose-400 space-y-1">
                                {Object.entries(checkoutForm.errors).map(([key, err]) => (
                                    <div key={key}>• {err}</div>
                                ))}
                            </div>
                        )}

                        <form onSubmit={submitCheckout} className="space-y-6 pt-4 max-h-[70vh] overflow-y-auto pr-2">
                            {}
                            {authUser.role === 'superadmin' && (
                                <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-2">
                                    <label className="block text-xs font-bold text-primary mb-1">
                                        Sales Branch (Superadmin Only)
                                    </label>
                                    <select
                                        required
                                        value={checkoutForm.data.store_id}
                                        onChange={e => checkoutForm.setData('store_id', e.target.value)}
                                        className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-medium text-foreground"
                                    >
                                        <option value="">-- Select Branch --</option>
                                        {storesFilter.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {}
                            <div className="space-y-4">
                                <h5 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                                    <User className="h-4 w-4" /> Customer Information
                                </h5>

                                {}
                                {buyers.length > 0 && (
                                    <div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setBuyerSearchQuery('');
                                                setShowBuyerSearchModal(true);
                                            }}
                                            className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 py-2.5 text-xs font-semibold text-primary flex items-center justify-center gap-1.5 transition"
                                        >
                                            <Search className="h-3.5 w-3.5" /> Select Registered Customer
                                        </button>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Full Name</label>
                                        <input
                                            type="text"
                                            required
                                            value={checkoutForm.data.buyer_name}
                                            onChange={e => checkoutForm.setData('buyer_name', e.target.value)}
                                            className={`w-full rounded-xl border px-3.5 py-2 text-sm font-medium bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary ${checkoutForm.errors.buyer_name ? 'border-destructive' : 'border-input'}`}
                                            placeholder="e.g. John Doe"
                                        />
                                        {checkoutForm.errors.buyer_name && <p className="mt-1 text-xs text-destructive">{checkoutForm.errors.buyer_name}</p>}
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Phone Number (WhatsApp)</label>
                                        <input
                                            type="text"
                                            required
                                            value={checkoutForm.data.buyer_phone}
                                            onChange={e => checkoutForm.setData('buyer_phone', normalizePhone(e.target.value))}
                                            className={`w-full rounded-xl border px-3.5 py-2 text-sm font-medium bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary ${checkoutForm.errors.buyer_phone ? 'border-destructive' : 'border-input'}`}
                                            placeholder="08xxxxxxxxxx"
                                        />
                                        {checkoutForm.errors.buyer_phone && <p className="mt-1 text-xs text-destructive">{checkoutForm.errors.buyer_phone}</p>}
                                        <p className="text-[10px] text-muted-foreground mt-0.5">Format: 08xxx / +62xxx / 62xxx → auto-convert</p>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Address (Optional)</label>
                                        <input
                                            type="text"
                                            value={checkoutForm.data.buyer_address}
                                            onChange={e => checkoutForm.setData('buyer_address', e.target.value)}
                                            className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                            placeholder="Complete street address"
                                        />
                                    </div>
                                </div>
                            </div>

                            {}
                            <div className="space-y-4 pt-4 border-t border-border">
                                <h5 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                                    <Tag className="h-4 w-4" /> Pricing & Payment Method
                                </h5>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Agreed Price (Final)</label>
                                        <input
                                            type="number"
                                            required
                                            min={0}
                                            value={checkoutForm.data.items[0]?.actual_sell_price ?? ''}
                                            onChange={e => {
                                                const val = e.target.value;
                                                const items = [...checkoutForm.data.items];
                                                items[0].actual_sell_price = val === '' ? '' : Number(val);
                                                checkoutForm.setData('items', items);
                                            }}
                                            onWheel={e => e.currentTarget.blur()}
                                            className={`w-full rounded-xl border px-3.5 py-2 text-sm font-medium bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${checkoutForm.errors['items.0.actual_sell_price'] ? 'border-destructive' : 'border-input'}`}
                                            placeholder="Enter agreed price"
                                        />
                                        <p className="text-[10px] text-muted-foreground mt-1 font-medium">Default retail: {formatCurrency(selectedStock.sell_price)}</p>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Payment Method</label>
                                        <select
                                            value={checkoutForm.data.payment_method}
                                            onChange={e => checkoutForm.setData('payment_method', e.target.value as any)}
                                            className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                        >
                                            <option value="cash">CASH / TUNAI</option>
                                            <option value="online">ONLINE (Transfer/QRIS)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Transaction Date</label>
                                        <input
                                            type="datetime-local"
                                            value={checkoutForm.data.transaction_date}
                                            onChange={e => checkoutForm.setData('transaction_date', e.target.value)}
                                            className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-muted-foreground mb-1">Payment Details</label>
                                        <input
                                            type="text"
                                            value={checkoutForm.data.payment_detail}
                                            onChange={e => checkoutForm.setData('payment_detail', e.target.value)}
                                            className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                            placeholder="e.g. BCA, Mandiri, QRIS"
                                        />
                                    </div>
                                </div>
                            </div>

                            {}
                            <div className="space-y-4 pt-4 border-t border-border">
                                <h5 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                                    <Wrench className="h-4 w-4" /> Add-On Services
                                </h5>
                                {extraAddons.length === 0 ? (
                                    <p className="text-xs text-muted-foreground font-medium">No active add-on services available.</p>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-[10px] text-muted-foreground font-normal">Select add-on items to bundle with this invoice.</p>
                                        {extraAddons.map(addon => {
                                            const selectedExtra = checkoutForm.data.extras.find(e => e.extra_id === addon.id);
                                            const chargeLabel = selectedExtra?.charge_to === 'seller'
                                                ? { text: 'Store Covered', cls: 'bg-muted text-muted-foreground border-border' }
                                                : selectedExtra?.charge_to === 'free_promotion'
                                                    ? { text: 'Promo Free', cls: 'bg-primary/10 text-primary border-primary/20' }
                                                    : { text: 'Customer Billed', cls: 'bg-primary/10 text-primary border-primary/20' };
                                            return (
                                                <label key={addon.id} className={`flex items-center justify-between gap-3 border p-3 rounded-xl cursor-pointer transition ${selectedExtra ? 'border-primary/40 bg-primary/5' : 'border-border opacity-60'}`}>
                                                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!selectedExtra}
                                                            onChange={() => toggleAddon(addon)}
                                                            className="rounded border-border text-primary focus:ring-primary"
                                                        />
                                                        <span>{addon.name}</span>
                                                        <span className="text-muted-foreground font-normal">({formatCurrency(addon.sell_price)})</span>
                                                    </div>
                                                    {selectedExtra && (
                                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${chargeLabel.cls}`}>
                                                            {chargeLabel.text}
                                                        </span>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {}
                            <div className="space-y-4 pt-4 border-t border-border">
                                <div className="flex items-center justify-between">
                                    <h5 className="text-sm font-semibold text-primary flex items-center gap-1.5">
                                        <ArrowLeftRight className="h-4 w-4" /> Trade-In
                                    </h5>
                                    <button
                                        type="button"
                                        onClick={toggleTradeIn}
                                        className="rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition"
                                    >
                                        {checkoutForm.data.trade_in ? 'Cancel Trade-In' : 'Enable Trade-In'}
                                    </button>
                                </div>

                                {checkoutForm.data.trade_in && (
                                    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Customer Device Name</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={checkoutForm.data.trade_in.name}
                                                    onChange={e => {
                                                        const ti = checkoutForm.data.trade_in!;
                                                        checkoutForm.setData('trade_in', { ...ti, name: e.target.value });
                                                    }}
                                                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium text-foreground"
                                                    placeholder="e.g. iPhone 11 64GB Black"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Trade-in Appraisal Value (IDR)</label>
                                                <input
                                                    type="number"
                                                    required
                                                    min={0}
                                                    value={checkoutForm.data.trade_in.buy_price === 0 ? '' : checkoutForm.data.trade_in.buy_price}
                                                    onChange={e => {
                                                        const ti = checkoutForm.data.trade_in!;
                                                        checkoutForm.setData('trade_in', { ...ti, buy_price: parseFloat(e.target.value) || 0 });
                                                    }}
                                                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium text-foreground"
                                                    placeholder="Appraisal amount"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Serial Number</label>
                                                <input
                                                    type="text"
                                                    value={checkoutForm.data.trade_in.serial_number || ''}
                                                    onChange={e => {
                                                        const ti = checkoutForm.data.trade_in!;
                                                        checkoutForm.setData('trade_in', { ...ti, serial_number: e.target.value });
                                                    }}
                                                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium text-foreground"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Trade-in IMEI</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={checkoutForm.data.trade_in.imei_1}
                                                    onChange={e => {
                                                        const ti = checkoutForm.data.trade_in!;
                                                        checkoutForm.setData('trade_in', { ...ti, imei_1: e.target.value });
                                                    }}
                                                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium text-foreground"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {}
                            <div className="bg-muted/40 rounded-xl p-4 border border-border space-y-2">
                                <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                                    <span>Unit Price:</span>
                                    <span className="text-foreground">{formatCurrency(Number(checkoutForm.data.items[0]?.actual_sell_price) || 0)}</span>
                                </div>
                                {checkoutForm.data.extras.length > 0 && (
                                    <div className="flex justify-between text-xs font-semibold text-muted-foreground">
                                        <span>Add-On Services (Customer):</span>
                                        <span className="text-foreground">
                                            {formatCurrency(
                                                checkoutForm.data.extras.reduce((acc, curr) => curr.charge_to === 'buyer' ? acc + curr.sell_price : acc, 0)
                                            )}
                                        </span>
                                    </div>
                                )}
                                {checkoutForm.data.trade_in && (
                                    <div className="flex justify-between text-xs font-semibold text-primary">
                                        <span>Trade-in Deduction:</span>
                                        <span>-{formatCurrency(Number(checkoutForm.data.trade_in.buy_price) || 0)}</span>
                                    </div>
                                )}
                                <div className="border-t border-border pt-2 mt-2 flex justify-between items-center">
                                    <span className="text-sm font-semibold text-foreground">TOTAL:</span>
                                    <span className="text-xl font-bold text-primary">
                                        {formatCurrency(calculateTotal())}
                                    </span>
                                </div>
                            </div>

                            {}

                            {/* AI Deal Summary (upsell + integrity + anomaly — no margin/profit shown) */}
                            <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent p-4 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h5 className="text-xs font-bold text-primary flex items-center gap-1.5 uppercase tracking-wider">
                                        <Sparkles className="h-3.5 w-3.5" /> AI Deal Summary
                                    </h5>
                                    <button
                                        type="button"
                                        onClick={fetchCheckoutSummary}
                                        disabled={aiSummaryLoading}
                                        className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                                    >
                                        <RefreshCw className={`h-3 w-3 ${aiSummaryLoading ? 'animate-spin' : ''}`} /> Refresh
                                    </button>
                                </div>

                                {aiSummaryLoading && !aiSummary ? (
                                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                        <span className="animate-pulse h-2 w-2 rounded-full bg-primary" />
                                        Analyzing unit, IMEI, customer history & price...
                                    </div>
                                ) : aiSummary ? (
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap gap-1.5">
                                            {aiSummary.checks.map(c => (
                                                <span
                                                    key={c.label}
                                                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border ${
                                                        c.type === 'ok'
                                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                                            : c.type === 'warn'
                                                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                                                : 'bg-primary/10 text-primary border-primary/20'
                                                    }`}
                                                >
                                                    {c.type === 'ok'
                                                        ? <ShieldCheck className="h-3 w-3" />
                                                        : c.type === 'warn'
                                                            ? <AlertTriangle className="h-3 w-3" />
                                                            : <Info className="h-3 w-3" />}
                                                    {c.label}
                                                </span>
                                            ))}
                                        </div>

                                        {aiSummary.checks.some(c => c.type === 'warn') && (
                                            <div className="space-y-1">
                                                {aiSummary.checks.filter(c => c.type === 'warn').map(c => (
                                                    <p key={c.label} className="text-[11px] text-amber-600 dark:text-amber-400 flex gap-1.5">
                                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                                                        <span><b>{c.label}:</b> {c.detail}</span>
                                                    </p>
                                                ))}
                                            </div>
                                        )}

                                        {aiSummary.upsell ? (
                                            <div className="border-t border-border/40 pt-2">
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Suggested add-ons</p>
                                                <div className="text-xs text-foreground whitespace-pre-line leading-relaxed">{aiSummary.upsell}</div>
                                            </div>
                                        ) : (
                                            aiSummary.checks.filter(c => c.type === 'info').length > 0 && (
                                                <p className="text-[10px] text-muted-foreground/80">AI suggestions nonaktif — menampilkan cek otomatis saja.</p>
                                            )
                                        )}
                                    </div>
                                ) : null}
                            </div>

                            {}
                            <div className="flex gap-3 pt-4 border-t border-border">
                                <button
                                    type="button"
                                    onClick={() => setIsCheckoutOpen(false)}
                                    className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={checkoutForm.processing}
                                    className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm"
                                >
                                    {checkoutForm.processing ? 'Processing...' : 'Complete Payment'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {}
            {successData !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6 space-y-5 text-center">
                        <div className="flex justify-center">
                            <div className="h-16 w-16 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
                                <CheckCircle className="h-8 w-8 text-primary" />
                            </div>
                        </div>
                        <div>
                            <h4 className="text-lg font-bold text-foreground">Transaction Completed!</h4>
                            <p className="text-xs text-muted-foreground mt-1">
                                Payment for <span className="font-bold text-foreground">{successData.buyerName}</span> has been processed.
                            </p>
                            <p className="text-sm font-bold text-primary mt-1">
                                Total: {formatCurrency(successData.total)}
                            </p>
                        </div>

                        <div className="space-y-2.5">
                            {}
                            <button
                                onClick={() => openWAChat(successData.buyerPhone, successData.buyerName)}
                                className="w-full flex items-center justify-center gap-2 rounded-xl bg-card border border-input py-3 text-sm font-semibold text-foreground hover:bg-muted transition shadow-sm"
                            >
                                <MessageCircle className="h-4 w-4 text-primary" /> Chat Customer via WhatsApp
                            </button>

                            {}
                            {successData.invoiceNumber && (
                                <button
                                    onClick={() => openWAInvoice(successData.buyerPhone, successData.buyerName, successData.invoiceNumber, successData.total)}
                                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm"
                                >
                                    <Send className="h-4 w-4" /> Send Invoice via WhatsApp
                                </button>
                            )}

                            {}
                            {successData.invoiceNumber && (
                                <a
                                    href={`/invoice/${successData.invoiceNumber}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-input py-3 text-sm font-semibold text-foreground hover:bg-muted transition"
                                >
                                    <ExternalLink className="h-4 w-4 text-muted-foreground" /> View Online Invoice
                                </a>
                            )}

                            <button
                                onClick={() => setSuccessData(null)}
                                className="w-full rounded-xl py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {}
            {showBuyerSearchModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
                        <div className="flex justify-between items-center pb-4 border-b border-border mb-4">
                            <h4 className="text-lg font-bold text-foreground">Select Customer</h4>
                            <button
                                onClick={() => setShowBuyerSearchModal(false)}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div className="relative">
                                <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search by customer name or phone..."
                                    value={buyerSearchQuery}
                                    onChange={e => setBuyerSearchQuery(e.target.value)}
                                    className="w-full rounded-xl border border-input bg-background pl-10 pr-4 py-2.5 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="max-h-60 overflow-y-auto divide-y divide-border/40 border border-border rounded-xl">
                                {filteredBuyers.length === 0 ? (
                                    <p className="text-center text-xs text-muted-foreground py-6">No customers found.</p>
                                ) : (
                                    filteredBuyers.map(b => (
                                        <div
                                            key={b.id}
                                            onClick={() => {
                                                selectBuyer(b);
                                                setShowBuyerSearchModal(false);
                                            }}
                                            className="p-3 hover:bg-muted/50 cursor-pointer flex justify-between items-center text-xs font-medium"
                                        >
                                            <div className="min-w-0 pr-2">
                                                <p className="text-foreground font-semibold truncate">{b.name}</p>
                                                <p className="text-muted-foreground font-normal truncate">{b.address || 'No address'}</p>
                                            </div>
                                            <span className="text-primary font-mono flex-shrink-0">{b.phone}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}

