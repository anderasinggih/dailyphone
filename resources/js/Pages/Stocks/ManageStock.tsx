import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm, router, usePage } from '@inertiajs/react';
import { useState, useEffect, useRef, Fragment } from 'react';
import {
    Smartphone,
    Layers,
    Plus,
    List,
    Trash,
    Check,
    Settings,
    PlusCircle,
    Info,
    CheckCircle,
    AlertCircle,
    FileSpreadsheet,
    QrCode,
    MessageCircle,
    Send,
    ExternalLink,
    RotateCcw,
    Search,
    Filter
} from 'lucide-react';
import StockDetailPanel from './Partials/StockDetailPanel';

interface ParameterValue {
    id: number;
    value: string;
    is_active: boolean;
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
    parameterValues?: Array<{ id: number; parameter_id: number; value_id: number }>;
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
    created_at?: string;
    deleted_at?: string | null;
    store?: { name: string };
    brand?: { value: string };
    color?: { value: string };
    memory?: { value: string };
    license?: { value: string };
    sale_items?: Array<{
        id: number;
        qty: number;
        actual_sell_price: string | number;
        buy_price_snap: string | number;
        sale?: {
            id: number;
            invoice_number: string;
            created_at: string;
            affiliate_fee: string | number;
            buyer?: { id: number; name: string; phone?: string; };
            affiliate_user?: { id: number; name: string; };
            extras?: Array<{ id: number; extra_id: number; charge_to: 'buyer' | 'seller' | 'free_promotion'; sell_price: string | number; buy_price: string | number; extra?: { name: string } }>;
            items?: Array<{ id: number; stock_id: number; qty: number; actual_sell_price: string | number; buy_price_snap: string | number; is_trade_in_item: boolean; }>;
        };
    }>;
}

interface Store {
    id: number;
    name: string;
    location?: string;
}

interface ManageStockProps {
    stocks: StockItem[];
    stores: Store[];
    parameters: Parameter[];
    filters?: {
        store_id: string | number | null;
    };
}

