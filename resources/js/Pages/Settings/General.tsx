import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm, router, Link } from '@inertiajs/react';
import { 
    Building2, 
    Clock, 
    ShieldCheck, 
    Sparkles, 
    Sliders, 
    Users, 
    Store as StoreIcon, 
    Trash2, 
    Eye, 
    EyeOff, 
    ChevronRight,
    ChevronLeft,
    MapPin,
    Check,
    BrainCircuit
} from 'lucide-react';
import { FormEvent, useState, useEffect } from 'react';

interface GeneralSetting {
    id: number;
    company_name: string;
    work_start_time: string;
    work_end_time: string;
    grace_period_minutes: number;
    geofence_lock_enabled: boolean;
    notification_emails?: string | null;
    ai_enabled?: boolean;
    ai_provider?: string;
    ai_api_key?: string | null;
    ai_api_keys?: string[] | null;
    ai_model?: string;
    ai_system_instruction?: string | null;
}

interface User {
    id: number;
    name: string;
    email: string;
    store_id: number | null;
}

interface Store {
    id: number;
    name: string;
}

interface EmployeeSchedule {
    id: number;
    user_id: number;
    store_id: number;
    work_start_time: string | null;
    work_end_time: string | null;
    grace_period_minutes: number | null;
    user?: User;
    store?: Store;
}

interface GeneralProps {
    settings: GeneralSetting;
    schedules: EmployeeSchedule[];
    employees: User[];
    stores: Store[];
}

export type SettingsSubPage = 'root' | 'company' | 'work_policy' | 'geofence' | 'ai' | 'shifts';

