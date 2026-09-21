import { useState, useEffect, useRef } from 'react';
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
    MessageSquare,
    Download,
    FileSpreadsheet,
    FileText,
    FileImage,
} from 'lucide-react';
import { diffLines, diffStatsOf, DiffLine } from '@/lib/diff';

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

export interface GeneratedProjectFileNode {
    id: number;
    name: string;
    is_folder: boolean;
    kind: string;
    mime_type?: string | null;
    size_bytes?: number;
    created_at?: string;
    updated_at?: string;
    change_type?: 'created' | 'modified' | null;
}

export interface GeneratedFile {
    name: string;
    path: string;
    mime: string;
    size: number;
    url: string;
    content?: string | null;
    previous_content?: string | null;
    project_file?: GeneratedProjectFileNode;
}

interface AiActionProposalCardProps {
    proposal: ActionProposalData;
    sessionId: number | null;
    messageId?: string;
    initialStatus?: 'pending' | 'executing' | 'executed' | 'rejected' | null;
    isSuperadmin: boolean;
    projectId?: number | null;
    onExecuted?: (resultMessage: string) => void;
    onStatusChange?: (newStatus: 'pending' | 'executing' | 'executed' | 'rejected') => void;
    onFeedbackComment?: (defaultText?: string) => void;
    onFilesSaved?: (files: GeneratedFile[]) => void;
    onFileRejected?: (file: GeneratedFile, node: GeneratedProjectFileNode) => void;
    onFileAccepted?: (file: GeneratedFile) => void;
    autoExecute?: boolean;
}

interface FileReviewState {
    [path: string]: 'pending' | 'accepted' | 'rejected';
}

interface FileDiffState {
    [path: string]: DiffLine[];
}

