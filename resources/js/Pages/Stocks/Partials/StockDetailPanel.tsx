import React from 'react';
import { MessageCircle, Send, ExternalLink, RotateCcw } from 'lucide-react';

export interface StockItemDetail {
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
    created_at?: string;
    deleted_at?: string | null;
    store?: { name: string };
    brand?: { value: string };
    color?: { value: string };
    memory?: { value: string };
    license?: { value: string };
    parameterValues?: Array<{
        id: number;
        parameter_id: number;
        value_id: number;
        value?: { value: string };
        parameter?: { name: string; category: string };
    }>;
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

interface StockDetailPanelProps {
    stock: StockItemDetail;
    isSuperAdmin: boolean;
    canSeeFinancials: boolean;
    onClose: () => void;
    onEdit: (stock: StockItemDetail) => void;
    onDelete: (id: number) => void;
    onRestore: (id: number) => void;
    onRestoreToAvailable: (stock: StockItemDetail) => void;
    onChatWA: (phone: string, name: string) => void;
    onSendWAInvoice: (phone: string, name: string, invoiceNumber: string, total?: number) => void;
}

export default function StockDetailPanel({
    stock,
    isSuperAdmin,
    canSeeFinancials,
    onClose,
    onEdit,
    onDelete,
    onRestore,
    onRestoreToAvailable,
    onChatWA,
    onSendWAInvoice,
}: StockDetailPanelProps) {
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    return (
        <div className="apple-card p-6 text-card-foreground space-y-6">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
                <h3 className="text-sm font-semibold text-foreground">Unit Detail</h3>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-muted-foreground hover:text-foreground p-1 hover:bg-muted rounded-lg text-sm transition"
                >
                    ✕
                </button>
            </div>

            <div>
                <h4 className="text-base font-bold text-foreground">{stock.name}</h4>
                <div className="flex items-center gap-2 mt-1.5 text-xs">
                    <span className="font-semibold text-primary capitalize">{stock.type}</span>
                    <span>•</span>
                    {stock.deleted_at ? (
                        <span className="font-semibold text-destructive">Deleted</span>
                    ) : (
                        <span className={`font-semibold capitalize ${stock.status === 'available' ? 'text-primary' : 'text-muted-foreground'}`}>
                            {stock.status}
                        </span>
                    )}
                </div>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground">
                <div className="flex justify-between border-b border-border/40 pb-2">
                    <span>Branch</span>
                    <span className="font-semibold text-foreground">{stock.store?.name || 'Main Warehouse'}</span>
                </div>
                <div className="flex justify-between border-b border-border/40 pb-2">
                    <span>Category</span>
                    <span className="capitalize text-foreground">{stock.category === 'extra' ? 'Add-On / Services' : stock.category}</span>
                </div>
                {stock.category !== 'extra' && (
                    <>
                        <div className="flex justify-between border-b border-border/40 pb-2">
                            <span>Specification</span>
                            <span className="text-foreground">
                                {stock.memory?.value || '-'} / {stock.color?.value || '-'}
                            </span>
                        </div>
                        <div className="flex justify-between border-b border-border/40 pb-2">
                            <span>License</span>
                            <span className="text-foreground">{stock.license?.value || '-'}</span>
                        </div>
                        <div className="flex justify-between border-b border-border/40 pb-2">
                            <span>Serial Number</span>
                            <span className="font-mono text-foreground">{stock.serial_number || '-'}</span>
                        </div>
                        {stock.imei_1 && (
                            <div className="flex justify-between border-b border-border/40 pb-2">
                                <span>IMEI</span>
                                <span className="font-mono text-foreground">{stock.imei_1}</span>
                            </div>
                        )}
                        {(stock.parameterValues || []).filter(pv => {
                            const n = (pv.parameter?.name || '').toLowerCase();
                            const skippable = ['brand', 'merek', 'color', 'warna', 'memory', 'memori', 'storage', 'capacity', 'license', 'lisensi', 'licence', 'condition'];
                            return !skippable.some(k => n.includes(k)) && pv.value?.value;
                        }).map(pv => (
                            <div key={pv.id} className="flex justify-between border-b border-border/40 pb-2">
                                <span>{pv.parameter?.name || 'Spec'}</span>
                                <span className="text-foreground">{pv.value?.value}</span>
                            </div>
                        ))}
                    </>
                )}

                {canSeeFinancials && (
                    <div className="flex justify-between border-b border-border/40 pb-2">
                        <span className="text-primary font-medium">COGS (Buy Price)</span>
                        <span className="font-semibold text-primary">{formatCurrency(stock.buy_price)}</span>
                    </div>
                )}

                <div className="flex justify-between border-b border-border/40 pb-2">
                    <span>Standard Sell Price</span>
                    <span className="font-semibold text-foreground">{formatCurrency(stock.sell_price)}</span>
                </div>

                {canSeeFinancials && stock.status !== 'sold' && (
                    <div className="flex justify-between border-b border-border/40 pb-2">
                        <span>Expected Margin</span>
                        <span className="font-semibold text-foreground">
                            {formatCurrency((stock.sell_price - stock.buy_price) * stock.qty)}
                        </span>
                    </div>
                )}

                {isSuperAdmin && stock.supplier && (
                    <div className="flex justify-between border-b border-border/40 pb-2">
                        <span>Supplier</span>
                        <span className="text-foreground">{stock.supplier}</span>
                    </div>
                )}

                <div className="flex justify-between border-b border-border/40 pb-2">
                    <span>Store Warranty</span>
                    <span className="text-foreground">{stock.warranty_duration_days} Days</span>
                </div>

                <div className="flex justify-between border-b border-border/40 pb-2">
                    <span>Added By</span>
                    <span className="text-foreground font-semibold">
                        {stock.created_by ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] ${
                                stock.created_by.includes('(AI)')
                                    ? 'bg-primary/10 text-primary border border-primary/20 font-bold'
                                    : 'bg-muted text-foreground'
                            }`}>
                                {stock.created_by}
                            </span>
                        ) : '-'}
                    </span>
                </div>
            </div>

            {stock.status === 'sold' && stock.sale_items?.[0] && (
                <div className="p-4 rounded-xl border border-border bg-muted/30 space-y-3">
                    <h5 className="text-xs font-semibold text-primary">Sale Transaction Details</h5>

                    {(() => {
                        const sItem = stock.sale_items[0];
                        const sale = sItem.sale;
                        const actPrice = sItem.actual_sell_price ? parseFloat(sItem.actual_sell_price as any) : 0;
                        const affFee = sale?.affiliate_fee ? parseFloat(sale.affiliate_fee as any) : 0;
                        const buyPr = stock.buy_price ? parseFloat(stock.buy_price as any) : 0;
                        const extrasProfit = sale?.extras
                            ? sale.extras.reduce((acc, curr) => {
                                const sell = parseFloat(curr.sell_price as any) || 0;
                                const buy = parseFloat(curr.buy_price as any) || 0;
                                return curr.charge_to === 'buyer' ? acc + (sell - buy) : acc - buy;
                            }, 0)
                            : 0;
                        const netProf = actPrice > 0 ? (actPrice - buyPr - affFee + extrasProfit) : 0;
                        const buyerPhone = (sale?.buyer as any)?.phone || '';
                        const buyerName = sale?.buyer?.name || '';
                        const invoiceNumber = sale?.invoice_number || '';

                        return (
                            <div className="space-y-2 text-xs text-muted-foreground">
                                <div className="flex justify-between">
                                    <span>Invoice No.</span>
                                    <span className="font-mono font-semibold text-foreground">{invoiceNumber || '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Date Sold</span>
                                    <span className="text-foreground">
                                        {sale?.created_at ? new Date(sale.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Customer Name</span>
                                    <span className="text-foreground font-semibold">{buyerName || '-'}</span>
                                </div>
                                {isSuperAdmin && (
                                    <>
                                        <div className="flex justify-between">
                                            <span>Actual Sell Price</span>
                                            <span className="text-foreground font-semibold">{formatCurrency(actPrice)}</span>
                                        </div>
                                        {sale?.extras && sale.extras.length > 0 && (
                                            <div className="border-y border-border/40 py-1.5 my-1 space-y-1">
                                                <span className="text-[11px] text-muted-foreground font-semibold">Add-On Services</span>
                                                {sale.extras.map((ex, exIdx) => (
                                                    <div key={exIdx} className="flex justify-between pl-2 text-[11px]">
                                                        <span>• {ex.extra?.name || 'Service'} ({ex.charge_to.replace('_', ' ')})</span>
                                                        <span className="text-foreground font-medium">{formatCurrency(Number(ex.sell_price))}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex justify-between">
                                            <span>Affiliate Commission</span>
                                            <span className="text-foreground font-semibold">{formatCurrency(affFee)}</span>
                                        </div>
                                        <div className="flex justify-between border-t border-border/40 pt-1.5 mt-1.5">
                                            <span className="text-primary font-semibold">Net Profit</span>
                                            <span className="text-primary font-bold">{formatCurrency(netProf)}</span>
                                        </div>
                                    </>
                                )}

                                {buyerPhone && (
                                    <div className="flex gap-2 pt-2 border-t border-border/40">
                                        <button
                                            type="button"
                                            onClick={() => onChatWA(buyerPhone, buyerName)}
                                            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-muted py-2 text-xs font-semibold text-foreground hover:bg-muted/80 transition"
                                        >
                                            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                                        </button>
                                        {invoiceNumber && (
                                            <button
                                                type="button"
                                                onClick={() => onSendWAInvoice(buyerPhone, buyerName, invoiceNumber, actPrice || undefined)}
                                                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
                                            >
                                                <Send className="h-3.5 w-3.5" /> Send Invoice
                                            </button>
                                        )}
                                    </div>
                                )}
                                {invoiceNumber && (
                                    <a
                                        href={`/invoice/${invoiceNumber}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-1.5 w-full rounded-xl border border-border py-2 text-xs font-semibold text-primary hover:bg-primary/5 transition"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" /> View Invoice
                                    </a>
                                )}
                            </div>
                        );
                    })()}
                </div>
            )}

            {isSuperAdmin && (
                <div className="space-y-2 pt-4 border-t border-border/40">
                    {stock.status === 'sold' && !stock.deleted_at && (
                        <button
                            type="button"
                            onClick={() => onRestoreToAvailable(stock)}
                            className="w-full rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition flex items-center justify-center gap-1.5"
                        >
                            <RotateCcw className="h-4 w-4" /> Return to Available Stock
                        </button>
                    )}
                    <div className="flex gap-2">
                        {stock.deleted_at ? (
                            <button
                                type="button"
                                onClick={() => onRestore(stock.id)}
                                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
                            >
                                Restore Unit
                            </button>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => onEdit(stock)}
                                    className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
                                >
                                    Edit Unit
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onDelete(stock.id)}
                                    className="flex-1 rounded-xl bg-destructive py-2.5 text-xs font-semibold text-destructive-foreground hover:opacity-90 transition"
                                >
                                    Delete Unit
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