export default function General({ settings, schedules, employees, stores }: GeneralProps) {
    // Read subpage from URL hash if available (e.g. #ai, #shifts)
    const [currentPage, setCurrentPage] = useState<SettingsSubPage>(() => {
        if (typeof window !== 'undefined') {
            const hash = window.location.hash.replace('#', '');
            if (['company', 'work_policy', 'geofence', 'ai', 'shifts'].includes(hash)) {
                return hash as SettingsSubPage;
            }
        }
        return 'root';
    });

    const navigateTo = (page: SettingsSubPage) => {
        setCurrentPage(page);
        if (typeof window !== 'undefined') {
            if (page === 'root') {
                history.pushState(null, '', window.location.pathname);
            } else {
                history.pushState(null, '', `#${page}`);
            }
        }
    };

    // Sync with browser back/forward buttons
    useEffect(() => {
        const handlePopState = () => {
            const hash = window.location.hash.replace('#', '');
            if (['company', 'work_policy', 'geofence', 'ai', 'shifts'].includes(hash)) {
                setCurrentPage(hash as SettingsSubPage);
            } else {
                setCurrentPage('root');
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    // ── Form 1: Company & Alerts ──
    const companyForm = useForm({
        section: 'company',
        company_name: settings.company_name || 'Daily Phone',
        notification_emails: settings.notification_emails || '',
    });

    const submitCompany = (e: FormEvent) => {
        e.preventDefault();
        companyForm.post(route('settings.general.update'), {
            preserveScroll: true,
        });
    };

    // ── Form 2: Working Hours & Policy ──
    const workPolicyForm = useForm({
        section: 'work_policy',
        work_start_time: settings.work_start_time || '09:00:00',
        work_end_time: settings.work_end_time || '18:00:00',
        grace_period_minutes: settings.grace_period_minutes || 15,
    });

    const submitWorkPolicy = (e: FormEvent) => {
        e.preventDefault();
        workPolicyForm.post(route('settings.general.update'), {
            preserveScroll: true,
        });
    };

    // ── Form 3: Geofence Lock ──
    const geofenceForm = useForm({
        section: 'geofence',
        geofence_lock_enabled: settings.geofence_lock_enabled,
    });

    const submitGeofence = (newVal: boolean) => {
        geofenceForm.setData('geofence_lock_enabled', newVal);
        router.post(route('settings.general.update'), {
            section: 'geofence',
            geofence_lock_enabled: newVal ? 1 : 0,
        }, {
            preserveScroll: true,
        });
    };

    // ── Form 4: AI Configuration ──
    const [visibleApiKeys, setVisibleApiKeys] = useState<boolean[]>(Array(10).fill(false));
    const [testingConnection, setTestingConnection] = useState(false);
    const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

    const failoverSlots = Array.from(
        { length: 9 },
        (_, i) => settings.ai_api_keys?.[i] || '',
    );

    const aiForm = useForm({
        section: 'ai',
        ai_enabled: settings.ai_enabled ?? true,
        ai_provider: settings.ai_provider || 'gemini',
        ai_api_key: settings.ai_api_key || '',
        ai_api_keys: failoverSlots,
        ai_model: settings.ai_model || 'gemini-3.5-flash-lite',
        ai_system_instruction: settings.ai_system_instruction || '',
        clear_ai_api_key: false,
    });

    const setFailoverKey = (index: number, value: string) => {
        const keys = [...aiForm.data.ai_api_keys];
        keys[index] = value;
        aiForm.setData('ai_api_keys', keys);
    };

    const firstConfiguredKey = () => {
        if (aiForm.data.ai_api_key && aiForm.data.ai_api_key.trim() !== '') {
            return aiForm.data.ai_api_key;
        }
        return aiForm.data.ai_api_keys.find(k => k.trim() !== '') || '';
    };

    const configuredKeyCount = () => {
        let count = aiForm.data.ai_api_key && aiForm.data.ai_api_key.trim() !== '' ? 1 : 0;
        count += aiForm.data.ai_api_keys.filter(k => k.trim() !== '').length;
        return count;
    };

    const submitAi = (e: FormEvent) => {
        e.preventDefault();
        aiForm.post(route('settings.general.update'), {
            preserveScroll: true,
        });
    };

    const handleTestConnection = async () => {
        setTestingConnection(true);
        setTestResult(null);
        try {
            const res = await fetch(route('settings.ai.test'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content || '',
                },
                body: JSON.stringify({
                    api_key: firstConfiguredKey(),
                    model: aiForm.data.ai_model,
                })
            });
            const data = await res.json();
            setTestResult(data);
        } catch (err: any) {
            setTestResult({ success: false, message: 'Failed to contact server: ' + err.message });
        } finally {
            setTestingConnection(false);
        }
    };

    // ── Form 5: Staff Schedule ──
    const scheduleForm = useForm({
        user_id: '',
        store_id: '',
        work_start_time: '',
        work_end_time: '',
        grace_period_minutes: '',
    });

    const submitSchedule = (e: FormEvent) => {
        e.preventDefault();
        if (!scheduleForm.data.user_id || !scheduleForm.data.store_id) {
            return;
        }

        scheduleForm.post(route('settings.schedule.store'), {
            preserveScroll: true,
            onSuccess: () => {
                scheduleForm.reset();
            }
        });
    };

    const deleteSchedule = (id: number) => {
        if (confirm('Are you sure you want to remove this staff schedule?')) {
            router.delete(route('settings.schedule.destroy', id), {
                preserveScroll: true,
            });
        }
    };

    return (
        <AuthenticatedLayout>
            <Head title="Settings" />

            <div className="py-6 sm:py-8">
                <div className="mx-auto max-w-5xl px-4 sm:px-6">

                    {/* ══════════════════════════════════════════════════════════════════
                        ROOT PAGE: Responsive Clean Settings Grid & List
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'root' && (
                        <div className="space-y-6 animate-in fade-in duration-200">
                            {/* Navigation Header */}
                            <div className="flex flex-col gap-1">
                                <h1 className="h1 text-foreground">
                                    Settings
                                </h1>
                                <p className="text2 text-muted-foreground">
                                    Manage store preferences, attendance rules, AI assistant, and master data.
                                </p>
                            </div>

                            {/* Responsive 2-Column Grid on Laptop/Desktop */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                
                                {/* Column 1: Store & Identity + Master Data */}
                                <div className="space-y-6">
                                    <div>
                                        <div className="apple-section-header">Store & Identity</div>
                                        <div className="apple-card overflow-hidden divide-y divide-border/60">
                                            {/* Company & Identity */}
                                            <button
                                                type="button"
                                                onClick={() => navigateTo('company')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <Building2 className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            Company & Notifications
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Store profile & invoice alerts
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text2 text-muted-foreground font-normal">
                                                        {settings.company_name || 'Daily Phone'}
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                                </div>
                                            </button>

                                            {/* Working Hours */}
                                            <button
                                                type="button"
                                                onClick={() => navigateTo('work_policy')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <Clock className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            Working Hours & Policy
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Shift hours & grace tolerance
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="caption text-muted-foreground font-mono">
                                                        {(settings.work_start_time || '09:00').substring(0, 5)} - {(settings.work_end_time || '18:00').substring(0, 5)}
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                                </div>
                                            </button>

                                            {/* Security & Geofence */}
                                            <button
                                                type="button"
                                                onClick={() => navigateTo('geofence')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <ShieldCheck className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            Security & Geofence
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            GPS attendance lock
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text2 text-muted-foreground font-normal">
                                                        {settings.geofence_lock_enabled ? 'Active' : 'Disabled'}
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                                </div>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Master Data Shortcuts */}
                                    <div>
                                        <div className="apple-section-header">Master Data Management</div>
                                        <div className="apple-card overflow-hidden divide-y divide-border/60">
                                            <Link
                                                href={route('settings.parameters')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <Sliders className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            Product & Unit Parameters
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Brands, categories, storage & licenses
                                                        </span>
                                                    </div>
                                                </div>
                                                <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                            </Link>

                                            <Link
                                                href={route('stores.index')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <StoreIcon className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            Store Branches & GPS Radii
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Manage physical branch locations
                                                        </span>
                                                    </div>
                                                </div>
                                                <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                            </Link>

                                            <Link
                                                href={route('users.index')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <Users className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            Users & Staff Accounts
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Roles, permissions & credentials
                                                        </span>
                                                    </div>
                                                </div>
                                                <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                            </Link>
                                        </div>
                                    </div>
                                </div>

                                {/* Column 2: Intelligence & Operations */}
                                <div className="space-y-6">
                                    <div>
                                        <div className="apple-section-header">Services & Operations</div>
                                        <div className="apple-card overflow-hidden divide-y divide-border/60">
                                            {/* AI Assistant */}
                                            <button
                                                type="button"
                                                onClick={() => navigateTo('ai')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <Sparkles className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            AI Assistant (Intelligence)
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Gemini LLM model & API keys
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text2 text-muted-foreground font-normal">
                                                        {settings.ai_enabled ? 'Active' : 'Off'}
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                                </div>
                                            </button>

                                            {/* AI Training & Memory */}
                                            <Link
                                                href={route('settings.ai.training-notes')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <BrainCircuit className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            AI Training & Memory
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Rules & notes the AI learns from
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="caption text-muted-foreground font-mono">
                                                        superadmin
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                                </div>
                                            </Link>

                                            {/* Shift Schedules */}
                                            <button
                                                type="button"
                                                onClick={() => navigateTo('shifts')}
                                                className="w-full flex items-center justify-between p-4 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                            >
                                                <div className="flex items-center gap-3.5 min-w-0">
                                                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                        <Users className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <span className="text1 text-foreground block truncate">
                                                            Staff Shift Schedules
                                                        </span>
                                                        <span className="caption text-muted-foreground">
                                                            Individual branch shift rules
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="caption text-muted-foreground font-mono">
                                                        {schedules.length} custom
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════════════════════
                        SUBPAGE 1: Company & Notifications
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'company' && (
                        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-4">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text2 font-medium text-primary hover:opacity-80 active:scale-95 transition"
                                >
                                    <ChevronLeft className="h-5 w-5 -ml-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="h3 text-foreground">
                                    Company & Notifications
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <form onSubmit={submitCompany} className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text1 text-foreground block font-medium">
                                        Company / Store Name
                                    </label>
                                    <input
                                        type="text"
                                        value={companyForm.data.company_name}
                                        onChange={e => companyForm.setData('company_name', e.target.value)}
                                        placeholder="Daily Phone"
                                        className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                    />
                                    <p className="caption text-muted-foreground">
                                        Displayed on printed receipts, digital invoices, and customer notifications.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text1 text-foreground block font-medium">
                                        Alert Forwarding Email
                                    </label>
                                    <input
                                        type="email"
                                        value={companyForm.data.notification_emails}
                                        onChange={e => companyForm.setData('notification_emails', e.target.value)}
                                        placeholder="owner@dailyphone.com"
                                        className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                    />
                                    <p className="caption text-muted-foreground">
                                        End-of-shift petty cash reconciliations and digital payslips are forwarded here.
                                    </p>
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={companyForm.processing}
                                        className="w-full apple-btn-primary py-3 text2 font-semibold shadow-xs"
                                    >
                                        {companyForm.processing ? 'Saving...' : 'Save Company Details'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════════════════════
                        SUBPAGE 2: Working Hours & Policy
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'work_policy' && (
                        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-4">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text2 font-medium text-primary hover:opacity-80 active:scale-95 transition"
                                >
                                    <ChevronLeft className="h-5 w-5 -ml-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="h3 text-foreground">
                                    Working Hours & Policy
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <form onSubmit={submitWorkPolicy} className="space-y-6">
                                <div className="space-y-4">
                                    <h3 className="h3 text-foreground">Default Store Schedule</h3>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text1 text-foreground block font-medium">Clock-In Time</label>
                                            <input
                                                type="time"
                                                step="1"
                                                value={workPolicyForm.data.work_start_time}
                                                onChange={e => workPolicyForm.setData('work_start_time', e.target.value)}
                                                className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 font-mono text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text1 text-foreground block font-medium">Clock-Out Time</label>
                                            <input
                                                type="time"
                                                step="1"
                                                value={workPolicyForm.data.work_end_time}
                                                onChange={e => workPolicyForm.setData('work_end_time', e.target.value)}
                                                className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 font-mono text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                            />
                                        </div>
                                    </div>
                                    <p className="caption text-muted-foreground">
                                        Applied as the baseline shift schedule for all employees across branches.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text1 text-foreground block font-medium">Late Grace Period</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            min="0"
                                            max="120"
                                            value={workPolicyForm.data.grace_period_minutes}
                                            onChange={e => workPolicyForm.setData('grace_period_minutes', parseInt(e.target.value) || 0)}
                                            className="w-32 rounded-xl border border-border/80 bg-background px-4 py-2.5 font-mono text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                        />
                                        <span className="text2 text-muted-foreground font-medium">Minutes</span>
                                    </div>
                                    <p className="caption text-muted-foreground">
                                        Staff clocking in within this window will not be flagged as late or tardy.
                                    </p>
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={workPolicyForm.processing}
                                        className="w-full apple-btn-primary py-3 text2 font-semibold shadow-xs"
                                    >
                                        {workPolicyForm.processing ? 'Saving...' : 'Save Policy'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════════════════════
                        SUBPAGE 3: Security & Geofence
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'geofence' && (
                        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-4">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text2 font-medium text-primary hover:opacity-80 active:scale-95 transition"
                                >
                                    <ChevronLeft className="h-5 w-5 -ml-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="h3 text-foreground">
                                    Security & Geofence
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <div className="space-y-6">
                                <div className="apple-card p-5 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1 pr-4">
                                            <div className="text1 font-semibold text-foreground">
                                                Enforce GPS Geofence Lock
                                            </div>
                                            <div className="text2 text-muted-foreground">
                                                Restricts shift clock-in to branch store radius.
                                            </div>
                                        </div>
                                        {/* Toggle switch */}
                                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                            <input
                                                type="checkbox"
                                                checked={geofenceForm.data.geofence_lock_enabled}
                                                onChange={e => submitGeofence(e.target.checked)}
                                                className="sr-only peer"
                                            />
                                            <div className="w-12 h-7 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all after:shadow-xs peer-checked:bg-primary"></div>
                                        </label>
                                    </div>
                                    <p className="caption text-muted-foreground pt-2 border-t border-border/40">
                                        When active, staff devices must be physically detected within the store radius to clock in or out.
                                    </p>
                                </div>

                                <div className="apple-card p-5">
                                    <Link
                                        href={route('stores.index')}
                                        className="w-full flex items-center justify-between group"
                                    >
                                        <div className="flex items-center gap-3.5">
                                            <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                                                <MapPin className="h-4 w-4" />
                                            </div>
                                            <div>
                                                <span className="text1 font-medium text-foreground block">
                                                    Calibrate Store GPS Radii
                                                </span>
                                                <span className="caption text-muted-foreground">
                                                    View and adjust coordinates for each branch
                                                </span>
                                            </div>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════════════════════
                        SUBPAGE 4: AI Assistant (Intelligence)
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'ai' && (
                        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-4">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text2 font-medium text-primary hover:opacity-80 active:scale-95 transition"
                                >
                                    <ChevronLeft className="h-5 w-5 -ml-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="h3 text-foreground">
                                    AI Assistant (Intelligence)
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <form onSubmit={submitAi} className="space-y-6">
                                <div className="apple-card p-5 flex items-center justify-between">
                                    <div className="space-y-1">
                                        <span className="text1 font-semibold text-foreground block">
                                            Enable AI Assistant
                                        </span>
                                        <span className="text2 text-muted-foreground block">
                                            Power natural language stock & sales querying
                                        </span>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                        <input
                                            type="checkbox"
                                            checked={aiForm.data.ai_enabled}
                                            onChange={e => aiForm.setData('ai_enabled', e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-12 h-7 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all after:shadow-xs peer-checked:bg-primary"></div>
                                    </label>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="h3 text-foreground">Engine & Credentials</h3>
                                    
                                    <div className="space-y-2">
                                        <label className="text1 text-foreground block font-medium">
                                            Gemini Model
                                        </label>
                                        <select
                                            value={aiForm.data.ai_model}
                                            onChange={e => aiForm.setData('ai_model', e.target.value)}
                                            className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                        >
                                            <option value="gemini-3.6-flash">Gemini 3.6 Flash (Recommended)</option>
                                            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
                                            <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Fast)</option>
                                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                            <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                                            <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
                                        </select>
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text1 text-foreground block font-medium">
                                                Gemini API Keys
                                            </label>
                                            <span className="caption font-semibold text-muted-foreground flex items-center gap-1">
                                                {configuredKeyCount()}/10 Configured
                                            </span>
                                        </div>
                                        <p className="text2 text-muted-foreground">
                                            Up to 10 keys are used in failover order. When a key hits its usage /
                                            rate limit, the assistant automatically rotates to the next one.
                                            Empty fields are skipped.
                                        </p>
                                        {configuredKeyCount() > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const allVisible = visibleApiKeys.every(Boolean);
                                                    setVisibleApiKeys(Array(10).fill(!allVisible));
                                                }}
                                                className="text2 font-medium text-primary hover:opacity-80 transition"
                                            >
                                                {visibleApiKeys.every(Boolean) ? 'Hide all keys' : 'Show all keys'}
                                            </button>
                                        )}
                                        {Array.from({ length: 10 }, (_, i) => {
                                            const value = i === 0 ? aiForm.data.ai_api_key : aiForm.data.ai_api_keys[i - 1];
                                            const hasValue = value.trim() !== '';
                                            const isVisible = visibleApiKeys[i];
                                            return (
                                                <div key={i} className="space-y-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <label className="caption font-medium text-muted-foreground block">
                                                            API Key {i + 1}
                                                        </label>
                                                        {hasValue && (
                                                            <span className="caption font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                                <Check className="h-3 w-3" /> Configured
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="relative">
                                                        <input
                                                            type={isVisible ? 'text' : 'password'}
                                                            placeholder={hasValue ? '••••••••••••••••••••••••' : 'AIzaSy...'}
                                                            value={value}
                                                            onChange={e => i === 0
                                                                ? aiForm.setData('ai_api_key', e.target.value)
                                                                : setFailoverKey(i - 1, e.target.value)
                                                            }
                                                            className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 font-mono text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs pr-10"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setVisibleApiKeys(prev => prev.map((v, idx) => idx === i ? !v : v));
                                                            }}
                                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                                                        >
                                                            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Test Connection Button */}
                                    <div className="flex items-center gap-3 pt-1">
                                        <button
                                            type="button"
                                            onClick={handleTestConnection}
                                            disabled={testingConnection || !firstConfiguredKey()}
                                            className="px-4 py-2 rounded-xl border border-border/80 bg-card text2 font-semibold text-foreground hover:bg-muted/50 transition disabled:opacity-50 flex items-center gap-2 shadow-2xs"
                                        >
                                            <Sparkles className="h-4 w-4 text-primary" />
                                            {testingConnection ? 'Testing...' : 'Test Connection'}
                                        </button>
                                        {testResult && (
                                            <span className={`text2 font-medium ${testResult.success ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {testResult.message}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text1 text-foreground block font-medium">
                                        Global Custom Instructions
                                    </label>
                                    <textarea
                                        rows={3}
                                        placeholder="e.g. Always prioritize battery health check and warranty policy..."
                                        value={aiForm.data.ai_system_instruction}
                                        onChange={e => aiForm.setData('ai_system_instruction', e.target.value)}
                                        className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs resize-none"
                                    />
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={aiForm.processing}
                                        className="w-full apple-btn-primary py-3 text2 font-semibold shadow-xs"
                                    >
                                        {aiForm.processing ? 'Saving...' : 'Save AI Configuration'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════════════════════
                        SUBPAGE 5: Staff Shift Schedules
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'shifts' && (
                        <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-4">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text2 font-medium text-primary hover:opacity-80 active:scale-95 transition"
                                >
                                    <ChevronLeft className="h-5 w-5 -ml-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="h3 text-foreground">
                                    Staff Shift Schedules
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            {/* Add Custom Schedule Form */}
                            <form onSubmit={submitSchedule} className="space-y-4">
                                <h3 className="h3 text-foreground">Add Employee Custom Schedule</h3>
                                <div className="apple-card p-5 space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text1 text-foreground block font-medium">
                                                Employee
                                            </label>
                                            <select
                                                value={scheduleForm.data.user_id}
                                                onChange={e => scheduleForm.setData('user_id', e.target.value)}
                                                className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                            >
                                                <option value="">Select Employee...</option>
                                                {employees.map(emp => (
                                                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text1 text-foreground block font-medium">
                                                Store Branch
                                            </label>
                                            <select
                                                value={scheduleForm.data.store_id}
                                                onChange={e => scheduleForm.setData('store_id', e.target.value)}
                                                className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                            >
                                                <option value="">Select Branch...</option>
                                                {stores.map(st => (
                                                    <option key={st.id} value={st.id}>{st.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text1 text-foreground block font-medium">
                                                Clock In
                                            </label>
                                            <input
                                                type="time"
                                                value={scheduleForm.data.work_start_time}
                                                onChange={e => scheduleForm.setData('work_start_time', e.target.value)}
                                                className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 font-mono text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text1 text-foreground block font-medium">
                                                Clock Out
                                            </label>
                                            <input
                                                type="time"
                                                value={scheduleForm.data.work_end_time}
                                                onChange={e => scheduleForm.setData('work_end_time', e.target.value)}
                                                className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 font-mono text2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
                                            />
                                        </div>
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            type="submit"
                                            disabled={scheduleForm.processing || !scheduleForm.data.user_id || !scheduleForm.data.store_id}
                                            className="w-full apple-btn-primary py-3 text2 font-semibold shadow-xs disabled:opacity-50"
                                        >
                                            {scheduleForm.processing ? 'Saving...' : 'Add Schedule'}
                                        </button>
                                    </div>
                                </div>
                            </form>

                            {/* Existing Schedules List */}
                            <div className="space-y-3 pt-2">
                                <div className="flex items-center justify-between">
                                    <h3 className="h3 text-foreground">Configured Custom Schedules</h3>
                                    <span className="caption font-mono bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full">{schedules.length}</span>
                                </div>
                                <div className="apple-card overflow-hidden divide-y divide-border/60">
                                    {schedules.length === 0 ? (
                                        <div className="p-8 text-center text2 text-muted-foreground">
                                            No custom schedules. All staff use default working hours.
                                        </div>
                                    ) : (
                                        schedules.map(sch => (
                                            <div key={sch.id} className="flex items-center justify-between p-4 hover:bg-muted/20 transition">
                                                <div className="min-w-0">
                                                    <div className="text1 font-semibold text-foreground truncate">
                                                        {sch.user?.name || 'Staff Member'}
                                                    </div>
                                                    <div className="caption text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                        <span>{sch.store?.name || 'Branch'}</span>
                                                        <span>•</span>
                                                        <span className="font-mono">
                                                            {(sch.work_start_time || settings.work_start_time).substring(0, 5)} - {(sch.work_end_time || settings.work_end_time).substring(0, 5)}
                                                        </span>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => deleteSchedule(sch.id)}
                                                    className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"
                                                    title="Remove schedule"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </AuthenticatedLayout>
    );
}