export default function AiActionProposalCard({
    proposal,
    sessionId,
    messageId,
    initialStatus = 'pending',
    isSuperadmin,
    projectId = null,
    onExecuted,
    onStatusChange,
    onFeedbackComment,
    onFilesSaved,
    onFileRejected,
    onFileAccepted,
    autoExecute = false,
}: AiActionProposalCardProps) {
    const [status, setStatus] = useState<'pending' | 'executing' | 'executed' | 'rejected'>(
        initialStatus || 'pending'
    );
    const [resultMessage, setResultMessage] = useState<string | null>(null);
    const [executionOutput, setExecutionOutput] = useState<string | null>(null);
    const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
    const [isChangesExpanded, setIsChangesExpanded] = useState<boolean>(true);
    const [isEditingProposal, setIsEditingProposal] = useState<boolean>(false);
    const [editableChanges, setEditableChanges] = useState<Array<{ field: string; old: string | number; new: string | number }>>(
        proposal.changes || []
    );
    const [editablePayload, setEditablePayload] = useState<Record<string, any>>(
        proposal.payload || {}
    );
    const [isUndoing, setIsUndoing] = useState<boolean>(false);
    const [fileReview, setFileReview] = useState<FileReviewState>({});
    const [fileDiffs, setFileDiffs] = useState<FileDiffState>({});
    const [expandedFile, setExpandedFile] = useState<string | null>(null);
    const [isRejectingFile, setIsRejectingFile] = useState<string | null>(null);
    const autoExecutedRef = useRef(false);

    const isFileScript = proposal.action === 'run_python_script';

    // Synchronize if initialStatus prop updates from parent
    useEffect(() => {
        if (initialStatus && initialStatus !== status) {
            setStatus(initialStatus);
        }
    }, [initialStatus]);

    // Auto-execute file-generating scripts every time a pending proposal becomes
    // the active message, so the diff shows up as soon as the chat lands.
    useEffect(() => {
        const shouldAuto =
            autoExecute &&
            isFileScript &&
            status === 'pending' &&
            isSuperadmin &&
            !autoExecutedRef.current;
        if (shouldAuto) {
            autoExecutedRef.current = true;
            handleAccept();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoExecute, isFileScript, status, isSuperadmin]);

    // Update editable copy if proposal changes
    useEffect(() => {
        setEditableChanges(proposal.changes || []);
        setEditablePayload(proposal.payload || {});
    }, [proposal]);

    // Compute an old→new diff for every generated file that has readable text,
    // so the executed card can render "N files changed" like an IDE review.
    useEffect(() => {
        if (generatedFiles.length === 0) return;
        setFileDiffs(prev => {
            const next = { ...prev };
            for (const f of generatedFiles) {
                if (next[f.path]) continue;
                next[f.path] = diffLines(f.previous_content ?? null, f.content ?? '');
            }
            return next;
        });
        setFileReview(prev => {
            const next = { ...prev };
            for (const f of generatedFiles) {
                if (!next[f.path]) next[f.path] = 'pending';
            }
            return next;
        });
    }, [generatedFiles]);

    const handleAcceptFile = async (file: GeneratedFile) => {
        // The artifact is already persisted; accepting only keeps it in the
        // project tree (no deletion).
        setFileReview(prev => ({ ...prev, [file.path]: 'accepted' }));
        onFileAccepted?.(file);
    };

    const handleRejectFile = async (file: GeneratedFile) => {
        const node = file.project_file;
        if (!node || !projectId) {
            setFileReview(prev => ({ ...prev, [file.path]: 'rejected' }));
            return;
        }
        setIsRejectingFile(file.path);
        try {
            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '';
            const res = await fetch(route('assistant.project.files.destroy', [projectId, node.id]), {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
            });
            const data = await res.json();
            if (data.success) {
                setFileReview(prev => ({ ...prev, [file.path]: 'rejected' }));
                onFileRejected?.(file, node);
            } else {
                alert(data.message || 'Gagal menolak file.');
            }
        } catch (err: any) {
            alert('Kesalahan jaringan: ' + err.message);
        } finally {
            setIsRejectingFile(null);
        }
    };

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
            'Unit Name': 'name',
            'Harga Jual': 'sell_price',
            'Harga Jual Katalog': 'sell_price',
            'Selling Price': 'sell_price',
            'Harga Beli (HPP)': 'buy_price',
            'Harga Beli': 'buy_price',
            'Buy Price': 'buy_price',
            'HPP': 'buy_price',
            'Warna': 'color',
            'Color': 'color',
            'Kapasitas Memori': 'memory',
            'Memori': 'memory',
            'Memory': 'memory',
            'Storage': 'memory',
            'Brand': 'brand',
            'Merek': 'brand',
            'Nomor IMEI': 'imei_1',
            'IMEI': 'imei_1',
            'IMEI 1': 'imei_1',
            'Serial Number': 'serial_number',
            'Serial Number (SN)': 'serial_number',
            'SN': 'serial_number',
            'Tipe Lisensi': 'license',
            'Lisensi': 'license',
            'License': 'license',
            'Kondisi': 'type',
            'Condition': 'type',
            'Tipe': 'type',
            'Supplier': 'supplier',
            'Supplier / Distributor': 'supplier',
            'Distributor': 'supplier',
            'Pemasok': 'supplier',
            'Masa Garansi': 'warranty_duration_days',
            'Garansi Toko': 'warranty_duration_days',
            'Garansi Toko (Hari)': 'warranty_duration_days',
            'Garansi': 'warranty_duration_days',
            'Warranty': 'warranty_duration_days',
            'Lokasi': 'store_name',
            'Lokasi Toko': 'store_name',
            'Lokasi Cabang': 'store_name',
            'Cabang': 'store_name',
            'Store': 'store_name',
            'Nama Pembeli': 'buyer_name',
            'Nomor HP Pembeli': 'buyer_phone',
            'Alamat Pembeli': 'buyer_address',
            'Metode Pembayaran': 'payment_method',
            'Harga Deal Terjual': 'actual_sell_price',
            'Jumlah Uang': 'amount',
            'Kategori': 'category',
            'Category': 'category',
            'Deskripsi': 'description',
            'Status': 'status',
            'Status Unit': 'status',
            'Status Stok': 'status'
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
            case 'empty_trash':
                return <Trash2 className="h-4 w-4 text-destructive animate-pulse" />;
            case 'create_money_note':
                return <Wallet className="h-4 w-4 text-emerald-500" />;
            case 'add_parameter':
                return <Layers className="h-4 w-4 text-primary" />;
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
            case 'empty_trash':
                return 'HAPUS PERMANEN (Kosongkan Trash)';
            case 'create_money_note':
                return 'Catat Buku Kas (Money Note)';
            case 'add_parameter':
                return 'Tambah Master Parameter (Add)';
            case 'run_python_script':
                return 'Generate File / Eksekusi Python';
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

        if (proposal.action === 'empty_trash') {
            const confirmed = window.confirm(
                '⚠️ PERINGATAN KERAS: Aksi ini akan MENGHAPUS PERMANEN seluruh unit di keranjang sampah!\n\nData yang dihapus permanen TIDAK DAPAT dipulihkan atau di-Undo.\n\nApakah Anda yakin ingin melanjutkan?'
            );
            if (!confirmed) return;
        }

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
                if (Array.isArray(data.files) && data.files.length > 0) {
                    setGeneratedFiles(data.files);
                    if (onFilesSaved) {
                        onFilesSaved(data.files);
                    }
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

    const fileIcon = (name: string) => {
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        if (['xlsx', 'xls', 'csv'].includes(ext)) {
            return <FileSpreadsheet className="h-4 w-4 text-emerald-500" />;
        }
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
            return <FileImage className="h-4 w-4 text-blue-500" />;
        }
        if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) {
            return <FileText className="h-4 w-4 text-primary" />;
        }
        return <FileCode className="h-4 w-4 text-muted-foreground" />;
    };

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
            <div className="p-4 space-y-3">
                {proposal.action === 'empty_trash' && (
                    <div className="flex items-start gap-2.5 text-destructive text-[11px] font-medium">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold">PERINGATAN HAPUS PERMANEN:</span>
                            <span className="ml-1 text-destructive/90">Data di keranjang sampah akan dihapus selamanya dari database dan tidak dapat di-Undo.</span>
                        </div>
                    </div>
                )}

                {proposal.summary && (
                    <p className="text-muted-foreground leading-relaxed font-normal">
                        {proposal.summary}
                    </p>
                )}

                {proposal.target && (
                    <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-1.5">
                        <span className="text-muted-foreground/60">Target:</span>
                        <span className="font-semibold text-foreground">{proposal.target}</span>
                    </div>
                )}

                {/* Streamlined Changes Table without nested container box */}
                {!isFileScript && editableChanges.length > 0 && (
                    <div className="pt-2 border-t border-border/40 space-y-2">
                        <div
                            onClick={() => setIsChangesExpanded(!isChangesExpanded)}
                            className="flex items-center justify-between cursor-pointer py-0.5 select-none text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                {isChangesExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                )}
                                <span className="font-medium text-[11px] text-foreground">
                                    {changesCount} {changesCount > 1 ? 'fields' : 'field'} changed
                                </span>
                                <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                                    <span className="text-emerald-500 font-semibold">+{changesCount}</span>
                                    <span className="text-rose-500 font-semibold">-{changesCount}</span>
                                </span>
                            </div>

                            {status === 'pending' && onFeedbackComment && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onFeedbackComment(
                                            proposal.action === 'delete_stock'
                                                ? 'Jangan hapus unit ini, tapi '
                                                : 'Tolong ubah '
                                        );
                                    }}
                                    title="Komentar / beri instruksi revisi ke AI"
                                    className="px-2 py-0.5 rounded text-[10.5px] font-medium hover:bg-muted text-muted-foreground hover:text-foreground transition flex items-center gap-1"
                                >
                                    <MessageSquare className="h-3 w-3" />
                                    <span>Comment</span>
                                </button>
                            )}
                        </div>

                        {/* Flat Changes Table */}
                        {isChangesExpanded && (
                            <div className="overflow-x-auto scrollbar-thin">
                                <table className="w-full text-left text-[11px]">
                                    <thead className="text-muted-foreground border-b border-border/30">
                                        <tr>
                                            <th className="py-1.5 font-semibold w-2/5">Field</th>
                                            <th className="py-1.5 font-semibold w-1/4">Current</th>
                                            <th className="py-1.5 font-semibold w-1/3">Proposed</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/20">
                                        {editableChanges.map((c, idx) => (
                                            <tr key={idx} className="hover:bg-muted/10">
                                                <td className="py-1.5 font-medium text-foreground">
                                                    {c.field}
                                                </td>
                                                <td className="py-1.5 text-muted-foreground line-through opacity-70">
                                                    {String(c.old ?? '-')}
                                                </td>
                                                <td className="py-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
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

                {/* Generated files (downloadable artifacts from run_python_script). For file
                scripts the executed card renders an IDE-style "Files changed"
                review list with a per-file diff and Accept / Reject controls. */}
                {generatedFiles.length > 0 && isFileScript && status === 'executed' && (
                    <div className="space-y-2 pt-2 border-t border-border/40">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-foreground">
                                <FileDiff className="h-3 w-3 text-primary" />
                                <span>{generatedFiles.length} {generatedFiles.length > 1 ? 'files' : 'file'} changed</span>
                            </div>
                            <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                                <span className="text-emerald-500 font-semibold">+{generatedFiles.reduce((n, f) => n + diffStatsOf(fileDiffs[f.path] || []).additions, 0)}</span>
                                <span className="text-rose-500 font-semibold">−{generatedFiles.reduce((n, f) => n + diffStatsOf(fileDiffs[f.path] || []).deletions, 0)}</span>
                            </span>
                        </div>

                        {generatedFiles.map((f) => {
                            const diff = fileDiffs[f.path] || [];
                            const review = fileReview[f.path] || 'pending';
                            return (
                                <div key={f.path} className="rounded-xl border border-border/60 bg-muted/15 overflow-hidden">
                                    {/* File row header */}
                                    <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/40">
                                        <button
                                            type="button"
                                            onClick={() => setExpandedFile(expandedFile === f.path ? null : f.path)}
                                            className="flex items-center gap-1.5 min-w-0 flex-1 text-left group"
                                            title={expandedFile === f.path ? 'Collapse diff' : 'Expand diff'}
                                        >
                                            {expandedFile === f.path ? (
                                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            ) : (
                                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                            )}
                                            <span className="shrink-0">{fileIcon(f.name)}</span>
                                            <span className="truncate font-medium text-[11px] text-foreground group-hover:text-primary transition-colors">
                                                {f.name}
                                            </span>
                                            <span className="inline-flex items-center gap-1 font-mono text-[9.5px] shrink-0">
                                                <span className="text-emerald-500">+{diffStatsOf(diff).additions}</span>
                                                <span className="text-rose-500">−{diffStatsOf(diff).deletions}</span>
                                            </span>
                                        </button>

                                        <a
                                            href={f.url}
                                            download
                                            title={`Download ${f.name}`}
                                            className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition"
                                        >
                                            <Download className="h-3 w-3" />
                                        </a>

                                        {/* Per-file review controls */}
                                        {review === 'accepted' && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[9.5px] font-semibold shrink-0">
                                                <Check className="h-2.5 w-2.5" /> Accepted
                                            </span>
                                        )}
                                        {review === 'rejected' && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[9.5px] font-semibold shrink-0">
                                                <XCircle className="h-2.5 w-2.5" /> Rejected
                                            </span>
                                        )}
                                        {review === 'pending' && isSuperadmin && (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => handleRejectFile(f)}
                                                    disabled={isRejectingFile === f.path}
                                                    title="Reject this file (remove from project)"
                                                    className="px-1.5 py-0.5 rounded-md border border-border/70 hover:bg-rose-500/10 hover:border-rose-500/30 hover:text-rose-600 text-foreground text-[9.5px] font-semibold transition"
                                                >
                                                    {isRejectingFile === f.path ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Reject'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleAcceptFile(f)}
                                                    title="Accept this file (keep in project)"
                                                    className="px-1.5 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[9.5px] font-semibold active:scale-95 transition flex items-center gap-0.5"
                                                >
                                                    <Check className="h-2.5 w-2.5" /> Accept
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Diff preview */}
                                    {expandedFile === f.path && (
                                        <div className="overflow-x-auto scrollbar-thin bg-[#0b0b0d]/70 max-h-60">
                                            {diff.length > 0 ? (
                                                <pre className="font-mono text-[10px] leading-[1.5] text-foreground p-0">
                                                    {diff.map((line, i) => (
                                                        <div
                                                            key={i}
                                                            className={`flex px-2 ${
                                                                line.type === 'add' ? 'bg-emerald-500/[0.08]' :
                                                                line.type === 'del' ? 'bg-rose-500/[0.08]' :
                                                                'hover:bg-muted/20'
                                                            }`}
                                                        >
                                                            <span className={`w-7 pr-2 text-right shrink-0 select-none ${line.type === 'add' ? 'text-emerald-500' : line.type === 'del' ? 'text-rose-500' : 'text-muted-foreground/60'}`}>
                                                                {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                                                            </span>
                                                            <span className="w-9 pr-3 shrink-0 select-none text-right text-muted-foreground/50">
                                                                {line.type === 'add' ? (line.newLine ?? '') : line.type === 'del' ? (line.oldLine ?? '') : line.oldLine ?? line.newLine ?? ''}
                                                            </span>
                                                            <code className="whitespace-pre flex-1 pr-3">{line.value || ' '}</code>
                                                        </div>
                                                    ))}
                                                </pre>
                                            ) : (
                                                <div className="px-3 py-2 text-[10px] text-muted-foreground">
                                                    No text diff available for this file type.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Generated files (downloadable artifacts from run_python_script) */}
                {generatedFiles.length > 0 && (!isFileScript || status !== 'executed') && (
                    <div className="space-y-1.5 pt-2 border-t border-border/40">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <Download className="h-3 w-3" />
                            <span>Generated files ({generatedFiles.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {generatedFiles.map((f) => (
                                <a
                                    key={f.path}
                                    href={f.url}
                                    title={`Download ${f.name}`}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-border/70 bg-muted/20 hover:bg-primary/10 hover:border-primary/30 hover:text-primary text-foreground font-medium text-[11px] transition group max-w-full"
                                >
                                    {fileIcon(f.name)}
                                    <span className="max-w-[180px] truncate">{f.name}</span>
                                    {f.project_file && (
                                        <span
                                            title="Saved into this project's file tree"
                                            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[9px] font-semibold shrink-0"
                                        >
                                            <Check className="h-2.5 w-2.5" /> In project
                                        </span>
                                    )}
                                    <span className="text-[9.5px] font-mono text-muted-foreground shrink-0">
                                        {(f.size / 1024).toFixed(1)} KB
                                    </span>
                                    <Download className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0" />
                                </a>
                            ))}
                        </div>
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
                            <span>{isFileScript ? 'Running script and generating files…' : 'Mengeksekusi aksi ke database...'}</span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 animate-pulse">
                            Processing
                        </span>
                    </div>
                )}

                {/* Antigravity-Style Action Bar when Pending */}
                {status === 'pending' && isFileScript && (
                    <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
                        <div className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                            <Terminal className="h-3.5 w-3.5 text-primary" />
                            <span>{autoExecute && isSuperadmin ? 'Script will run automatically…' : 'Awaiting execution…'}</span>
                        </div>
                        {!isSuperadmin && (
                            <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] italic">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                <span>Approval requires Superadmin privileges.</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Antigravity-Style Action Bar when Pending */}
                {status === 'pending' && !isFileScript && (
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
                            <span>{isFileScript ? 'Files generated' : 'Changes applied'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {isSuperadmin && messageId && !isFileScript && (
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
