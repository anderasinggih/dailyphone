import { useState, useEffect } from 'react';
import {
    CheckCircle2,
    XCircle,
    Play,
    Loader2,
    AlertTriangle,
    FileCode,
    Sparkles,
    Smartphone,
    Wallet,
    Terminal,
    ArrowRight,
    ShoppingBag,
    RotateCcw,
    ShieldAlert,
    PackagePlus,
    Trash2,
    Check,
    ChevronDown,
    ChevronRight,
    FileDiff,
    Layers,
    Edit3,
    MessageSquare
} from 'lucide-react';

export interface ActionProposalData {
    action: string;
    title?: string;
    summary?: string;
    target?: string;
    changes?: Array<{
        field: string;
        old: string | number;
        new: string | number;
    }>;
    payload: Record<string, any>;
}

interface AiActionProposalCardProps {
    proposal: ActionProposalData;
    sessionId: number | null;
    messageId?: string;
    initialStatus?: 'pending' | 'executing' | 'executed' | 'rejected' | null;
    isSuperadmin: boolean;
    onExecuted?: (resultMessage: string) => void;
    onStatusChange?: (newStatus: 'pending' | 'executing' | 'executed' | 'rejected') => void;
    onFeedbackComment?: (defaultText?: string) => void;
}

export default function AiActionProposalCard({
    proposal,
    sessionId,
    messageId,
    initialStatus = 'pending',
    isSuperadmin,
    onExecuted,
    onStatusChange,
    onFeedbackComment
}: AiActionProposalCardProps) {
    const [status, setStatus] = useState<'pending' | 'executing' | 'executed' | 'rejected'>(
        initialStatus || 'pending'
    );
    const [resultMessage, setResultMessage] = useState<string | null>(null);
    const [executionOutput, setExecutionOutput] = useState<string | null>(null);
    const [isChangesExpanded, setIsChangesExpanded] = useState<boolean>(true);
    const [isEditingProposal, setIsEditingProposal] = useState<boolean>(false);
    const [editableChanges, setEditableChanges] = useState<Array<{ field: string; old: string | number; new: string | number }>>(
        proposal.changes || []
    );
    const [editablePayload, setEditablePayload] = useState<Record<string, any>>(
        proposal.payload || {}
    );
    const [isUndoing, setIsUndoing] = useState<boolean>(false);

    // Synchronize if initialStatus prop updates from parent
    useEffect(() => {
        if (initialStatus && initialStatus !== status) {
            setStatus(initialStatus);
        }
    }, [initialStatus]);

    // Update editable copy if proposal changes
    useEffect(() => {
        setEditableChanges(proposal.changes || []);
        setEditablePayload(proposal.payload || {});
    }, [proposal]);

    const syncStatusToServer = async (newStatus: 'pending' | 'rejected') => {
        if (!messageId || !isSuperadmin) return;
        try {
            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';
            await fetch(route('assistant.proposal-status'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
                body: JSON.stringify({
                    message_id: messageId,
                    status: newStatus,
                }),
            });
        } catch (e) {
            console.error('Failed to sync proposal status:', e);
        }
    };

    const handleFieldValueChange = (fieldIndex: number, fieldName: string, newValue: string) => {
        // Update changes array for preview
        const nextChanges = [...editableChanges];
        nextChanges[fieldIndex] = { ...nextChanges[fieldIndex], new: newValue };
        setEditableChanges(nextChanges);

        // Update corresponding payload key if it matches
        const nextPayload = { ...editablePayload };
        const keyMap: Record<string, string> = {
            'Nama Unit': 'name',
            'Harga Jual': 'sell_price',
            'Harga Jual Katalog': 'sell_price',
            'Harga Beli (HPP)': 'buy_price',
            'Harga Beli': 'buy_price',
            'Warna': 'color',
            'Kapasitas Memori': 'memory',
            'Nomor IMEI': 'imei_1',
            'Serial Number': 'serial_number',
            'Tipe Lisensi': 'license',
            'Kondisi': 'type',
            'Masa Garansi': 'warranty_duration_days',
            'Nama Pembeli': 'buyer_name',
            'Nomor HP Pembeli': 'buyer_phone',
            'Alamat Pembeli': 'buyer_address',
            'Metode Pembayaran': 'payment_method',
            'Harga Deal Terjual': 'actual_sell_price',
            'Jumlah Uang': 'amount',
            'Kategori': 'category',
            'Deskripsi': 'description'
        };

        const mappedKey = keyMap[fieldName];
        if (mappedKey) {
            if (['sell_price', 'buy_price', 'actual_sell_price', 'amount', 'warranty_duration_days'].includes(mappedKey)) {
                // Strip currency formatting for number fields
                const cleanNum = parseFloat(newValue.replace(/[^\d.]/g, '')) || 0;
                nextPayload[mappedKey] = cleanNum;
            } else {
                nextPayload[mappedKey] = newValue;
            }
            setEditablePayload(nextPayload);
        }
    };

    const handleUndo = async () => {
        if (!messageId || !isSuperadmin) return;
        if (!confirm('Batalkan (Undo) eksekusi aksi ini dan kembalikan data ke keadaan sebelumnya?')) return;

        setIsUndoing(true);
        try {
            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';
            const res = await fetch(route('assistant.undo'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
                body: JSON.stringify({
                    message_id: messageId,
                }),
            });

            const data = await res.json();
            if (data.success) {
                setStatus('pending');
                onStatusChange?.('pending');
                setResultMessage(null);
                setExecutionOutput(null);
                alert(data.message || 'Eksekusi berhasil di-undo.');
            } else {
                alert(data.message || 'Gagal melakukan undo.');
            }
        } catch (err: any) {
            alert('Kesalahan jaringan: ' + err.message);
        } finally {
            setIsUndoing(false);
        }
    };

    const getActionIcon = () => {
        switch (proposal.action) {
            case 'sell_stock':
                return <ShoppingBag className="h-4 w-4 text-emerald-500" />;
            case 'update_stock':
                return <Smartphone className="h-4 w-4 text-blue-500" />;
            case 'add_stock':
                return <PackagePlus className="h-4 w-4 text-primary" />;
            case 'add_bulk_stock':
                return <PackagePlus className="h-4 w-4 text-emerald-500" />;
            case 'delete_stock':
                return <Trash2 className="h-4 w-4 text-destructive" />;
            case 'delete_all_stocks':
                return <Trash2 className="h-4 w-4 text-destructive" />;
            case 'create_money_note':
                return <Wallet className="h-4 w-4 text-emerald-500" />;
            case 'run_python_script':
                return <Terminal className="h-4 w-4 text-purple-500" />;
            default:
                return <Sparkles className="h-4 w-4 text-primary" />;
        }
    };

    const getActionBadge = () => {
        switch (proposal.action) {
            case 'sell_stock':
                return 'Penjualan Unit (Mark as Sold)';
            case 'update_stock':
                return 'Update Unit / Stok';
            case 'add_stock':
                return 'Tambah Stok Baru (Add Stock)';
            case 'add_bulk_stock':
                return 'Tambah Stok Massal (Bulk Import)';
            case 'delete_stock':
                return 'Hapus Unit (Delete Stock)';
            case 'delete_all_stocks':
                return 'Hapus Semua Unit (Clear Active Inventory)';
            case 'create_money_note':
                return 'Catat Buku Kas (Money Note)';
            case 'run_python_script':
                return 'Eksekusi Kalkulasi';
            default:
                return proposal.action;
        }
    };

    const handleReject = () => {
        setStatus('rejected');
        onStatusChange?.('rejected');
        syncStatusToServer('rejected');
    };

    const handleRevertReject = () => {
        setStatus('pending');
        onStatusChange?.('pending');
        syncStatusToServer('pending');
    };

    const handleAccept = async () => {
        if (!isSuperadmin) return;

        setStatus('executing');
        onStatusChange?.('executing');
        try {
            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';
            const res = await fetch(route('assistant.execute'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
                body: JSON.stringify({
                    action: proposal.action,
                    payload: editablePayload,
                    session_id: sessionId,
                    message_id: messageId,
                }),
            });

            const data = await res.json();
            if (data.success) {
                setStatus('executed');
                onStatusChange?.('executed');
                setIsEditingProposal(false);
                setResultMessage(data.message);
                if (data.output) {
                    setExecutionOutput(data.output);
                }
                if (onExecuted) {
                    onExecuted(data.message);
                }
            } else {
                setStatus('pending');
                onStatusChange?.('pending');
                alert(data.message || 'Gagal mengeksekusi aksi.');
            }
        } catch (err: any) {
            setStatus('pending');
            onStatusChange?.('pending');
            alert('Kesalahan jaringan: ' + err.message);
        }
    };

    const changesCount = editableChanges.length;

    return (
        <div className="my-3 rounded-2xl border border-border/80 bg-background/95 dark:bg-card/90 shadow-md overflow-hidden text-xs transition-all">
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-muted/40 border-b border-border/50">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1 rounded-lg bg-background border border-border/40 shrink-0">
                        {getActionIcon()}
                    </div>
                    <div className="min-w-0">
                        <span className="font-bold text-foreground block truncate">
                            {proposal.title || getActionBadge()}
                        </span>
                        <span className="text-[10px] text-muted-foreground block truncate">
                            {getActionBadge()}
                        </span>
                    </div>
                </div>

                {/* Status Badge */}
                <div>
                    {status === 'pending' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            Pending Review
                        </span>
                    )}
                    {status === 'executing' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary border border-primary/20 flex items-center gap-1">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" /> Executing...
                        </span>
                    )}
                    {status === 'executed' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Applied
                        </span>
                    )}
                    {status === 'rejected' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20 flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> Rejected
                        </span>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="p-3.5 space-y-3">
                {proposal.summary && (
                    <p className="text-muted-foreground leading-relaxed font-normal">
                        {proposal.summary}
                    </p>
                )}

                {proposal.target && (
                    <div className="flex items-center gap-2 p-2 rounded-xl bg-muted/30 border border-border/40 font-mono text-[11px]">
                        <span className="text-muted-foreground">Target:</span>
                        <span className="font-semibold text-foreground truncate">{proposal.target}</span>
                    </div>
                )}

                {/* Antigravity-Style Diff Header Bar */}
                {editableChanges.length > 0 && (
                    <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
                        <div
                            className="flex items-center justify-between px-3 py-2 bg-muted/40 transition select-none"
                        >
                            <div
                                onClick={() => setIsChangesExpanded(!isChangesExpanded)}
                                className="flex items-center gap-2 cursor-pointer flex-1"
                            >
                                {isChangesExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <span className="font-medium text-foreground text-[11px]">
                                    {changesCount} {changesCount > 1 ? 'fields' : 'field'} changed
                                </span>
                                <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+{changesCount}</span>
                                    <span className="text-rose-600 dark:text-rose-400 font-semibold">-{changesCount}</span>
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                {status === 'pending' && onFeedbackComment && (
                                    <button
                                        type="button"
                                        onClick={() => onFeedbackComment(
                                            proposal.action === 'delete_stock'
                                                ? 'Jangan hapus unit ini, tapi '
                                                : 'Tolong ubah '
                                        )}
                                        title="Komentar / beri instruksi revisi ke AI"
                                        className="px-2 py-0.5 rounded text-[10.5px] font-medium bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 transition flex items-center gap-1"
                                    >
                                        <MessageSquare className="h-3 w-3" />
                                        <span>Comment</span>
                                    </button>
                                )}

                                <span className="text-[10px] text-muted-foreground font-mono px-1.5 py-0.5 rounded bg-background/60 border border-border/40">
                                    Review
                                </span>
                            </div>
                        </div>

                        {/* Proposed Changes Table / Diff list */}
                        {isChangesExpanded && (
                            <div className="overflow-x-auto border-t border-border/40 scrollbar-thin">
                                <table className="w-full min-w-[500px] sm:min-w-full text-left text-[11px]">
                                    <thead className="bg-muted/40 text-muted-foreground border-b border-border/30">
                                        <tr>
                                            <th className="px-3 py-2 font-semibold whitespace-nowrap w-2/5">Field</th>
                                            <th className="px-3 py-2 font-semibold whitespace-nowrap w-1/4">Current</th>
                                            <th className="px-3 py-2 font-semibold whitespace-nowrap w-1/3">Proposed</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/20">
                                        {editableChanges.map((c, idx) => (
                                            <tr key={idx} className="hover:bg-muted/20">
                                                <td className="px-3 py-2 font-medium text-foreground flex items-center gap-1.5 whitespace-nowrap">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" />
                                                    <span>{c.field}</span>
                                                </td>
                                                <td className="px-3 py-2 text-muted-foreground line-through decoration-rose-500/50 whitespace-nowrap">
                                                    {String(c.old ?? '-')}
                                                </td>
                                                <td className="px-3 py-2 font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                                    <span className="inline-flex items-center gap-1">
                                                        <ArrowRight className="h-2.5 w-2.5 opacity-60" />
                                                        {String(c.new)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Items Preview if add_bulk_stock */}
                {proposal.action === 'add_bulk_stock' && Array.isArray(editablePayload.items) && editablePayload.items.length > 0 && (
                    <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden space-y-1">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 text-[11px] font-semibold text-foreground">
                            <span>Daftar Unit yang Akan Diimpor ({editablePayload.items.length} unit)</span>
                            <span className="text-[10px] font-mono text-muted-foreground">Bulk Queue</span>
                        </div>
                        <div className="overflow-x-auto max-h-56 scrollbar-thin">
                            <table className="w-full text-left text-[11px]">
                                <thead className="bg-muted/30 text-muted-foreground border-b border-border/30 sticky top-0 backdrop-blur-md">
                                    <tr>
                                        <th className="px-3 py-1.5 font-semibold">#</th>
                                        <th className="px-3 py-1.5 font-semibold">Nama Unit</th>
                                        <th className="px-3 py-1.5 font-semibold">Warna / Memori</th>
                                        <th className="px-3 py-1.5 font-semibold">Lisensi</th>
                                        <th className="px-3 py-1.5 font-semibold text-right">Harga Beli</th>
                                        <th className="px-3 py-1.5 font-semibold text-right">Harga Jual</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/20 font-mono text-[10.5px]">
                                    {editablePayload.items.map((item: any, i: number) => (
                                        <tr key={i} className="hover:bg-muted/30 transition">
                                            <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                                            <td className="px-3 py-1.5 font-sans font-medium text-foreground">{item.name}</td>
                                            <td className="px-3 py-1.5 text-muted-foreground">{[item.color, item.memory].filter(Boolean).join(' • ') || '-'}</td>
                                            <td className="px-3 py-1.5 text-muted-foreground">{item.license || 'iBox'}</td>
                                            <td className="px-3 py-1.5 text-right text-muted-foreground">Rp {Number(item.buy_price || 0).toLocaleString('id-ID')}</td>
                                            <td className="px-3 py-1.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">Rp {Number(item.sell_price || 0).toLocaleString('id-ID')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}



                {/* Output log if executed */}
                {executionOutput && (
                    <div className="space-y-1 pt-1 border-t border-border/40">
                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Output:
                        </span>
                        <pre className="p-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] overflow-x-auto">
                            {executionOutput}
                        </pre>
                    </div>
                )}

                {/* Success Message Banner */}
                {resultMessage && status === 'executed' && (
                    <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>{resultMessage}</span>
                    </div>
                )}

                {/* Action Bar when Executing: Clean bottom executing progress */}
                {status === 'executing' && (
                    <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-primary font-medium text-[11px]">
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-primary" />
                            <span>Mengeksekusi aksi ke database...</span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 animate-pulse">
                            Processing
                        </span>
                    </div>
                )}

                {/* Antigravity-Style Action Bar when Pending */}
                {status === 'pending' && (
                    <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                        <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-primary" />
                            <span>{changesCount} {changesCount > 1 ? 'changes pending' : 'change pending'}</span>
                        </div>

                        {isSuperadmin ? (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleReject}
                                    className="px-3 py-1.5 rounded-xl border border-border/70 hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-600 text-foreground text-xs font-semibold transition"
                                >
                                    Reject
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAccept}
                                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold active:scale-[0.97] transition shadow-xs flex items-center gap-1.5"
                                >
                                    <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                                    Accept
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] italic">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                <span>Approval requires Superadmin privileges.</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Antigravity-Style Status Bar when Executed: Shows Accepted pill + Undo Button */}
                {status === 'executed' && (
                    <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Changes applied</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {isSuperadmin && messageId && (
                                <button
                                    type="button"
                                    onClick={handleUndo}
                                    disabled={isUndoing}
                                    title="Undo action"
                                    className="px-2.5 py-1 rounded-lg border border-border/70 bg-background hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-600 text-foreground font-semibold text-[10.5px] flex items-center gap-1 transition shadow-2xs"
                                >
                                    {isUndoing ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <RotateCcw className="h-3 w-3 text-muted-foreground" />
                                    )}
                                    <span>Undo</span>
                                </button>
                            )}
                            <div className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10.5px] font-semibold flex items-center gap-1">
                                <Check className="h-3 w-3 stroke-[2.5]" />
                                Accepted
                            </div>
                        </div>
                    </div>
                )}

                {/* Antigravity-Style Footer when Rejected */}
                {status === 'rejected' && isSuperadmin && (
                    <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-rose-500/90 italic flex items-center gap-1">
                            <XCircle className="h-3.5 w-3.5 shrink-0" /> Proposal rejected.
                        </span>
                        <button
                            type="button"
                            onClick={handleRevertReject}
                            className="px-2.5 py-1 rounded-lg border border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-[11px] flex items-center gap-1 transition shadow-2xs"
                        >
                            <RotateCcw className="h-3 w-3" />
                            <span>Reset</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
