import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm, router, Link } from '@inertiajs/react';
import { 
    Settings, 
    Building2, 
    Clock, 
    ShieldCheck, 
    Sparkles, 
    Sliders, 
    Users, 
    Store as StoreIcon, 
    Plus, 
    Trash2, 
    Eye, 
    EyeOff, 
    CheckCircle2, 
    AlertCircle, 
    ChevronRight,
    ChevronLeft,
    Mail,
    Bell,
    Layers,
    ExternalLink,
    MapPin,
    Check
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
    const [showApiKey, setShowApiKey] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

    const aiForm = useForm({
        section: 'ai',
        ai_enabled: settings.ai_enabled ?? true,
        ai_provider: settings.ai_provider || 'gemini',
        ai_api_key: settings.ai_api_key || '',
        ai_model: settings.ai_model || 'gemini-3.5-flash-lite',
        ai_system_instruction: settings.ai_system_instruction || '',
        clear_ai_api_key: false,
    });

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
                    api_key: aiForm.data.ai_api_key,
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

            <div className="py-6 sm:py-10">
                <div className="mx-auto max-w-xl px-4 sm:px-6">

                    {/* ══════════════════════════════════════════════════════════════════
                        ROOT PAGE: iOS Grouped Settings Menu
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'root' && (
                        <div className="space-y-6 animate-in fade-in duration-200">
                            {/* iOS Navigation Header */}
                            <div className="px-1 pt-1 pb-1">
                                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                                    Settings
                                </h1>
                            </div>

                            {/* Section 1: Core System & Store Preferences */}
                            <div>
                                <div className="apple-section-header">Store & Identity</div>
                                <div className="apple-card overflow-hidden divide-y divide-border/60">
                                    {/* Company & Identity */}
                                    <button
                                        type="button"
                                        onClick={() => navigateTo('company')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <Building2 className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                Company & Notifications
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-muted-foreground font-normal">
                                                {settings.company_name || 'Daily Phone'}
                                            </span>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                        </div>
                                    </button>

                                    {/* Working Hours */}
                                    <button
                                        type="button"
                                        onClick={() => navigateTo('work_policy')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <Clock className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                Working Hours & Policy
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {(settings.work_start_time || '09:00').substring(0, 5)} - {(settings.work_end_time || '18:00').substring(0, 5)}
                                            </span>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                        </div>
                                    </button>

                                    {/* Security & Geofence */}
                                    <button
                                        type="button"
                                        onClick={() => navigateTo('geofence')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <ShieldCheck className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                Security & Geofence
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-muted-foreground font-normal">
                                                {settings.geofence_lock_enabled ? 'Enforced' : 'Disabled'}
                                            </span>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* Section 2: Intelligence & Operations */}
                            <div>
                                <div className="apple-section-header">Services & Operations</div>
                                <div className="apple-card overflow-hidden divide-y divide-border/60">
                                    {/* AI Assistant */}
                                    <button
                                        type="button"
                                        onClick={() => navigateTo('ai')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-indigo-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <Sparkles className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                AI Assistant (Intelligence)
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-muted-foreground font-normal">
                                                {settings.ai_enabled ? 'Active' : 'Off'}
                                            </span>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                        </div>
                                    </button>

                                    {/* Shift Schedules */}
                                    <button
                                        type="button"
                                        onClick={() => navigateTo('shifts')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition text-left group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <Users className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                Staff Shift Schedules
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {schedules.length} custom
                                            </span>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition" />
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* Section 3: Master Data Shortcuts */}
                            <div>
                                <div className="apple-section-header">Master Data Management</div>
                                <div className="apple-card overflow-hidden divide-y divide-border/60">
                                    <Link
                                        href={route('settings.parameters')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-sky-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <Sliders className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                Product & Unit Parameters
                                            </span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                    </Link>

                                    <Link
                                        href={route('stores.index')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <StoreIcon className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                Store Branches & GPS Radii
                                            </span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                    </Link>

                                    <Link
                                        href={route('users.index')}
                                        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition group"
                                    >
                                        <div className="flex items-center gap-3.5 min-w-0">
                                            <div className="h-7 w-7 rounded-lg bg-purple-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                <Users className="h-4 w-4" />
                                            </div>
                                            <span className="text-[15px] font-medium text-foreground truncate">
                                                Users & Staff Accounts
                                            </span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                    </Link>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════════════════════
                        SUBPAGE 1: Company & Notifications
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'company' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-3">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:opacity-80 active:scale-95 transition -ml-1"
                                >
                                    <ChevronLeft className="h-5 w-5 -mr-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="text-sm font-semibold text-foreground">
                                    Company & Notifications
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <form onSubmit={submitCompany} className="space-y-6">
                                <div>
                                    <div className="apple-section-header">Store Identity</div>
                                    <div className="apple-card overflow-hidden">
                                        <div className="px-4 py-3">
                                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                                Company / Store Name
                                            </label>
                                            <input
                                                type="text"
                                                value={companyForm.data.company_name}
                                                onChange={e => companyForm.setData('company_name', e.target.value)}
                                                placeholder="Daily Phone"
                                                className="w-full bg-transparent text-[15px] font-medium text-foreground focus:outline-none placeholder:text-muted-foreground/50 py-1"
                                            />
                                        </div>
                                    </div>
                                    <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">
                                        Displayed on printed receipts, digital invoices, and customer notifications.
                                    </p>
                                </div>

                                <div>
                                    <div className="apple-section-header">Alert Recipient</div>
                                    <div className="apple-card overflow-hidden">
                                        <div className="px-4 py-3">
                                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                                Alert Forwarding Email
                                            </label>
                                            <input
                                                type="email"
                                                value={companyForm.data.notification_emails}
                                                onChange={e => companyForm.setData('notification_emails', e.target.value)}
                                                placeholder="owner@dailyphone.com"
                                                className="w-full bg-transparent text-[15px] font-medium text-foreground focus:outline-none placeholder:text-muted-foreground/50 py-1"
                                            />
                                        </div>
                                    </div>
                                    <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">
                                        End-of-shift petty cash reconciliations and digital payslips are forwarded here.
                                    </p>
                                </div>

                                {/* Section-specific Save Button */}
                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={companyForm.processing}
                                        className="w-full apple-btn-primary py-3 text-sm font-semibold shadow-sm"
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
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-3">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:opacity-80 active:scale-95 transition -ml-1"
                                >
                                    <ChevronLeft className="h-5 w-5 -mr-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="text-sm font-semibold text-foreground">
                                    Working Hours & Policy
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <form onSubmit={submitWorkPolicy} className="space-y-6">
                                <div>
                                    <div className="apple-section-header">Default Store Schedule</div>
                                    <div className="apple-card overflow-hidden divide-y divide-border/60">
                                        <div className="flex items-center justify-between px-4 py-3">
                                            <span className="text-[15px] font-medium text-foreground">Clock-In Time</span>
                                            <input
                                                type="time"
                                                step="1"
                                                value={workPolicyForm.data.work_start_time}
                                                onChange={e => workPolicyForm.setData('work_start_time', e.target.value)}
                                                className="bg-muted/40 px-3 py-1.5 rounded-lg text-sm font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>

                                        <div className="flex items-center justify-between px-4 py-3">
                                            <span className="text-[15px] font-medium text-foreground">Clock-Out Time</span>
                                            <input
                                                type="time"
                                                step="1"
                                                value={workPolicyForm.data.work_end_time}
                                                onChange={e => workPolicyForm.setData('work_end_time', e.target.value)}
                                                className="bg-muted/40 px-3 py-1.5 rounded-lg text-sm font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                    </div>
                                    <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">
                                        Applied as the baseline shift schedule for all employees across branches.
                                    </p>
                                </div>

                                <div>
                                    <div className="apple-section-header">Attendance Tolerance</div>
                                    <div className="apple-card overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-3">
                                            <span className="text-[15px] font-medium text-foreground">Late Grace Period</span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="120"
                                                    value={workPolicyForm.data.grace_period_minutes}
                                                    onChange={e => workPolicyForm.setData('grace_period_minutes', parseInt(e.target.value) || 0)}
                                                    className="w-20 bg-muted/40 px-3 py-1.5 rounded-lg text-sm font-mono font-medium text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <span className="text-xs text-muted-foreground font-medium">min</span>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">
                                        Staff clocking in within this window will not be flagged as tardy.
                                    </p>
                                </div>

                                {/* Section-specific Save Button */}
                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={workPolicyForm.processing}
                                        className="w-full apple-btn-primary py-3 text-sm font-semibold shadow-sm"
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
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-3">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:opacity-80 active:scale-95 transition -ml-1"
                                >
                                    <ChevronLeft className="h-5 w-5 -mr-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="text-sm font-semibold text-foreground">
                                    Security & Geofence
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <div className="apple-section-header">Attendance Boundaries</div>
                                    <div className="apple-card overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-3.5">
                                            <div className="space-y-0.5 pr-4">
                                                <div className="text-[15px] font-medium text-foreground">
                                                    Enforce GPS Geofence Lock
                                                </div>
                                                <div className="text-[12px] text-muted-foreground">
                                                    Restricts shift clock-in to branch store radius.
                                                </div>
                                            </div>
                                            {/* Native Apple Switch */}
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
                                    </div>
                                    <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">
                                        When active, staff devices must be physically detected within the store radius to clock in or out.
                                    </p>
                                </div>

                                <div>
                                    <div className="apple-section-header">Store Coordinates</div>
                                    <div className="apple-card overflow-hidden">
                                        <Link
                                            href={route('stores.index')}
                                            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 transition group"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="h-7 w-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                                    <MapPin className="h-4 w-4" />
                                                </div>
                                                <span className="text-[15px] font-medium text-foreground">
                                                    Calibrate Store GPS Radii
                                                </span>
                                            </div>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition shrink-0" />
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════════════════════
                        SUBPAGE 4: AI Assistant (Intelligence)
                    ══════════════════════════════════════════════════════════════════ */}
                    {currentPage === 'ai' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-3">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:opacity-80 active:scale-95 transition -ml-1"
                                >
                                    <ChevronLeft className="h-5 w-5 -mr-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="text-sm font-semibold text-foreground">
                                    AI Assistant (Intelligence)
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            <form onSubmit={submitAi} className="space-y-6">
                                <div>
                                    <div className="apple-section-header">Service Activation</div>
                                    <div className="apple-card overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-3.5">
                                            <span className="text-[15px] font-medium text-foreground">
                                                Enable Assistant
                                            </span>
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
                                    </div>
                                </div>

                                <div>
                                    <div className="apple-section-header">Engine & Credentials</div>
                                    <div className="apple-card overflow-hidden divide-y divide-border/60">
                                        <div className="px-4 py-3">
                                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                                Gemini Model
                                            </label>
                                            <select
                                                value={aiForm.data.ai_model}
                                                onChange={e => aiForm.setData('ai_model', e.target.value)}
                                                className="w-full bg-transparent text-[15px] font-medium text-foreground focus:outline-none py-1"
                                            >
                                                <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Recommended)</option>
                                                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Fast)</option>
                                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                                                <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
                                            </select>
                                        </div>

                                        <div className="px-4 py-3">
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                                    Gemini API Key
                                                </label>
                                                {settings.ai_api_key && (
                                                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                        <Check className="h-3 w-3" /> Configured
                                                    </span>
                                                )}
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type={showApiKey ? 'text' : 'password'}
                                                    placeholder={settings.ai_api_key ? '••••••••••••••••••••••••' : 'AIzaSy...'}
                                                    value={aiForm.data.ai_api_key}
                                                    onChange={e => aiForm.setData('ai_api_key', e.target.value)}
                                                    className="w-full bg-transparent text-[14px] font-mono text-foreground focus:outline-none placeholder:text-muted-foreground/50 py-1 pr-8"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowApiKey(!showApiKey)}
                                                    className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                                                >
                                                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Test Connection Button */}
                                    <div className="flex items-center gap-2 pt-2 px-1">
                                        <button
                                            type="button"
                                            onClick={handleTestConnection}
                                            disabled={testingConnection || (!aiForm.data.ai_api_key && !settings.ai_api_key)}
                                            className="px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted/50 transition disabled:opacity-50 flex items-center gap-1.5"
                                        >
                                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                                            {testingConnection ? 'Testing...' : 'Test Connection'}
                                        </button>
                                        {testResult && (
                                            <span className={`text-xs font-medium ${testResult.success ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {testResult.message}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <div className="apple-section-header">Store Directives</div>
                                    <div className="apple-card overflow-hidden">
                                        <div className="px-4 py-3">
                                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                                Global Custom Instructions
                                            </label>
                                            <textarea
                                                rows={3}
                                                placeholder="e.g. Always prioritize battery health check and warranty policy..."
                                                value={aiForm.data.ai_system_instruction}
                                                onChange={e => aiForm.setData('ai_system_instruction', e.target.value)}
                                                className="w-full bg-transparent text-[14px] text-foreground focus:outline-none placeholder:text-muted-foreground/50 py-1 resize-none"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section-specific Save Button */}
                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={aiForm.processing}
                                        className="w-full apple-btn-primary py-3 text-sm font-semibold shadow-sm"
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
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-200">
                            {/* Top Navigation Bar with Back button */}
                            <div className="flex items-center justify-between border-b border-border/40 pb-3">
                                <button
                                    type="button"
                                    onClick={() => navigateTo('root')}
                                    className="inline-flex items-center gap-1 text-[15px] font-medium text-primary hover:opacity-80 active:scale-95 transition -ml-1"
                                >
                                    <ChevronLeft className="h-5 w-5 -mr-1" />
                                    <span>Settings</span>
                                </button>
                                <h2 className="text-sm font-semibold text-foreground">
                                    Staff Shift Schedules
                                </h2>
                                <div className="w-16"></div>
                            </div>

                            {/* Add Custom Schedule Form */}
                            <form onSubmit={submitSchedule} className="space-y-4">
                                <div className="apple-section-header">Add Employee Custom Schedule</div>
                                <div className="apple-card overflow-hidden divide-y divide-border/60">
                                    <div className="px-4 py-3">
                                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                            Employee
                                        </label>
                                        <select
                                            value={scheduleForm.data.user_id}
                                            onChange={e => scheduleForm.setData('user_id', e.target.value)}
                                            className="w-full bg-transparent text-[15px] font-medium text-foreground focus:outline-none py-1"
                                        >
                                            <option value="">Select Employee...</option>
                                            {employees.map(emp => (
                                                <option key={emp.id} value={emp.id}>{emp.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="px-4 py-3">
                                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                            Store Branch
                                        </label>
                                        <select
                                            value={scheduleForm.data.store_id}
                                            onChange={e => scheduleForm.setData('store_id', e.target.value)}
                                            className="w-full bg-transparent text-[15px] font-medium text-foreground focus:outline-none py-1"
                                        >
                                            <option value="">Select Branch...</option>
                                            {stores.map(st => (
                                                <option key={st.id} value={st.id}>{st.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="grid grid-cols-2 divide-x divide-border/60">
                                        <div className="px-4 py-3">
                                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                                Clock In
                                            </label>
                                            <input
                                                type="time"
                                                value={scheduleForm.data.work_start_time}
                                                onChange={e => scheduleForm.setData('work_start_time', e.target.value)}
                                                className="w-full bg-transparent text-sm font-mono text-foreground focus:outline-none py-1"
                                            />
                                        </div>
                                        <div className="px-4 py-3">
                                            <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                                                Clock Out
                                            </label>
                                            <input
                                                type="time"
                                                value={scheduleForm.data.work_end_time}
                                                onChange={e => scheduleForm.setData('work_end_time', e.target.value)}
                                                className="w-full bg-transparent text-sm font-mono text-foreground focus:outline-none py-1"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={scheduleForm.processing || !scheduleForm.data.user_id || !scheduleForm.data.store_id}
                                    className="w-full apple-btn-primary py-3 text-sm font-semibold shadow-sm"
                                >
                                    {scheduleForm.processing ? 'Saving...' : 'Add Schedule'}
                                </button>
                            </form>

                            {/* Existing Schedules List */}
                            <div className="pt-2">
                                <div className="apple-section-header flex items-center justify-between">
                                    <span>Configured Custom Schedules</span>
                                    <span className="font-mono text-xs">{schedules.length}</span>
                                </div>
                                <div className="apple-card overflow-hidden divide-y divide-border/60">
                                    {schedules.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-muted-foreground">
                                            No custom schedules. All staff use default working hours.
                                        </div>
                                    ) : (
                                        schedules.map(sch => (
                                            <div key={sch.id} className="flex items-center justify-between px-4 py-3.5">
                                                <div className="min-w-0">
                                                    <div className="text-[15px] font-semibold text-foreground truncate">
                                                        {sch.user?.name || 'Staff Member'}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
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
                                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"
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