export default function ManageStock({ stocks, stores, parameters, filters }: ManageStockProps) {
    const authUser = usePage().props.auth.user as any;
    const isSuperAdmin = authUser.role === 'superadmin';
    const canSeeFinancials = ['superadmin', 'viewer'].includes(authUser.role);
    const [storeFilterId, setStoreFilterId] = useState(filters?.store_id || '');
    const [isAddingNewStock, setIsAddingNewStock] = useState(false);
    const [isEditingStock, setIsEditingStock] = useState(false);
    const [trashFilter, setTrashFilter] = useState<'active' | 'trash'>('active');
    const [selectedStockDetail, setSelectedStockDetail] = useState<StockItem | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [showFilters, setShowFilters] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
        key: 'created_at',
        direction: 'desc'
    });
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, storeFilterId, trashFilter, categoryFilter]);

    const uniqueProductNames = Array.from(new Set(stocks.map(s => s.name).filter(Boolean)));

    const filteredStocks = stocks.filter(item => {

        if (trashFilter === 'trash') {
            if (!item.deleted_at) return false;
        } else {
            if (item.deleted_at) return false;
        }

        if (categoryFilter !== 'all' && item.category !== categoryFilter) {
            return false;
        }

        const matchesSearch =
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.serial_number && item.serial_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (item.imei_1 && item.imei_1.includes(searchQuery)) ||
            (item.color?.value && item.color.value.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (item.brand?.value && item.brand.value.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (item.store?.name && item.store.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
            (item.sale_items && item.sale_items.some(si =>
                (si.sale?.buyer?.name && si.sale.buyer.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (si.sale?.buyer?.phone && si.sale.buyer.phone.includes(searchQuery)) ||
                (si.sale?.invoice_number && si.sale.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()))
            ));
        return matchesSearch;
    });

    const getSortValue = (item: StockItem, key: string) => {
        const saleItem = item.sale_items && item.sale_items[0];
        const sale = saleItem?.sale;

        switch (key) {
            case 'created_at':
                return item.created_at ? new Date(item.created_at).getTime() : 0;
            case 'name':
                return item.name || '';
            case 'sold_date':
                return (item.status === 'sold' && sale?.created_at) ? new Date(sale.created_at).getTime() : 0;
            case 'store':
                return item.store?.name || 'Main Warehouse';
            case 'type':
                return item.type || '';
            case 'color':
                return item.color?.value || '';
            case 'memory':
                return item.memory?.value || '';
            case 'serial_number':
                return item.serial_number || '';
            case 'imei_1':
                return item.imei_1 || '';
            case 'license':
                return item.license?.value || '';
            case 'buy_price':
                return item.buy_price ? parseFloat(item.buy_price as any) : 0;
            case 'sell_price':
                return item.sell_price ? parseFloat(item.sell_price as any) : 0;
            case 'actual_sell_price':
                return (item.status === 'sold' && saleItem?.actual_sell_price) ? parseFloat(saleItem.actual_sell_price as any) : 0;
            case 'actual_affiliate_fee':
                return (item.status === 'sold' && sale?.affiliate_fee) ? parseFloat(sale.affiliate_fee as any) : 0;
            case 'actual_profit': {
                const buyPrice = item.buy_price ? parseFloat(item.buy_price as any) : 0;
                const actualSellPrice = (item.status === 'sold' && saleItem?.actual_sell_price) ? parseFloat(saleItem.actual_sell_price as any) : 0;
                const actualAffiliateFee = (item.status === 'sold' && sale?.affiliate_fee) ? parseFloat(sale.affiliate_fee as any) : 0;
                const extrasProfit = (item.status === 'sold' && sale?.extras)
                    ? sale.extras.reduce((acc, curr) => {
                        const sell = parseFloat(curr.sell_price as any) || 0;
                        const buy = parseFloat(curr.buy_price as any) || 0;
                        if (curr.charge_to === 'buyer') {
                            return acc + (sell - buy);
                        } else {
                            return acc - buy;
                        }
                    }, 0)
                    : 0;
                return actualSellPrice > 0 ? (actualSellPrice - buyPrice - actualAffiliateFee + extrasProfit) : 0;
            }
            case 'sold_in':
                return (item.status === 'sold' && sale?.invoice_number) ? sale.invoice_number : '';
            case 'affiliator':
                return (item.status === 'sold' && sale?.affiliate_user?.name) ? sale.affiliate_user.name : '';
            case 'buyer':
                return (item.status === 'sold' && sale?.buyer?.name) ? sale.buyer.name : '';
            case 'status':
                return item.deleted_at ? 'trash' : item.status;
            default:
                return '';
        }
    };

    const sortedStocks = [...filteredStocks].sort((a, b) => {

        const aStatusOrder = a.deleted_at ? 2 : (a.status === 'sold' ? 1 : 0);
        const bStatusOrder = b.deleted_at ? 2 : (b.status === 'sold' ? 1 : 0);

        if (aStatusOrder !== bStatusOrder) {
            return aStatusOrder - bStatusOrder;
        }

        if (a.status === 'sold' && b.status === 'sold' && sortConfig.key === 'created_at') {
            const aSoldDate = Number(getSortValue(a, 'sold_date'));
            const bSoldDate = Number(getSortValue(b, 'sold_date'));
            return bSoldDate - aSoldDate;
        }

        const aVal = getSortValue(a, sortConfig.key);
        const bVal = getSortValue(b, sortConfig.key);

        if (aVal === bVal) return 0;

        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();

        return sortConfig.direction === 'asc'
            ? aStr.localeCompare(bStr)
            : bStr.localeCompare(aStr);
    });

    const requestSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const imeiSingleRef = useRef<HTMLInputElement>(null);

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannerInstance, setScannerInstance] = useState<any>(null);
    const [scannerError, setScannerError] = useState<string | null>(null);

    useEffect(() => {
        let html5Qrcode: any = null;
        if (isScannerOpen) {
            import('html5-qrcode').then(({ Html5Qrcode }) => {
                const element = document.getElementById("reader");
                if (!element) return;

                html5Qrcode = new Html5Qrcode("reader");
                setScannerInstance(html5Qrcode);

                html5Qrcode.start(
                    { facingMode: "environment" },
                    {
                        fps: 10,
                        qrbox: (width: number, height: number) => {
                            return { width: Math.floor(width * 0.85), height: Math.floor(height * 0.4) };
                        }
                    },
                    (decodedText: string) => {
                        singleForm.setData('imei_1', decodedText);
                        html5Qrcode.stop().then(() => {
                            setIsScannerOpen(false);
                        }).catch((err: any) => {
                            console.error(err);
                            setIsScannerOpen(false);
                        });
                    },
                    (errorMessage: string) => {

                    }
                ).then(() => {
                    const videoElem = element.querySelector('video');
                    if (videoElem) {
                        videoElem.setAttribute('playsinline', 'true');
                        videoElem.setAttribute('webkit-playsinline', 'true');
                        videoElem.setAttribute('muted', 'true');
                        videoElem.muted = true;
                    }
                }).catch((err: any) => {
                    setScannerError("Failed to access camera: " + err.message);
                });
            }).catch((err) => {
                setScannerError("Failed to load scanner module: " + err.message);
            });
        }

        return () => {
            if (html5Qrcode && html5Qrcode.isScanning) {
                html5Qrcode.stop().catch((err: any) => console.error(err));
            }
        };
    }, [isScannerOpen]);

    const closeScanner = () => {
        if (scannerInstance && scannerInstance.isScanning) {
            scannerInstance.stop().then(() => {
                setIsScannerOpen(false);
            }).catch((err: any) => {
                console.error(err);
                setIsScannerOpen(false);
            });
        } else {
            setIsScannerOpen(false);
        }
    };

    const singleForm = useForm({
        store_id: stores[0]?.id || '',
        category: 'iphone' as 'iphone' | 'android' | 'accessories' | 'extra',
        type: 'new' as 'new' | 'second',
        name: '',
        brand_id: '' as string | number,
        color_id: '' as string | number,
        memory_id: '' as string | number,
        license_id: '' as string | number,
        parameter_values: {} as Record<number, string>,
        serial_number: '',
        imei_1: '',
        supplier: '',
        warranty_duration_days: '' as string | number,
        buy_price: '' as string | number,
        sell_price: '' as string | number,
        sell_price_reseller: '' as string | number,
        qty: 1,
        default_charge_to: 'buyer' as 'buyer' | 'seller' | 'free_promotion'
    });

    const editForm = useForm({
        store_id: '' as string | number,
        category: 'iphone' as 'iphone' | 'android' | 'accessories' | 'extra',
        type: 'new' as 'new' | 'second',
        name: '',
        brand_id: '' as string | number,
        color_id: '' as string | number,
        memory_id: '' as string | number,
        license_id: '' as string | number,
        parameter_values: {} as Record<number, string>,
        serial_number: '',
        imei_1: '',
        supplier: '',
        warranty_duration_days: '' as string | number,
        buy_price: '' as string | number,
        sell_price: '' as string | number,
        sell_price_reseller: '' as string | number,
        qty: 1,
        status: 'available' as 'available' | 'transit' | 'sold',
        default_charge_to: 'buyer' as 'buyer' | 'seller' | 'free_promotion',
        buyer_name: '',
        buyer_phone: '',
        buyer_address: '',
        remove_extra_ids: [] as number[],
        update_extras: [] as Array<{ extra_id: number; charge_to: 'buyer' | 'seller' | 'free_promotion'; sell_price: number; buy_price: number; name?: string }>
    });

    const openEditModal = (stock: StockItem) => {
        const sale = stock.sale_items?.[0]?.sale;
        const buyer = sale?.buyer as any;
        const currentExtras = (sale?.extras || []).map(e => ({
            extra_id: e.extra_id,
            charge_to: e.charge_to,
            sell_price: Number(e.sell_price) || 0,
            buy_price: Number(e.buy_price) || 0,
            name: e.extra?.name || 'Add-on'
        }));
        editForm.setData({
            store_id: stock.store_id || '',
            category: stock.category || 'iphone',
            type: stock.type || 'new',
            name: stock.name || '',
            brand_id: stock.brand_id || '',
            color_id: stock.color_id || '',
            memory_id: stock.memory_id || '',
            license_id: stock.license_id || '',
            parameter_values: buildParamValueMap(stock),
            serial_number: stock.serial_number || '',
            imei_1: stock.imei_1 || '',
            supplier: stock.supplier || '',
            warranty_duration_days: stock.warranty_duration_days || '',
            buy_price: stock.buy_price ? Math.round(parseFloat(stock.buy_price as any)) : '',
            sell_price: stock.sell_price ? Math.round(parseFloat(stock.sell_price as any)) : '',
            sell_price_reseller: stock.sell_price_reseller ? Math.round(parseFloat(stock.sell_price_reseller as any)) : '',
            qty: stock.qty || 1,
            status: stock.status || 'available',
            default_charge_to: (stock as any).default_charge_to || 'buyer',
            buyer_name: buyer?.name || '',
            buyer_phone: buyer?.phone || '',
            buyer_address: buyer?.address || '',
            remove_extra_ids: [],
            update_extras: currentExtras
        });
        setIsEditingStock(true);
    };

    const submitEdit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedStockDetail) return;
        editForm.put(route('stocks.update', selectedStockDetail.id), {
            onSuccess: () => {
                setIsEditingStock(false);
                setSelectedStockDetail(null);
                alert('Stock unit updated successfully!');
            }
        });
    };

    const handleDeleteStock = (stockId: number) => {
        if (confirm('Are you sure you want to delete this stock unit? The unit will be moved to Trash.')) {
            router.delete(route('stocks.destroy', stockId), {
                onSuccess: () => {
                    setSelectedStockDetail(null);
                    alert('Stock unit moved to Trash successfully!');
                }
            });
        }
    };

    const handleRestoreStock = (stockId: number) => {
        if (confirm('Are you sure you want to restore this stock unit from Trash?')) {
            router.post(route('stocks.restore', stockId), {}, {
                onSuccess: () => {
                    setSelectedStockDetail(null);
                    alert('Stock unit restored successfully!');
                }
            });
        }
    };

    const handleQuickRestoreToAvailable = (stock: StockItem) => {
        if (confirm('Are you sure you want to revert this unit from SOLD to AVAILABLE? The sale transaction will be deleted.')) {
            router.put(route('stocks.update', stock.id), {
                store_id: stock.store_id || '',
                category: stock.category || 'iphone',
                type: stock.type || 'new',
                name: stock.name || '',
                brand_id: stock.brand_id || '',
                color_id: stock.color_id || '',
                memory_id: stock.memory_id || '',
                license_id: stock.license_id || '',
                serial_number: stock.serial_number || '',
                imei_1: stock.imei_1 || '',
                supplier: stock.supplier || '',
                warranty_duration_days: stock.warranty_duration_days || 0,
                buy_price: stock.buy_price ? Math.round(parseFloat(stock.buy_price as any)) : 0,
                sell_price: stock.sell_price ? Math.round(parseFloat(stock.sell_price as any)) : 0,
                sell_price_reseller: stock.sell_price_reseller ? Math.round(parseFloat(stock.sell_price_reseller as any)) : 0,
                qty: stock.qty || 1,
                status: 'available'
            }, {
                onSuccess: () => {
                    setSelectedStockDetail(null);
                    alert('Unit status successfully reverted to Available and sale record removed.');
                }
            });
        }
    };

    const isConditionParam = (param: Parameter) => param.name.toLowerCase().includes('condition');

    const getScopedParams = (category: string): Parameter[] => {
        if (category === 'extra') return [];
        if (category === 'accessories') return parameters.filter(p => p.category === 'global');
        return parameters.filter(p => p.category === 'global' || p.category === category);
    };

    const findParamIdBySlug = (slug: string): number | null => {
        const aliases: Record<string, string[]> = {
            brand: ['brand', 'merek'],
            color: ['color', 'warna'],
            memory: ['memory', 'storage', 'capacity', 'memori'],
            license: ['license', 'licence', 'lisensi'],
        };
        const set = aliases[slug] || [];
        const found = parameters.find(p => set.some(a => p.name.toLowerCase().includes(a)));
        return found?.id ?? null;
    };

    const buildParamValueMap = (stock: StockItem): Record<number, string> => {
        const map: Record<number, string> = {};
        (stock.parameterValues || []).forEach(pv => {
            map[pv.parameter_id] = String(pv.value_id);
        });
        const legacy: Record<string, number | null> = {
            brand: stock.brand_id,
            color: stock.color_id,
            memory: stock.memory_id,
            license: stock.license_id,
        };
        Object.entries(legacy).forEach(([slug, valueId]) => {
            if (!valueId) return;
            const pid = findParamIdBySlug(slug);
            if (pid && map[pid] === undefined) map[pid] = String(valueId);
        });
        return map;
    };

    const renderParamSelect = (form: any, param: Parameter) => {
        const value = form.data.parameter_values?.[param.id] ?? '';
        return (
            <div key={param.id}>
                <label className="block text-xs font-bold text-muted-foreground mb-1">{param.name}</label>
                <select
                    value={value}
                    onChange={e => form.setData('parameter_values', { ...form.data.parameter_values, [param.id]: e.target.value })}
                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                >
                    <option value="">-- Select {param.name} --</option>
                    {param.values.map(o => <option key={o.id} value={o.id}>{o.value}</option>)}
                </select>
            </div>
        );
    };

    const renderConditionSelect = (form: any, condParam: Parameter) => {
        const value = form.data.parameter_values?.[condParam.id] ?? '';
        return (
            <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">Item Condition</label>
                <select
                    value={value}
                    onChange={e => {
                        const val = e.target.value;
                        form.setData('parameter_values', { ...form.data.parameter_values, [condParam.id]: val });
                        const matched = condParam.values.find(o => String(o.id) === val);
                        if (matched) {
                            form.setData('type', matched.value.toLowerCase().includes('new') ? 'new' : 'second');
                        }
                    }}
                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                >
                    <option value="">-- Select Condition --</option>
                    {condParam.values.map(o => <option key={o.id} value={o.id}>{o.value}</option>)}
                </select>
            </div>
        );
    };

    const submitSingle = (e: React.FormEvent) => {
        e.preventDefault();
        singleForm.post(route('stocks.store'), {
            onSuccess: () => {
                singleForm.reset();
                singleForm.setData({
                    store_id: stores[0]?.id || '',
                    category: 'iphone',
                    type: 'new',
                    name: '', brand_id: '', color_id: '', memory_id: '', license_id: '',
                    serial_number: '', imei_1: '', supplier: '',
                    warranty_duration_days: '', buy_price: '', sell_price: '', sell_price_reseller: '', qty: 1
                } as any);
                setIsAddingNewStock(false);
                alert('Stock unit added successfully!');
            }
        });
    };

    const toWANumber = (phone: string): string => {
        if (!phone) return '';
        const clean = phone.replace(/[^\d]/g, '');
        if (clean.startsWith('0')) return '62' + clean.slice(1);
        return clean;
    };

    const openWAChat = (phone: string, name: string) => {
        const waNum = toWANumber(phone);
        if (!waNum) return;
        const msg = encodeURIComponent(`Hello ${name}! Thank you for shopping with us. 😊`);
        window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
    };

    const openWAInvoice = (phone: string, name: string, invoiceNumber: string, total?: number) => {
        const waNum = toWANumber(phone);
        if (!waNum) return;
        const invoiceUrl = `${window.location.origin}/invoice/${invoiceNumber}`;
        const totalLine = total ? `*Total Payment :* ${formatCurrency(total)}\n` : '';
        const lines = [
            `Halo ${name},`,
            ``,
            `Thank you for shopping at *Daily Phone*!`,
            `Here are your transaction details:`,
            ``,
            `*Invoice No. :* ${invoiceNumber}`,
            totalLine.trim(),
            ``,
            `Please view your complete receipt at the following link:`,
            invoiceUrl,
            ``,
            `Keep this receipt as your official product warranty proof.`,
            ``,
            `Best regards,`,
            `*Daily Phone Team*`,
        ].filter(l => l !== undefined);
        const msg = encodeURIComponent(lines.join('\n'));
        window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank');
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    const singleScoped = getScopedParams(singleForm.data.category);
    const singleCondParam = singleScoped.find(isConditionParam);
    const singleSpecParams = singleScoped.filter(p => !isConditionParam(p));

    const editScoped = getScopedParams(editForm.data.category);
    const editCondParam = editScoped.find(isConditionParam);
    const editSpecParams = editScoped.filter(p => !isConditionParam(p));

    return (
        <AuthenticatedLayout
            header={
                <div className="flex items-stretch gap-2 justify-end w-full">
                        {!isAddingNewStock && !isEditingStock && (
                            <div className="relative flex-1">
                                <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search unit, SN, IMEI, customer, phone..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-2 text-sm font-medium text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                        )}
                        {!isAddingNewStock && !isEditingStock && (
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
                        )}
                        {!isAddingNewStock && !isEditingStock ? (
                            <button
                                onClick={() => setIsAddingNewStock(true)}
                                className="flex items-center justify-center rounded-xl bg-primary px-3 py-2 text-primary-foreground hover:opacity-90 transition shadow-sm whitespace-nowrap shrink-0"
                                title="Add Stock"
                            >
                                <Plus className="h-5 w-5" />
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    setIsAddingNewStock(false);
                                    setIsEditingStock(false);
                                }}
                                className="flex items-center justify-center rounded-xl border border-input bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition shadow-sm whitespace-nowrap shrink-0"
                            >
                                Back
                            </button>
                        )}
                </div>
            }
        >
            <Head title="Inventory" />

            <div className="pb-8 pt-2">
                <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 space-y-8">

                    {}
                    {!isAddingNewStock && !isEditingStock ? (
                        <>
                            {showFilters && (
                                <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-2xl border border-border shadow-sm mb-6 transition-all duration-300 w-full">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full">
                                        <div className="flex-1 min-w-[200px]">
                                            <label className="block text-[10px] font-bold text-muted-foreground mb-1">Category</label>
                                            <select
                                                value={categoryFilter}
                                                onChange={e => setCategoryFilter(e.target.value)}
                                                className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm focus:border-primary focus:outline-none"
                                            >
                                                <option value="all">All Categories</option>
                                                <option value="iphone">iPhone</option>
                                                <option value="android">Android</option>
                                                <option value="accessories">Accessories</option>
                                                <option value="extra">Add-On / Services</option>
                                            </select>
                                        </div>
                                        {isSuperAdmin && (
                                            <div className="flex-1 min-w-[200px]">
                                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Unit Status</label>
                                                <select
                                                    value={trashFilter}
                                                    onChange={(e) => setTrashFilter(e.target.value as any)}
                                                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm focus:border-primary focus:outline-none"
                                                >
                                                    <option value="active">Active Units</option>
                                                    <option value="trash">Trash / Deleted</option>
                                                </select>
                                            </div>
                                        )}
                                        {isSuperAdmin && (
                                            <div className="flex-1 min-w-[200px]">
                                                <label className="block text-[10px] font-bold text-muted-foreground mb-1">Branch</label>
                                                <select
                                                    value={storeFilterId}
                                                    onChange={(e) => {
                                                        setStoreFilterId(e.target.value);
                                                        router.get(route('sale-data.index'), { store_id: e.target.value }, { preserveState: true });
                                                    }}
                                                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm focus:border-primary focus:outline-none"
                                                >
                                                    <option value="">All Branches</option>
                                                    {stores.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <div className="w-full flex flex-col lg:flex-row gap-6 items-stretch lg:items-start">
                                {}
                            <div className={`rounded-none sm:rounded-2xl border-x-0 sm:border border-y sm:border-y-0 border-border/60 bg-transparent sm:bg-card shadow-none sm:shadow-sm text-card-foreground -mx-4 sm:mx-0 w-[calc(100%+2rem)] sm:w-full transition-all duration-300 ${
                                selectedStockDetail ? 'hidden lg:block lg:w-2/3' : ''
                            }`}>
                                <div className="p-0 sm:p-6">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 sm:px-0 pt-4 sm:pt-0 mb-4">
                                    <h3 className="text-lg font-bold text-foreground tracking-tight">All Sale Data</h3>
                                </div>

                                <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
                                    <div style={{ minWidth: 'max-content', width: '100%' }}>
                                    <table className="w-full min-w-[1050px] text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-border dark:border-input text-[11px] font-bold tracking-wider text-muted-foreground select-none">
                                                <th className="pb-3 font-semibold px-3 whitespace-nowrap text-left w-10">
                                                    #
                                                </th>
                                                <th onClick={() => requestSort('created_at')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Stock Date {sortConfig.key === 'created_at' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('name')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Product Name {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('sold_date')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Sold Date {sortConfig.key === 'sold_date' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('store')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Stock For {sortConfig.key === 'store' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('type')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Type {sortConfig.key === 'type' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('color')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Color {sortConfig.key === 'color' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('memory')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Memory {sortConfig.key === 'memory' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('serial_number')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Serial Number {sortConfig.key === 'serial_number' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('imei_1')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    IMEI {sortConfig.key === 'imei_1' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('license')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    License {sortConfig.key === 'license' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                {isSuperAdmin && (
                                                    <th onClick={() => requestSort('buy_price')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                        Buy Price {sortConfig.key === 'buy_price' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                    </th>
                                                )}
                                                <th onClick={() => requestSort('sell_price')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Sell Price {sortConfig.key === 'sell_price' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                {isSuperAdmin && (
                                                    <th onClick={() => requestSort('actual_sell_price')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                        Actual Sell {sortConfig.key === 'actual_sell_price' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                    </th>
                                                )}
                                                {isSuperAdmin && (
                                                    <th onClick={() => requestSort('actual_affiliate_fee')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                        Affiliate Fee {sortConfig.key === 'actual_affiliate_fee' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                    </th>
                                                )}
                                                {isSuperAdmin && (
                                                    <th onClick={() => requestSort('actual_profit')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                        Profit {sortConfig.key === 'actual_profit' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                    </th>
                                                )}
                                                <th onClick={() => requestSort('sold_in')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Sold In {sortConfig.key === 'sold_in' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('affiliator')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Affiliator {sortConfig.key === 'affiliator' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('buyer')} className="pb-3 font-semibold px-3 whitespace-nowrap text-left cursor-pointer hover:text-foreground">
                                                    Buyer {sortConfig.key === 'buyer' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                                <th onClick={() => requestSort('status')} className="pb-3 font-semibold text-right px-3 whitespace-nowrap cursor-pointer hover:text-foreground">
                                                    Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300">
                                            {sortedStocks.length === 0 ? (
                                                <tr>
                                                    <td colSpan={isSuperAdmin ? 20 : 16} className="py-8 text-center text-muted-foreground">No units found in system.</td>
                                                </tr>
                                            ) : (() => {

                                                const displayItems = [...sortedStocks].sort((a, b) => {
                                                    const order = { 'available': 1, 'transit': 2, 'sold': 3 };
                                                    const aOrder = a.deleted_at ? 4 : (order[a.status as keyof typeof order] || 4);
                                                    const bOrder = b.deleted_at ? 4 : (order[b.status as keyof typeof order] || 4);
                                                    return aOrder - bOrder;
                                                });
                                                const itemsPerPage = 50;
                                                const paginatedItems = displayItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                                                return paginatedItems.map((item, idx) => {
                                                    const absoluteIdx = (currentPage - 1) * itemsPerPage + idx;
                                                    const prevItem = absoluteIdx > 0 ? displayItems[absoluteIdx - 1] : null;
                                                    const isFirstItem = absoluteIdx === 0;

                                                    const showAvailableHeader = isFirstItem && !item.deleted_at && item.status !== 'sold';

                                                    const showSoldDivider = !item.deleted_at && item.status === 'sold' && (
                                                        isFirstItem || (prevItem && prevItem.status !== 'sold' && !prevItem.deleted_at)
                                                    );

                                                    const showTrashDivider = !!item.deleted_at && (
                                                        isFirstItem || (prevItem && !prevItem.deleted_at)
                                                    );

                                                    const saleItem = item.sale_items && item.sale_items[0];
                                                    const sale = saleItem?.sale;
                                                    const stockDate = item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                                                    const soldDate = (item.status === 'sold' && sale?.created_at) ? new Date(sale.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                                                    const stockFor = item.store?.name || 'Main Warehouse';
                                                    const typeText = item.type;
                                                    const colorText = item.color?.value || '-';
                                                    const memoryText = item.memory?.value || '-';
                                                    const licenseText = item.license?.value || '-';

                                                    const buyPrice = item.buy_price ? parseFloat(item.buy_price as any) : 0;
                                                    const sellPrice = item.sell_price ? parseFloat(item.sell_price as any) : 0;
                                                    const actualSellPrice = (item.status === 'sold' && saleItem?.actual_sell_price) ? parseFloat(saleItem.actual_sell_price as any) : 0;
                                                    const actualAffiliateFee = (item.status === 'sold' && sale?.affiliate_fee) ? parseFloat(sale.affiliate_fee as any) : 0;
                                                    const extrasProfit = (item.status === 'sold' && sale?.extras)
                                                        ? sale.extras.reduce((acc, curr) => {
                                                            const sell = parseFloat(curr.sell_price as any) || 0;
                                                            const buy = parseFloat(curr.buy_price as any) || 0;
                                                            if (curr.charge_to === 'buyer') {
                                                                return acc + (sell - buy);
                                                            } else {
                                                                return acc - buy;
                                                            }
                                                        }, 0)
                                                        : 0;
                                                    const actualProfit = actualSellPrice > 0 ? (actualSellPrice - buyPrice - actualAffiliateFee + extrasProfit) : 0;

                                                    const soldIn = (item.status === 'sold' && sale?.invoice_number) ? sale.invoice_number : '-';
                                                    const affiliatorName = (item.status === 'sold' && sale?.affiliate_user?.name) ? sale.affiliate_user.name : '-';
                                                    const buyerName = (item.status === 'sold' && sale?.buyer?.name) ? sale.buyer.name : '-';

                                                    const isSelected = selectedStockDetail?.id === item.id;

                                                    return (
                                                        <Fragment key={item.id}>
                                                            {showAvailableHeader && (
                                                                <tr className="select-none">
                                                                    <td colSpan={isSuperAdmin ? 19 : 15} className="py-0">
                                                                        <div className="flex items-center gap-3 px-3 py-2 bg-primary/10 border-y border-primary/20">
                                                                            <div className="w-1 h-5 rounded-full bg-primary flex-shrink-0" />
                                                                            <span className="text-[11px] font-bold tracking-wider text-primary">
                                                                                Available Units
                                                                            </span>
                                                                            <div className="ml-auto text-[10px] font-bold text-primary/70">
                                                                                {displayItems.filter(i => !i.deleted_at && i.status !== 'sold').length} units
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                            {showSoldDivider && (
                                                                <tr className="select-none">
                                                                    <td colSpan={isSuperAdmin ? 19 : 15} className="py-0">
                                                                        <div className="flex items-center gap-3 px-3 py-2 bg-muted/60 border-y border-border">
                                                                            <div className="w-1 h-5 rounded-full bg-muted-foreground flex-shrink-0" />
                                                                            <span className="text-[11px] font-bold tracking-wider text-muted-foreground">
                                                                                Sold Units
                                                                            </span>
                                                                            <div className="ml-auto text-[10px] font-bold text-muted-foreground/70">
                                                                                {displayItems.filter(i => !i.deleted_at && i.status === 'sold').length} units
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                            {showTrashDivider && (
                                                                <tr className="select-none">
                                                                    <td colSpan={isSuperAdmin ? 19 : 15} className="py-0">
                                                                        <div className="flex items-center gap-3 px-3 py-2 bg-destructive/10 border-y border-destructive/20">
                                                                            <div className="w-1 h-5 rounded-full bg-destructive flex-shrink-0" />
                                                                            <span className="text-[11px] font-bold tracking-wider text-destructive">
                                                                                Trash / Deleted Units
                                                                            </span>
                                                                            <div className="ml-auto text-[10px] font-bold text-destructive/70">
                                                                                {displayItems.filter(i => !!i.deleted_at).length} units
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                            <tr
                                                                onClick={() => setSelectedStockDetail(item)}
                                                                className={`cursor-pointer hover:bg-muted/50 dark:hover:bg-gray-900/50 transition-colors ${
                                                                    isSelected ? 'bg-primary/10' : ''
                                                                }`}
                                                            >
                                                                <td className="py-4 px-3 font-mono text-muted-foreground text-xs whitespace-nowrap text-left w-10">
                                                                    {absoluteIdx + 1}
                                                                </td>
                                                                <td className="py-4 px-3 font-medium whitespace-nowrap text-left">{stockDate}</td>
                                                                <td className="py-4 px-3 font-bold text-xs whitespace-nowrap text-left">{item.name}</td>
                                                                <td className="py-4 px-3 font-medium whitespace-nowrap text-left">{soldDate}</td>
                                                                <td className="py-4 px-3 font-bold text-xs whitespace-nowrap text-left">{stockFor}</td>
                                                                <td className="py-4 px-3 text-[10px] font-bold text-primary whitespace-nowrap text-left">{typeText}</td>
                                                                <td className="py-4 px-3 whitespace-nowrap text-left">{colorText}</td>
                                                                <td className="py-4 px-3 whitespace-nowrap text-left">{memoryText}</td>
                                                                <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap max-w-[120px] text-left">
                                                                    <span className="truncate block">{item.serial_number || '-'}</span>
                                                                </td>
                                                                <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap max-w-[130px] text-left">
                                                                    <span className="truncate block">{item.imei_1 || '-'}</span>
                                                                </td>
                                                                <td className="py-4 px-3 whitespace-nowrap text-left">{licenseText}</td>
                                                                {isSuperAdmin && (
                                                                    <td className="py-4 px-3 font-bold text-primary whitespace-nowrap text-left">
                                                                        {formatCurrency(buyPrice)}
                                                                    </td>
                                                                )}
                                                                <td className="py-4 px-3 font-bold whitespace-nowrap text-left">
                                                                    {formatCurrency(sellPrice)}
                                                                </td>
                                                                {isSuperAdmin && (
                                                                    <td className="py-4 px-3 font-bold text-foreground whitespace-nowrap text-left">
                                                                        {actualSellPrice > 0 ? formatCurrency(actualSellPrice) : '-'}
                                                                    </td>
                                                                )}
                                                                {isSuperAdmin && (
                                                                    <td className="py-4 px-3 font-medium text-muted-foreground whitespace-nowrap text-left">
                                                                        {actualAffiliateFee > 0 ? formatCurrency(actualAffiliateFee) : '-'}
                                                                    </td>
                                                                )}
                                                                {isSuperAdmin && (
                                                                    <td className={`py-4 px-3 font-bold whitespace-nowrap text-left ${actualProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                                                        {actualSellPrice > 0 ? formatCurrency(actualProfit) : '-'}
                                                                    </td>
                                                                )}
                                                                <td className="py-4 px-3 font-mono text-[10px] whitespace-nowrap text-left">{soldIn}</td>
                                                                <td className="py-4 px-3 whitespace-nowrap text-left">{affiliatorName}</td>
                                                                <td className="py-4 px-3 whitespace-nowrap text-left">{buyerName}</td>
                                                                <td className="py-4 text-right px-3 whitespace-nowrap">
                                                                    <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                                                        item.deleted_at
                                                                            ? 'bg-muted text-muted-foreground border border-border'
                                                                            : item.status === 'available'
                                                                                ? 'bg-primary/10 text-primary border border-primary/20'
                                                                                : item.status === 'transit'
                                                                                    ? 'bg-muted text-foreground border border-border'
                                                                                    : 'bg-muted text-muted-foreground border border-border'
                                                                    }`}>
                                                                        {item.deleted_at ? 'TRASH' : item.status}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        </Fragment>
                                                    );
                                                });
                                            })()}
                                        </tbody>
                                    </table>
                                    </div>
                                </div>

                                {}
                                {Math.ceil(sortedStocks.length / 50) > 1 && (
                                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 mt-4 border-t border-border dark:border-input px-4 sm:px-0 pb-4 sm:pb-0">
                                        <div className="text-xs text-muted-foreground font-medium">
                                            Showing <span className="font-bold text-foreground">{Math.min(sortedStocks.length, (currentPage - 1) * 50 + 1)}</span> - <span className="font-bold text-foreground">{Math.min(sortedStocks.length, currentPage * 50)}</span> of <span className="font-bold text-foreground">{sortedStocks.length}</span> units
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                                disabled={currentPage === 1}
                                                className="px-3.5 py-2 rounded-xl border border-input bg-card text-xs font-bold text-foreground hover:bg-muted disabled:opacity-40 transition shadow-sm dark:bg-background"
                                            >
                                                Previous
                                            </button>
                                            {(() => {
                                                const totalPages = Math.ceil(sortedStocks.length / 50);
                                                const pages = [];
                                                const maxVisible = 5;
                                                let start = Math.max(1, currentPage - 2);
                                                let end = Math.min(totalPages, start + maxVisible - 1);
                                                if (end - start + 1 < maxVisible) {
                                                    start = Math.max(1, end - maxVisible + 1);
                                                }
                                                for (let i = start; i <= end; i++) {
                                                    pages.push(
                                                        <button
                                                            key={i}
                                                            onClick={() => setCurrentPage(i)}
                                                            className={`w-9 h-9 rounded-xl text-xs font-bold transition flex items-center justify-center ${
                                                                currentPage === i
                                                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                                                    : 'border border-input bg-card text-foreground hover:bg-muted shadow-sm dark:bg-background'
                                                            }`}
                                                        >
                                                            {i}
                                                        </button>
                                                    );
                                                }
                                                return pages;
                                            })()}
                                            <button
                                                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(sortedStocks.length / 50), prev + 1))}
                                                disabled={currentPage === Math.ceil(sortedStocks.length / 50)}
                                                className="px-3.5 py-2 rounded-xl border border-input bg-card text-xs font-bold text-foreground hover:bg-muted disabled:opacity-40 transition shadow-sm dark:bg-background"
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                )}
                                </div>
                            </div>
                            {}
                            {selectedStockDetail && (
                                <div className="w-full lg:w-1/3 self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto transition-all duration-300">
                                    <StockDetailPanel
                                        stock={selectedStockDetail}
                                        isSuperAdmin={isSuperAdmin}
                                        canSeeFinancials={canSeeFinancials}
                                        onClose={() => setSelectedStockDetail(null)}
                                        onEdit={openEditModal}
                                        onDelete={handleDeleteStock}
                                        onRestore={handleRestoreStock}
                                        onRestoreToAvailable={handleQuickRestoreToAvailable}
                                        onChatWA={openWAChat}
                                        onSendWAInvoice={openWAInvoice}
                                    />
                                </div>
                            )}
                            </div>
                        </>

                    ) : isAddingNewStock ? (
                        <div className="rounded-none sm:rounded-2xl border-x-0 sm:border border-y-0 sm:border-y bg-transparent sm:bg-card p-0 sm:p-6 shadow-none sm:shadow-sm text-card-foreground">
                            <h3 className="text-lg font-bold text-foreground mb-6">Add New Stock Unit</h3>

                            <form onSubmit={submitSingle} className="space-y-6">
                                {Object.keys(singleForm.errors).length > 0 && (
                                    <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-xs font-bold text-destructive space-y-1.5">
                                        <p className="text-sm font-bold">Failed to save! Please check the following fields:</p>
                                        {Object.entries(singleForm.errors).map(([key, err]) => (
                                            <div key={key}>• {key}: {err}</div>
                                        ))}
                                    </div>
                                )}
                                {}
                                <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                    <h4 className="text-xs font-bold tracking-wider text-primary">1. Unit Location & Category</h4>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Select Store Branch</label>
                                            <select
                                                required
                                                value={singleForm.data.store_id}
                                                onChange={e => singleForm.setData('store_id', e.target.value)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            >
                                                {singleForm.data.category === 'extra' && (
                                                    <option value="all">All Branches</option>
                                                )}
                                                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Item Category</label>
                                            <select
                                                value={singleForm.data.category}
                                                onChange={e => {
                                                    const cat = e.target.value as any;
                                                    singleForm.setData(data => ({
                                                        ...data,
                                                        category: cat,
                                                        store_id: cat === 'extra' ? 'all' : ((data.store_id === 'all') ? (stores[0]?.id || '') : data.store_id)
                                                    }));
                                                }}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            >
                                                <option value="iphone">iPhone</option>
                                                <option value="android">Android</option>
                                                <option value="accessories">Accessories (Bulk)</option>
                                                <option value="extra">Services / Add-on</option>
                                            </select>
                                        </div>
                                        {singleForm.data.category !== 'extra' && singleCondParam && renderConditionSelect(singleForm, singleCondParam)}
                                        {singleForm.data.category !== 'extra' && !singleCondParam && (
                                            <div>
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">Item Condition</label>
                                                <select
                                                    value={singleForm.data.type}
                                                    onChange={e => singleForm.setData('type', e.target.value as any)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                >
                                                    <option value="new">New</option>
                                                    <option value="second">Pre-owned (Second)</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {}
                                <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                    <h4 className="text-xs font-bold tracking-wider text-primary">2. Specifications & Identity</h4>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                        <div className="sm:col-span-2">
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Product / Service Name</label>
                                            <input
                                                type="text"
                                                required
                                                list="product-names-list"
                                                value={singleForm.data.name}
                                                onChange={e => singleForm.setData('name', e.target.value)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                placeholder="e.g. iPhone 15 Pro Max / IMEI Service"
                                            />
                                        </div>

                                        {singleForm.data.category !== 'accessories' && singleForm.data.category !== 'extra' && (
                                            <>
                                                {singleSpecParams.map(p => renderParamSelect(singleForm, p))}
                                                <div>
                                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Serial Number (SN)</label>
                                                    <input
                                                        type="text"
                                                        value={singleForm.data.serial_number}
                                                        onChange={e => singleForm.setData('serial_number', e.target.value.toUpperCase())}
                                                        className={`w-full rounded-xl border px-3.5 py-2 text-sm font-semibold dark:bg-background ${singleForm.errors.serial_number ? 'border-destructive' : 'border-input'}`}
                                                        placeholder="Serial Number"
                                                    />
                                                    {singleForm.errors.serial_number && <p className="mt-1 text-xs text-destructive">{singleForm.errors.serial_number}</p>}
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-muted-foreground mb-1">IMEI</label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            ref={imeiSingleRef}
                                                            inputMode="numeric"
                                                            value={singleForm.data.imei_1}
                                                            onChange={e => singleForm.setData('imei_1', e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                }
                                                            }}
                                                            className={`flex-1 rounded-xl border px-3.5 py-2 text-sm font-semibold dark:bg-background ${singleForm.errors.imei_1 ? 'border-destructive' : 'border-input'}`}
                                                            placeholder="Scan or type IMEI"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsScannerOpen(true)}
                                                            title="Scan IMEI with Camera"
                                                            className="rounded-xl border border-input bg-muted px-3 py-2 text-muted-foreground hover:bg-accent transition"
                                                        >
                                                            <QrCode className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                    {singleForm.errors.imei_1 && <p className="mt-1 text-xs text-destructive">{singleForm.errors.imei_1}</p>}
                                                    <p className="text-[10px] text-muted-foreground mt-0.5">Click QR icon for camera scan, or focus input for physical barcode reader.</p>
                                                </div>
                                            </>
                                        )}

                                        {}
                                        {singleForm.data.category === 'accessories' && (
                                            singleSpecParams.map(p => renderParamSelect(singleForm, p))
                                        )}
                                    </div>
                                </div>

                                {}
                                <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                    <h4 className="text-xs font-bold tracking-wider text-primary">3. Financial, Warranty & Distribution</h4>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                                        <div className="lg:col-span-2">
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Supplier / Sender</label>
                                            <input
                                                type="text"
                                                value={singleForm.data.supplier}
                                                onChange={e => singleForm.setData('supplier', e.target.value)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                placeholder="e.g. PT Distributor Gadget"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Store Warranty (Days)</label>
                                            <input
                                                type="text"
                                                required
                                                inputMode="numeric"
                                                value={singleForm.data.warranty_duration_days}
                                                onChange={e => singleForm.setData('warranty_duration_days', parseInt(e.target.value) || 0)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            />
                                        </div>
                                        {(singleForm.data.category === 'accessories' || singleForm.data.category === 'extra') && (
                                            <div>
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">Quantity (Stock)</label>
                                                <input
                                                    type="text"
                                                    required
                                                    inputMode="numeric"
                                                    value={singleForm.data.qty}
                                                    onChange={e => singleForm.setData('qty', parseInt(e.target.value) || 1)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                />
                                            </div>
                                        )}
                                        {singleForm.data.category === 'extra' && (
                                            <div className="sm:col-span-2 lg:col-span-2">
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">
                                                    Default Fee Scheme
                                                    <span className="ml-1 normal-case font-normal text-muted-foreground">(auto selected during checkout)</span>
                                                </label>
                                                <select
                                                    value={singleForm.data.default_charge_to}
                                                    onChange={e => singleForm.setData('default_charge_to', e.target.value as any)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                >
                                                    <option value="buyer">Buyer Pays</option>
                                                    <option value="seller">Store Cost (COGS)</option>
                                                    <option value="free_promotion">Free Promotion</option>
                                                </select>
                                                <p className="text-[10px] text-muted-foreground mt-1">This scheme will automatically populate when this service is chosen at checkout.</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Buy Price (COGS)</label>
                                            <input
                                                type="text"
                                                required
                                                inputMode="decimal"
                                                value={singleForm.data.buy_price ?? ''}
                                                onChange={e => singleForm.setData('buy_price', e.target.value === '' ? '' : parseFloat(e.target.value))}
                                                placeholder="Enter buy price"
                                                className={`w-full rounded-xl border px-3.5 py-2 text-sm font-semibold dark:bg-background ${singleForm.errors.buy_price ? 'border-destructive' : 'border-input'}`}
                                            />
                                            {singleForm.errors.buy_price && <p className="mt-1 text-xs text-destructive">{singleForm.errors.buy_price}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Retail Sell Price</label>
                                            <input
                                                type="text"
                                                required
                                                inputMode="decimal"
                                                value={singleForm.data.sell_price ?? ''}
                                                onChange={e => singleForm.setData('sell_price', e.target.value === '' ? '' : parseFloat(e.target.value))}
                                                placeholder="Enter sell price"
                                                className={`w-full rounded-xl border px-3.5 py-2 text-sm font-semibold dark:bg-background ${singleForm.errors.sell_price ? 'border-destructive' : 'border-input'}`}
                                            />
                                            {singleForm.errors.sell_price && <p className="mt-1 text-xs text-destructive">{singleForm.errors.sell_price}</p>}
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-border flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={singleForm.processing}
                                        className="rounded-xl bg-primary px-6 py-3 text-xs font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm"
                                    >
                                        {singleForm.processing ? 'Saving...' : 'Save Stock Unit'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    ) : (
                        <div className="rounded-none sm:rounded-2xl border-x-0 sm:border border-y-0 sm:border-y bg-transparent sm:bg-card p-0 sm:p-6 shadow-none sm:shadow-sm text-card-foreground">
                            <h3 className="text-lg font-bold text-foreground mb-6">Edit Stock Unit</h3>

                            <form onSubmit={submitEdit} className="space-y-6">
                                {}
                                <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                    <h4 className="text-xs font-bold tracking-wider text-primary">1. Unit Location & Category</h4>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Select Store Branch</label>
                                            <select
                                                required
                                                value={editForm.data.store_id}
                                                onChange={e => editForm.setData('store_id', e.target.value)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            >
                                                {editForm.data.category === 'extra' && (
                                                    <option value="all">All Branches</option>
                                                )}
                                                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Item Category</label>
                                            <select
                                                value={editForm.data.category}
                                                onChange={e => {
                                                    const cat = e.target.value as any;
                                                    editForm.setData(data => ({
                                                        ...data,
                                                        category: cat,
                                                        store_id: cat === 'extra' ? 'all' : ((data.store_id === 'all') ? (stores[0]?.id || '') : data.store_id)
                                                    }));
                                                }}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            >
                                                <option value="iphone">iPhone</option>
                                                <option value="android">Android</option>
                                                <option value="accessories">Accessories (Bulk)</option>
                                                <option value="extra">Services / Add-on</option>
                                            </select>
                                        </div>
                                        {editForm.data.category !== 'extra' && editCondParam && renderConditionSelect(editForm, editCondParam)}
                                        {editForm.data.category !== 'extra' && !editCondParam && (
                                            <div>
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">Item Condition</label>
                                                <select
                                                    value={editForm.data.type}
                                                    onChange={e => editForm.setData('type', e.target.value as any)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                >
                                                    <option value="new">New</option>
                                                    <option value="second">Pre-owned (Second)</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {}
                                <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                    <h4 className="text-xs font-bold tracking-wider text-primary">2. Specifications & Identity</h4>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                        <div className="sm:col-span-2">
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Product / Service Name</label>
                                            <input
                                                type="text"
                                                required
                                                list="product-names-list"
                                                value={editForm.data.name}
                                                onChange={e => editForm.setData('name', e.target.value)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                placeholder="e.g. iPhone 15 Pro Max"
                                            />
                                        </div>

                                        {editForm.data.category !== 'accessories' && editForm.data.category !== 'extra' && (
                                            <>
                                                {editSpecParams.map(p => renderParamSelect(editForm, p))}
                                                <div>
                                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Serial Number (SN)</label>
                                                    <input
                                                        type="text"
                                                        value={editForm.data.serial_number}
                                                        onChange={e => editForm.setData('serial_number', e.target.value.toUpperCase())}
                                                        className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-muted-foreground mb-1">IMEI</label>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={editForm.data.imei_1}
                                                        onChange={e => editForm.setData('imei_1', e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                            }
                                                        }}
                                                        className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                    />
                                                </div>
                                            </>
                                        )}

                                        {editForm.data.category === 'accessories' && (
                                            editSpecParams.map(p => renderParamSelect(editForm, p))
                                        )}
                                    </div>
                                </div>

                                {}
                                <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                    <h4 className="text-xs font-bold tracking-wider text-primary">3. Financial, Warranty & Distribution</h4>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                        <div className="lg:col-span-2">
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Supplier / Sender</label>
                                            <input
                                                type="text"
                                                value={editForm.data.supplier}
                                                onChange={e => editForm.setData('supplier', e.target.value)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Store Warranty (Days)</label>
                                            <input
                                                type="number"
                                                required
                                                inputMode="numeric"
                                                value={editForm.data.warranty_duration_days}
                                                onChange={e => editForm.setData('warranty_duration_days', parseInt(e.target.value) || 0)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            />
                                        </div>
                                        {(editForm.data.category === 'accessories' || editForm.data.category === 'extra') && (
                                            <div>
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">Quantity (Stock)</label>
                                                <input
                                                    type="number"
                                                    required
                                                    min={1}
                                                    inputMode="numeric"
                                                    value={editForm.data.qty}
                                                    onChange={e => editForm.setData('qty', parseInt(e.target.value) || 1)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                />
                                            </div>
                                        )}
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Unit Status</label>
                                            <select
                                                value={editForm.data.status}
                                                onChange={e => editForm.setData('status', e.target.value as any)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            >
                                                <option value="available">Available</option>
                                                <option value="transit">Transit / Transfer Proposed</option>
                                                <option value="sold">Sold</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Buy Price (COGS)</label>
                                            <input
                                                type="number"
                                                required
                                                min={0}
                                                inputMode="numeric"
                                                value={editForm.data.buy_price}
                                                onChange={e => editForm.setData('buy_price', parseFloat(e.target.value) || 0)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground mb-1">Standard Sell Price</label>
                                            <input
                                                type="number"
                                                required
                                                min={0}
                                                inputMode="numeric"
                                                value={editForm.data.sell_price}
                                                onChange={e => editForm.setData('sell_price', parseFloat(e.target.value) || 0)}
                                                className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {editForm.data.status === 'sold' && (
                                    <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                        <h4 className="text-xs font-bold tracking-wider text-primary">4. Buyer / Customer Information</h4>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">Buyer Name</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={editForm.data.buyer_name || ''}
                                                    onChange={e => editForm.setData('buyer_name', e.target.value)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                    placeholder="Buyer Name"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">Buyer Phone / WhatsApp</label>
                                                <input
                                                    type="text"
                                                    required
                                                    value={editForm.data.buyer_phone || ''}
                                                    onChange={e => editForm.setData('buyer_phone', e.target.value)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                    placeholder="e.g. 081234567890"
                                                />
                                            </div>
                                            <div className="sm:col-span-2">
                                                <label className="block text-xs font-bold text-muted-foreground mb-1">Buyer Address</label>
                                                <textarea
                                                    value={editForm.data.buyer_address || ''}
                                                    onChange={e => editForm.setData('buyer_address', e.target.value)}
                                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2 text-sm font-semibold dark:bg-background"
                                                    placeholder="Buyer Address (Optional)"
                                                    rows={2}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {editForm.data.status === 'sold' && (
                                    <div className="p-0 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border border-transparent sm:border-border bg-transparent sm:bg-muted/20 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-bold tracking-wider text-primary">5. Manage Sold Add-On Services</h4>
                                        </div>
                                        <p className="text-xs text-muted-foreground">You can change the fee scheme (Buyer/Store/Free), add new add-ons, or remove services from this transaction. Total invoice and profit will be recalculated automatically.</p>

                                        {}
                                        <div className="space-y-2">
                                            {editForm.data.update_extras.length === 0 ? (
                                                <p className="text-xs text-muted-foreground italic">No Add-ons / Services in this transaction.</p>
                                            ) : (
                                                editForm.data.update_extras.map((ex, exIdx) => (
                                                    <div key={exIdx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border border-border bg-card gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const updated = editForm.data.update_extras.filter((_, idx) => idx !== exIdx);
                                                                    editForm.setData('update_extras', updated);
                                                                }}
                                                                className="rounded-lg p-1 text-destructive hover:bg-destructive/10 transition"
                                                                title="Delete this Add-on"
                                                            >
                                                                <Trash className="h-4 w-4" />
                                                            </button>
                                                            <div>
                                                                <span className="text-xs font-bold text-foreground">{ex.name}</span>
                                                                <p className="text-[10px] text-muted-foreground">{formatCurrency(ex.sell_price)}</p>
                                                            </div>
                                                        </div>
                                                        <select
                                                            value={ex.charge_to}
                                                            onChange={(e) => {
                                                                const updated = editForm.data.update_extras.map((item, idx) =>
                                                                    idx === exIdx ? { ...item, charge_to: e.target.value as any } : item
                                                                );
                                                                editForm.setData('update_extras', updated);
                                                            }}
                                                            className="rounded-lg border border-input bg-background px-2.5 py-1 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                                                        >
                                                            <option value="buyer">Buyer Pays</option>
                                                            <option value="seller">Store Cost (COGS)</option>
                                                            <option value="free_promotion">Free Promotion</option>
                                                        </select>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {}
                                        <div className="pt-2">
                                            <label className="block text-[10px] font-extrabold text-muted-foreground mb-1">+ Add New Add-On / Service</label>
                                            <select
                                                value=""
                                                onChange={(e) => {
                                                    const selectedExtraId = parseInt(e.target.value);
                                                    if (!selectedExtraId) return;
                                                    const extraStock = stocks.find(s => s.id === selectedExtraId);
                                                    if (extraStock) {
                                                        const newItem = {
                                                            extra_id: extraStock.id,
                                                            charge_to: ((extraStock as any).default_charge_to || 'buyer') as any,
                                                            sell_price: Number(extraStock.sell_price) || 0,
                                                            buy_price: Number(extraStock.buy_price) || 0,
                                                            name: extraStock.name
                                                        };
                                                        editForm.setData('update_extras', [...editForm.data.update_extras, newItem]);
                                                    }
                                                }}
                                                className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm focus:border-primary focus:outline-none"
                                            >
                                                <option value="">-- Select Add-on to Add --</option>
                                                {stocks
                                                    .filter(s => s.category === 'extra' && s.status === 'available')
                                                    .map(addon => (
                                                        <option key={addon.id} value={addon.id}>
                                                            + {addon.name} ({formatCurrency(addon.sell_price)})
                                                        </option>
                                                    ))
                                                }
                                            </select>
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4 border-t border-border justify-end">
                                    <button type="button" onClick={() => setIsEditingStock(false)} className="rounded-xl border border-input px-6 py-3 text-xs font-semibold text-muted-foreground hover:bg-muted">
                                        Cancel
                                    </button>
                                    <button type="submit" disabled={editForm.processing} className="rounded-xl bg-primary px-6 py-3 text-xs font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm">
                                        {editForm.processing ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    <datalist id="product-names-list">
                        {uniqueProductNames.map(name => (
                            <option key={name} value={name} />
                        ))}
                    </datalist>
                </div>
            </div>

            {}
            {isScannerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl dark:bg-background border dark:border-input space-y-4">
                        <style>{`
                            #reader {
                                width: 100% !important;
                                height: 100% !important;
                            }
                            #reader video {
                                width: 100% !important;
                                height: 100% !important;
                                object-fit: cover !important;
                            }
                            #reader__border_path {
                                stroke: transparent !important;
                            }
                            #reader__scan_region {
                                border: none !important;
                            }
                        `}</style>
                        <div className="flex justify-between items-center">
                            <h4 className="text-xs font-bold text-foreground tracking-wider">Scan IMEI / Barcode</h4>
                            <button
                                type="button"
                                onClick={closeScanner}
                                className="text-muted-foreground hover:text-foreground text-xs font-bold"
                            >
                                Close
                            </button>
                        </div>

                        <p className="text-[10px] text-muted-foreground leading-normal">
                            Point camera at the IMEI barcode. Ensure adequate lighting and align the barcode within the target frame.
                        </p>

                        <div className="relative border border-input rounded-xl overflow-hidden bg-black h-64 sm:h-72 w-full flex items-center justify-center">
                            <div id="reader" className="w-full h-full"></div>

                            {}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                {}
                                <div className="w-[85%] h-[40%] border-2 border-primary rounded-lg relative flex items-center justify-center shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                                    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-primary rounded-tl" />
                                    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-primary rounded-tr" />
                                    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-primary rounded-bl" />
                                    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-primary rounded-br" />

                                    {}
                                    <div className="w-[95%] h-0.5 bg-primary shadow-[0_0_6px_var(--primary)] absolute animate-bounce" />
                                </div>
                            </div>

                            {scannerError && (
                                <div className="absolute inset-0 bg-black/85 flex items-center justify-center p-4 text-center">
                                    <p className="text-xs text-destructive font-bold">{scannerError}</p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={closeScanner}
                                className="w-full rounded-xl border border-input py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}

