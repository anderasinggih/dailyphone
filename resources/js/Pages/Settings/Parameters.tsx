import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, router, Link } from '@inertiajs/react';
import { useState } from 'react';
import { Settings, Plus, Trash2, Tag, Check, Pencil, X, ChevronLeft, Sliders } from 'lucide-react';

interface ParameterValue {
    id: number;
    value: string;
    color?: string | null;
    is_active: boolean;
}

interface Parameter {
    id: number;
    name: string;
    category: string;
    values: ParameterValue[];
}

interface ParametersProps {
    parameters?: Parameter[];
}

const COLOR_OPTIONS = [
    { key: 'blue', label: 'Blue', bgClass: 'bg-blue-500', textClass: 'text-blue-600 dark:text-blue-400', badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
    { key: 'emerald', label: 'Green', bgClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400', badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
    { key: 'amber', label: 'Amber / Orange', bgClass: 'bg-amber-500', textClass: 'text-amber-600 dark:text-amber-400', badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
    { key: 'red', label: 'Red', bgClass: 'bg-rose-500', textClass: 'text-rose-600 dark:text-rose-400', badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
    { key: 'purple', label: 'Purple', bgClass: 'bg-purple-500', textClass: 'text-purple-600 dark:text-purple-400', badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
    { key: 'slate', label: 'Neutral Gray', bgClass: 'bg-slate-400', textClass: 'text-slate-600 dark:text-slate-400', badgeClass: 'bg-muted text-muted-foreground border-border' },
];

export function getParamBadgeClass(colorKey?: string | null) {
    const match = COLOR_OPTIONS.find(c => c.key === colorKey);
    return match ? match.badgeClass : 'bg-muted text-foreground border-border';
}

const CATEGORY_OPTIONS = [
    { key: 'global', label: 'Global' },
    { key: 'iphone', label: 'iPhone' },
    { key: 'android', label: 'Android' },
    { key: 'all', label: 'All' },
];

function AddParameterForm() {
    const [name, setName] = useState('');
    const [category, setCategory] = useState('global');

    const submit = () => {
        if (!name.trim()) return;

        router.post(route('parameters.store'), {
            name: name.trim(),
            category,
        }, {
            preserveScroll: true,
            onSuccess: () => setName(''),
        });
    };

    return (
        <div className="apple-card p-5 space-y-3">
            <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Add New Parameter</h3>
                <p className="text2">Create a new parameter (e.g. Color, Memory, License) so you can add options to it.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2">
                <input
                    type="text"
                    placeholder="Parameter name (e.g. Color, Memory, License)..."
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') submit();
                    }}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                />
                <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                >
                    {CATEGORY_OPTIONS.map(cat => (
                        <option key={cat.key} value={cat.key}>{cat.label}</option>
                    ))}
                </select>
                <button
                    onClick={submit}
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] transition flex items-center justify-center gap-1 shadow-xs"
                >
                    <Plus className="h-3.5 w-3.5" /> Create
                </button>
            </div>
        </div>
    );
}

export default function Parameters({ parameters = [] }: ParametersProps) {
    const safeParameters = Array.isArray(parameters) 
        ? parameters 
        : (parameters && typeof parameters === 'object' ? Object.values(parameters as Record<string, Parameter>) : []);
    const [newParameterValue, setNewParameterValue] = useState<{ [paramId: number]: string }>({});
    const [newParameterColor, setNewParameterColor] = useState<{ [paramId: number]: string }>({});
    const [isAdding, setIsAdding] = useState(false);

    // State for inline editing
    const [editingValueId, setEditingValueId] = useState<number | null>(null);
    const [editValueText, setEditValueText] = useState<string>('');
    const [editValueColor, setEditValueColor] = useState<string>('blue');

    const startEdit = (val: ParameterValue) => {
        setEditingValueId(val.id);
        setEditValueText(val.value);
        setEditValueColor(val.color || 'blue');
    };

    const cancelEdit = () => {
        setEditingValueId(null);
        setEditValueText('');
    };

    const saveEditValue = (valId: number) => {
        if (!editValueText.trim()) return;

        router.put(route('parameters.value.update', valId), {
            value: editValueText.trim(),
            color: editValueColor
        }, {
            preserveScroll: true,
            onSuccess: () => {
                setEditingValueId(null);
            }
        });
    };

    const submitNewParameterValue = (paramId: number) => {
        const valueStr = newParameterValue[paramId];
        if (!valueStr || !valueStr.trim()) return;

        router.post(route('parameters.value.store'), {
            parameter_id: paramId,
            value: valueStr.trim(),
            color: newParameterColor[paramId] || 'blue'
        }, {
            preserveScroll: true,
            onSuccess: () => {
                setNewParameterValue(prev => ({ ...prev, [paramId]: '' }));
            }
        });
    };

    const toggleParameterStatus = (valueId: number) => {
        router.post(route('parameters.value.toggle', valueId), {}, { preserveScroll: true });
    };

    const deleteParameterOption = (valueId: number) => {
        if (confirm('Delete this option permanently?')) {
            router.delete(route('parameters.value.destroy', valueId), { preserveScroll: true });
        }
    };

    return (
        <AuthenticatedLayout>
            <Head title="Product & Unit Parameters" />

            <div className="py-6 sm:py-8">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-6">

                    {/* Navigation Bar Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/40 pb-4">
                        <div className="flex items-center gap-3">
                            <Link
                                href={route('settings.general')}
                                className="p-2 rounded-xl border border-border/80 bg-card hover:bg-muted text-foreground transition flex items-center justify-center shrink-0 shadow-2xs"
                                title="Back to Settings"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Link>
                            <div>
                                <h1 className="h2 flex items-center gap-2">
                                    <Sliders className="h-5 w-5 text-primary" />
                                    <span>Product & Unit Parameters</span>
                                </h1>
                                <p className="text2 mt-0.5">
                                    Configure dynamic options, categories, and readable color badges used across the platform.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setIsAdding(v => !v)}
                                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] transition flex items-center gap-1.5 shadow-xs"
                            >
                                {isAdding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                {isAdding ? 'Cancel' : 'Add Parameter'}
                            </button>
                        </div>
                    </div>

                    {isAdding && (
                        <AddParameterForm />
                    )}

                    {safeParameters.length === 0 ? (
                        <div className="apple-card p-12 text-center text-muted-foreground space-y-4">
                            <Sliders className="h-8 w-8 mx-auto text-muted-foreground/50" />
                            <div className="space-y-1">
                                <p className="text1">No parameters found.</p>
                                <p className="text2">Create your first parameter below, then add color, memory, license, or any other options to it.</p>
                            </div>
                            <div className="mx-auto max-w-3xl text-left">
                                <AddParameterForm />
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-2">
                            {safeParameters.map((param) => {
                                const isColorable = param.name.toLowerCase().includes('flag') || param.name.toLowerCase().includes('status');
                                const selectedColor = newParameterColor[param.id] || (isColorable ? 'blue' : 'slate');

                                return (
                                    <div key={param.id} className="apple-card p-5 text-card-foreground flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                                                    <Tag className="h-4 w-4 text-primary" />
                                                    {param.name}
                                                </h4>
                                                <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                                                    {param.category}
                                                </span>
                                            </div>
                                            <p className="text2 mb-4">
                                                Preset values for {param.name.toLowerCase()}.
                                            </p>

                                            {/* Options List */}
                                            <div className="space-y-2 mb-4 max-h-72 overflow-y-auto pr-1">
                                                {(!param.values || param.values.length === 0) ? (
                                                    <p className="text2 py-4 text-center">No options added yet.</p>
                                                ) : (
                                                    param.values.map((val) => {
                                                    const badgeClass = getParamBadgeClass(val.color);
                                                    const isEditing = editingValueId === val.id;

                                                    if (isEditing) {
                                                        return (
                                                            <div
                                                                key={val.id}
                                                                className="p-3 rounded-xl border border-primary/40 bg-card/80 space-y-2.5 shadow-sm"
                                                            >
                                                                <div className="flex gap-2 items-center">
                                                                    <input
                                                                        type="text"
                                                                        value={editValueText}
                                                                        onChange={e => setEditValueText(e.target.value)}
                                                                        onKeyDown={e => {
                                                                            if (e.key === 'Enter') saveEditValue(val.id);
                                                                            if (e.key === 'Escape') cancelEdit();
                                                                        }}
                                                                        autoFocus
                                                                        className="flex-1 rounded-lg border border-border/70 bg-background px-2.5 py-1 text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => saveEditValue(val.id)}
                                                                        className="p-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition"
                                                                        title="Save changes"
                                                                    >
                                                                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={cancelEdit}
                                                                        className="p-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition"
                                                                        title="Cancel"
                                                                    >
                                                                        <X className="h-3.5 w-3.5" />
                                                                    </button>
                                                                </div>

                                                                {/* Color chooser for edit */}
                                                                <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
                                                                    <span className="text-[10px] font-bold text-muted-foreground mr-1">Color:</span>
                                                                    {COLOR_OPTIONS.map((c) => (
                                                                        <button
                                                                            key={c.key}
                                                                            type="button"
                                                                            onClick={() => setEditValueColor(c.key)}
                                                                            title={c.label}
                                                                            className={`h-4.5 w-4.5 rounded-full ${c.bgClass} flex items-center justify-center transition-transform shrink-0 ${
                                                                                editValueColor === c.key
                                                                                    ? 'ring-2 ring-primary ring-offset-1 scale-110'
                                                                                    : 'opacity-70 hover:opacity-100'
                                                                            }`}
                                                                        >
                                                                            {editValueColor === c.key && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div
                                                            key={val.id}
                                                            className="flex justify-between items-center bg-muted/40 p-2.5 rounded-xl border border-border/40 hover:bg-muted/60 transition"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${badgeClass} ${!val.is_active ? 'opacity-40 line-through' : ''}`}>
                                                                    {val.value}
                                                                </span>
                                                            </div>

                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    onClick={() => startEdit(val)}
                                                                    className="p-1 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition"
                                                                    title="Edit option & color"
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => toggleParameterStatus(val.id)}
                                                                    className={`rounded-lg px-2 py-1 text-[10px] font-semibold tracking-wider transition ${
                                                                        val.is_active
                                                                            ? 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                                                            : 'bg-primary/10 text-primary hover:bg-primary/20'
                                                                    }`}
                                                                >
                                                                    {val.is_active ? 'Disable' : 'Enable'}
                                                                </button>
                                                                <button
                                                                    onClick={() => deleteParameterOption(val.id)}
                                                                    className="p-1 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>

                                    {/* Add Option Form */}
                                    <div className="pt-3 border-t border-border/40 space-y-2.5">
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder={`Add new ${param.name}...`}
                                                value={newParameterValue[param.id] || ''}
                                                onChange={e => setNewParameterValue(prev => ({ ...prev, [param.id]: e.target.value }))}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') submitNewParameterValue(param.id);
                                                }}
                                                className="flex-1 rounded-xl border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:border-primary"
                                            />
                                            <button
                                                onClick={() => submitNewParameterValue(param.id)}
                                                className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] transition flex items-center gap-1 shadow-xs"
                                            >
                                                <Plus className="h-3.5 w-3.5" /> Add
                                            </button>
                                        </div>

                                        {/* Color Selection Palette */}
                                        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                                            <span className="text-[10px] font-bold text-muted-foreground mr-1 shrink-0">Color:</span>
                                            {COLOR_OPTIONS.map((c) => (
                                                <button
                                                    key={c.key}
                                                    type="button"
                                                    onClick={() => setNewParameterColor(prev => ({ ...prev, [param.id]: c.key }))}
                                                    title={c.label}
                                                    className={`h-5 w-5 rounded-full ${c.bgClass} flex items-center justify-center transition-transform shrink-0 ${
                                                        selectedColor === c.key
                                                            ? 'ring-2 ring-primary ring-offset-2 scale-110'
                                                            : 'opacity-70 hover:opacity-100'
                                                    }`}
                                                >
                                                    {selectedColor === c.key && <Check className="h-3 w-3 text-white stroke-[3]" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        </div>
                    )}

                </div>
            </div>
        </AuthenticatedLayout>
    );
}
