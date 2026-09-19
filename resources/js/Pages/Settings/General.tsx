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
    Save, 
    Eye, 
    EyeOff, 
    CheckCircle2, 
    AlertCircle, 
    ChevronRight,
    Mail,
    Bell,
    Layers,
    ExternalLink
} from 'lucide-react';
import { FormEvent, useState } from 'react';

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

type SettingsSection = 'company' | 'work_policy' | 'geofence' | 'ai' | 'shifts' | 'quick_links';

export default function General({ settings, schedules, employees, stores }: GeneralProps) {
    const [activeSection, setActiveSection] = useState<SettingsSection>('company');
    const [showApiKey, setShowApiKey] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

    const settingsForm = useForm({
        company_name: settings.company_name || 'Daily Phone',
        work_start_time: settings.work_start_time || '09:00:00',
        work_end_time: settings.work_end_time || '18:00:00',
        grace_period_minutes: settings.grace_period_minutes || 15,
        geofence_lock_enabled: settings.geofence_lock_enabled,
        notification_emails: settings.notification_emails || '',
        ai_enabled: settings.ai_enabled ?? true,
        ai_provider: settings.ai_provider || 'gemini',
        ai_api_key: settings.ai_api_key || '',
        ai_model: settings.ai_model || 'gemini-3.5-flash-lite',
        ai_system_instruction: settings.ai_system_instruction || '',
        clear_ai_api_key: false,
    });

    const scheduleForm = useForm({
        user_id: '',
        store_id: '',
        work_start_time: '',
        work_end_time: '',
        grace_period_minutes: '',
    });

    const submitGeneralSettings = (e: FormEvent) => {
        e.preventDefault();
        settingsForm.post(route('settings.general.update'), {
            onSuccess: () => {
                alert('Settings saved successfully.');
            }
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
                    api_key: settingsForm.data.ai_api_key,
                    model: settingsForm.data.ai_model,
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

    const submitSchedule = (e: FormEvent) => {
        e.preventDefault();
        if (!scheduleForm.data.user_id || !scheduleForm.data.store_id) {
            alert('Please select an employee and store branch.');
            return;
        }

        scheduleForm.post(route('settings.schedule.store'), {
            onSuccess: () => {
                scheduleForm.reset();
                alert('Employee shift schedule saved.');
            }
        });
    };

    const deleteSchedule = (id: number) => {
        if (confirm('Are you sure you want to remove this shift schedule?')) {
            router.delete(route('settings.schedule.destroy', id), {
                onSuccess: () => {
                    alert('Shift schedule removed.');
                }
            });
        }
    };

    const navItems = [
        {
            id: 'company' as SettingsSection,
            label: 'Company & Notifications',
            description: 'Organization identity and alerts',
            icon: Building2,
            iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        },
        {
            id: 'work_policy' as SettingsSection,
            label: 'Working Hours & Policy',
            description: 'Store opening hours and late grace period',
            icon: Clock,
            iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        },
        {
            id: 'geofence' as SettingsSection,
            label: 'Security & Geofence',
            description: 'GPS boundary lock and anti-spoofing',
            icon: ShieldCheck,
            iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        },
        {
            id: 'ai' as SettingsSection,
            label: 'AI Assistant (Intelligence)',
            description: 'Gemini model and system prompts',
            icon: Sparkles,
            iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
        },
        {
            id: 'shifts' as SettingsSection,
            label: 'Staff Shift Schedules',
            description: 'Custom staff hours per branch',
            icon: Users,
            iconBg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
        },
        {
            id: 'quick_links' as SettingsSection,
            label: 'System Master Data',
            description: 'Branch stores, parameters, and accounts',
            icon: Layers,
            iconBg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
        },
    ];

    return (
        <AuthenticatedLayout>
            <Head title="System Settings" />

            <div className="py-8">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-6">

                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/40">
                        <div>
                            <div className="flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-wider mb-1">
                                <Settings className="h-4 w-4" />
                                <span>Preferences</span>
                            </div>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">
                                System Settings
                            </h1>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Configure store parameters, working schedules, security boundaries, and intelligence services.
                            </p>
                        </div>

                        {/* Top Save button if editing global settings */}
                        {activeSection !== 'shifts' && activeSection !== 'quick_links' && (
                            <button
                                type="button"
                                onClick={submitGeneralSettings}
                                disabled={settingsForm.processing}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 active:scale-[0.98] transition disabled:opacity-50"
                            >
                                <Save className="h-3.5 w-3.5" />
                                {settingsForm.processing ? 'Saving...' : 'Save Changes'}
                            </button>
                        )}
                    </div>

                    {/* iOS Grouped Layout: Sidebar Navigation + Group Content */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

                        {/* Left Navigation Menu (iOS Grouped Style) */}
                        <div className="lg:col-span-4 space-y-3">
                            <div className="apple-card overflow-hidden p-2 text-card-foreground">
                                <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Settings Categories
                                </div>
                                <div className="space-y-1">
                                    {navItems.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = activeSection === item.id;
                                        return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => setActiveSection(item.id)}
                                                className={`w-full flex items-center justify-between p-2.5 rounded-xl transition text-left ${
                                                    isActive
                                                        ? 'bg-primary/10 text-primary font-semibold'
                                                        : 'hover:bg-muted/50 text-foreground'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${item.iconBg}`}>
                                                        <Icon className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-medium truncate">{item.label}</div>
                                                        <div className="text-[10px] text-muted-foreground truncate">{item.description}</div>
                                                    </div>
                                                </div>
                                                <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${isActive ? 'text-primary translate-x-0.5' : 'text-muted-foreground/40'}`} />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Summary Badge */}
                            <div className="rounded-2xl border border-border/40 bg-muted/20 p-4 text-xs text-muted-foreground">
                                <div className="flex items-center gap-2 font-semibold text-foreground mb-1">
                                    <ShieldCheck className="h-4 w-4 text-primary" />
                                    <span>Superadmin Access</span>
                                </div>
                                <p className="text-[11px] leading-relaxed">
                                    Changes made in these panels take effect immediately across all client sessions and store registers.
                                </p>
                            </div>
                        </div>

                        {/* Right Content Area (Grouped Cards) */}
                        <div className="lg:col-span-8">
                            <form onSubmit={submitGeneralSettings}>

                                {/* SECTION 1: Company & Notifications */}
                                {activeSection === 'company' && (
                                    <div className="space-y-4">
                                        <div className="apple-card p-6 text-card-foreground">
                                            <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border/50">
                                                <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                                    <Building2 className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-semibold text-foreground">Company Identity</h3>
                                                    <p className="text-xs text-muted-foreground">Store branding shown on receipts, invoices, and navigation.</p>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">Company / Store Name</label>
                                                    <input
                                                        type="text"
                                                        value={settingsForm.data.company_name}
                                                        onChange={e => settingsForm.setData('company_name', e.target.value)}
                                                        placeholder="Daily Phone"
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:border-primary"
                                                    />
                                                    {settingsForm.errors.company_name && (
                                                        <p className="text-xs text-destructive mt-1">{settingsForm.errors.company_name}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="apple-card p-6 text-card-foreground">
                                            <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border/50">
                                                <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                                                    <Bell className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-semibold text-foreground">Alerts & Notifications</h3>
                                                    <p className="text-xs text-muted-foreground">Recipients for automated alerts, cash drop reports, and payroll statements.</p>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">
                                                        Payroll & Cash Drop Alert Email
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            type="email"
                                                            placeholder="owner@dailyphone.com"
                                                            value={settingsForm.data.notification_emails || ''}
                                                            onChange={e => settingsForm.setData('notification_emails', e.target.value)}
                                                            className="w-full rounded-xl border border-border/60 bg-background pl-9 pr-3.5 py-2.5 text-sm font-medium focus:outline-none focus:border-primary"
                                                        />
                                                        <Mail className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground mt-1.5">
                                                        Digital payslips and end-of-shift petty cash reconciliations will be forwarded to this inbox.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* SECTION 2: Working Hours & Policy */}
                                {activeSection === 'work_policy' && (
                                    <div className="apple-card p-6 text-card-foreground">
                                        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border/50">
                                            <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                                                <Clock className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground">Default Store Working Hours</h3>
                                                <p className="text-xs text-muted-foreground">Standard operational window applied to all staff members by default.</p>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">Default Clock-In Time</label>
                                                    <input
                                                        type="time"
                                                        step="1"
                                                        value={settingsForm.data.work_start_time}
                                                        onChange={e => settingsForm.setData('work_start_time', e.target.value)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:border-primary font-mono"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">Default Clock-Out Time</label>
                                                    <input
                                                        type="time"
                                                        step="1"
                                                        value={settingsForm.data.work_end_time}
                                                        onChange={e => settingsForm.setData('work_end_time', e.target.value)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:border-primary font-mono"
                                                    />
                                                </div>
                                            </div>

                                            <div className="pt-2">
                                                <label className="block text-xs font-medium text-foreground mb-1.5">
                                                    Late Grace Period (Minutes)
                                                </label>
                                                <div className="relative max-w-xs">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="120"
                                                        value={settingsForm.data.grace_period_minutes}
                                                        onChange={e => settingsForm.setData('grace_period_minutes', parseInt(e.target.value) || 0)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:border-primary"
                                                    />
                                                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                                        minutes
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-muted-foreground mt-1.5">
                                                    Staff clocking in within this window after official start time will not be flagged as tardy.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* SECTION 3: Security & Geofence */}
                                {activeSection === 'geofence' && (
                                    <div className="apple-card p-6 text-card-foreground">
                                        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border/50">
                                            <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                                                <ShieldCheck className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground">Attendance Security & GPS Geofence</h3>
                                                <p className="text-xs text-muted-foreground">Prevent off-site attendance and enforce physical store presence.</p>
                                            </div>
                                        </div>

                                        <div className="space-y-6">
                                            <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border/60 bg-muted/20">
                                                <div className="space-y-0.5">
                                                    <div className="text-xs font-semibold text-foreground">Enforce GPS Geofence Lock</div>
                                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                        When enabled, staff mobile devices must provide accurate GPS coordinates matching their assigned store branch radius to clock in or out.
                                                    </p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                                    <input
                                                        type="checkbox"
                                                        checked={settingsForm.data.geofence_lock_enabled}
                                                        onChange={e => settingsForm.setData('geofence_lock_enabled', e.target.checked)}
                                                        className="sr-only peer"
                                                    />
                                                    <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                                </label>
                                            </div>

                                            <div className="rounded-xl border border-border/40 bg-card p-4 space-y-2">
                                                <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                                                    <StoreIcon className="h-4 w-4 text-primary" />
                                                    <span>Branch Geofence Coordinates</span>
                                                </div>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Specific latitude, longitude, and allowed radius meters can be calibrated individually per branch in the Store Management menu.
                                                </p>
                                                <div className="pt-2">
                                                    <Link
                                                        href={route('stores.index')}
                                                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                                                    >
                                                        Manage Store Coordinates <ExternalLink className="h-3 w-3" />
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* SECTION 4: AI Intelligence */}
                                {activeSection === 'ai' && (
                                    <div className="apple-card p-6 text-card-foreground">
                                        <div className="flex items-center justify-between mb-5 pb-3 border-b border-border/50">
                                            <div className="flex items-center gap-3">
                                                <div className="h-9 w-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                                                    <Sparkles className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-semibold text-foreground">AI Assistant Configuration</h3>
                                                    <p className="text-xs text-muted-foreground">Empowers inventory search, shift summaries, and automated cashier proposals.</p>
                                                </div>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                                <input
                                                    type="checkbox"
                                                    checked={settingsForm.data.ai_enabled}
                                                    onChange={e => settingsForm.setData('ai_enabled', e.target.checked)}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                            </label>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-medium text-foreground mb-1.5">Gemini AI Model</label>
                                                <select
                                                    value={settingsForm.data.ai_model}
                                                    onChange={e => settingsForm.setData('ai_model', e.target.value)}
                                                    className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-primary"
                                                >
                                                    <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (500 RPD / 15 RPM — Recommended for daily operations)</option>
                                                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (500 RPD / 15 RPM — Fast & Lightweight)</option>
                                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Standard tier)</option>
                                                    <option value="gemini-3.5-flash">Gemini 3.5 Flash (Standard tier)</option>
                                                    <option value="gemini-3.8-flash">Gemini 3.8 Flash (High accuracy)</option>
                                                </select>
                                                <p className="text-[11px] text-muted-foreground mt-1.5">
                                                    Tip: <strong>Gemini Flash Lite</strong> offers a high free quota (500 requests/day), optimal for rapid point-of-sale operations.
                                                </p>
                                            </div>

                                            <div>
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <label className="block text-xs font-medium text-foreground">Google Gemini API Key</label>
                                                    {settings.ai_api_key && (
                                                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                            <CheckCircle2 className="h-3 w-3" /> Key securely configured
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="relative">
                                                    <input
                                                        type={showApiKey ? 'text' : 'password'}
                                                        placeholder={settings.ai_api_key ? '••••••••••••••••••••••••••••••••' : 'AIzaSy...'}
                                                        value={settingsForm.data.ai_api_key}
                                                        onChange={e => settingsForm.setData('ai_api_key', e.target.value)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 pr-10 text-xs font-medium focus:outline-none focus:border-primary font-mono"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowApiKey(!showApiKey)}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                    >
                                                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    onClick={handleTestConnection}
                                                    disabled={testingConnection || (!settingsForm.data.ai_api_key && !settings.ai_api_key)}
                                                    className="rounded-xl border border-border/70 bg-muted/40 hover:bg-muted/70 px-3.5 py-2 text-xs font-semibold text-foreground transition flex items-center gap-1.5 disabled:opacity-50"
                                                >
                                                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                                                    {testingConnection ? 'Testing Connection...' : 'Test Connection'}
                                                </button>
                                                {testResult && (
                                                    <span className={`text-xs font-semibold flex items-center gap-1.5 ${testResult.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                        {testResult.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                                                        {testResult.message}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="pt-2">
                                                <label className="block text-xs font-medium text-foreground mb-1.5">
                                                    Custom Store AI System Prompt (Optional)
                                                </label>
                                                <textarea
                                                    rows={3}
                                                    placeholder="e.g. Always emphasize warranty terms, highlight active promotions, and verify payment methods..."
                                                    value={settingsForm.data.ai_system_instruction || ''}
                                                    onChange={e => settingsForm.setData('ai_system_instruction', e.target.value)}
                                                    className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-medium focus:outline-none focus:border-primary resize-none"
                                                />
                                                <p className="text-[11px] text-muted-foreground mt-1">
                                                    This instruction is injected globally into all conversational assistant sessions.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </form>

                            {/* SECTION 5: Staff Shift Schedules */}
                            {activeSection === 'shifts' && (
                                <div className="space-y-6">
                                    <div className="apple-card p-6 text-card-foreground">
                                        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border/50">
                                            <div className="h-9 w-9 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                                                <Users className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground">Configure Custom Staff Schedule</h3>
                                                <p className="text-xs text-muted-foreground">Assign tailored working hours to specific staff members at designated store branches.</p>
                                            </div>
                                        </div>

                                        <form onSubmit={submitSchedule} className="space-y-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">Staff Member</label>
                                                    <select
                                                        value={scheduleForm.data.user_id}
                                                        onChange={e => scheduleForm.setData('user_id', e.target.value)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-primary"
                                                    >
                                                        <option value="">-- Choose Employee --</option>
                                                        {employees.map(emp => (
                                                            <option key={emp.id} value={emp.id}>{emp.name} ({emp.email})</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">Store Branch</label>
                                                    <select
                                                        value={scheduleForm.data.store_id}
                                                        onChange={e => scheduleForm.setData('store_id', e.target.value)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-primary"
                                                    >
                                                        <option value="">-- Choose Branch --</option>
                                                        {stores.map(st => (
                                                            <option key={st.id} value={st.id}>{st.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">Custom Clock-In (Optional)</label>
                                                    <input
                                                        type="time"
                                                        value={scheduleForm.data.work_start_time}
                                                        onChange={e => scheduleForm.setData('work_start_time', e.target.value)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-primary font-mono"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-foreground mb-1.5">Custom Clock-Out (Optional)</label>
                                                    <input
                                                        type="time"
                                                        value={scheduleForm.data.work_end_time}
                                                        onChange={e => scheduleForm.setData('work_end_time', e.target.value)}
                                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-primary font-mono"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex justify-end pt-2">
                                                <button
                                                    type="submit"
                                                    disabled={scheduleForm.processing}
                                                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                                                >
                                                    <Plus className="h-3.5 w-3.5" /> Add Staff Schedule
                                                </button>
                                            </div>
                                        </form>
                                    </div>

                                    {/* Table of Custom Schedules */}
                                    <div className="apple-card p-6 text-card-foreground">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="text-sm font-semibold text-foreground">Active Staff Custom Schedules</h3>
                                            <span className="text-xs text-muted-foreground font-mono">{schedules.length} configured</span>
                                        </div>

                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left text-xs border-collapse">
                                                <thead>
                                                    <tr className="border-b border-border/60 text-muted-foreground">
                                                        <th className="px-3.5 py-2.5 font-semibold">Staff</th>
                                                        <th className="px-3.5 py-2.5 font-semibold">Store Branch</th>
                                                        <th className="px-3.5 py-2.5 font-semibold">Scheduled Window</th>
                                                        <th className="px-3.5 py-2.5 text-right font-semibold">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border/40">
                                                    {schedules.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={4} className="px-4 py-8 text-center text-xs text-muted-foreground">
                                                                No custom schedules configured. All employees adhere to the company default working hours.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        schedules.map(sch => (
                                                            <tr key={sch.id} className="hover:bg-muted/30 transition">
                                                                <td className="px-3.5 py-3 font-medium text-foreground">
                                                                    {sch.user?.name || 'Unknown'}
                                                                </td>
                                                                <td className="px-3.5 py-3 text-muted-foreground">
                                                                    {sch.store?.name || 'All Stores'}
                                                                </td>
                                                                <td className="px-3.5 py-3 font-mono text-foreground">
                                                                    {sch.work_start_time || settings.work_start_time} - {sch.work_end_time || settings.work_end_time}
                                                                </td>
                                                                <td className="px-3.5 py-3 text-right">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => deleteSchedule(sch.id)}
                                                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                                                                        title="Delete custom schedule"
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* SECTION 6: Quick Links / Master Data */}
                            {activeSection === 'quick_links' && (
                                <div className="space-y-4">
                                    <div className="apple-card p-6 text-card-foreground">
                                        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border/50">
                                            <div className="h-9 w-9 rounded-xl bg-slate-500/10 text-slate-600 dark:text-slate-400 flex items-center justify-center">
                                                <Layers className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-semibold text-foreground">Master Data Navigation</h3>
                                                <p className="text-xs text-muted-foreground">Direct shortcuts to peripheral master catalogs and administrative tables.</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <Link
                                                href={route('settings.parameters')}
                                                className="p-4 rounded-2xl border border-border/60 hover:border-primary/50 hover:bg-muted/30 transition group flex items-start gap-3"
                                            >
                                                <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                                                    <Sliders className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-semibold text-foreground group-hover:text-primary transition flex items-center gap-1">
                                                        <span>Product & Unit Parameters</span>
                                                        <ExternalLink className="h-3 w-3 opacity-60" />
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                                        Configure item categories, device grades, color tags, and transaction conditions.
                                                    </p>
                                                </div>
                                            </Link>

                                            <Link
                                                href={route('stores.index')}
                                                className="p-4 rounded-2xl border border-border/60 hover:border-primary/50 hover:bg-muted/30 transition group flex items-start gap-3"
                                            >
                                                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                                    <StoreIcon className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-semibold text-foreground group-hover:text-primary transition flex items-center gap-1">
                                                        <span>Store Branches</span>
                                                        <ExternalLink className="h-3 w-3 opacity-60" />
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                                        Manage branch locations, physical addresses, and geofence boundary radii.
                                                    </p>
                                                </div>
                                            </Link>

                                            <Link
                                                href={route('users.index')}
                                                className="p-4 rounded-2xl border border-border/60 hover:border-primary/50 hover:bg-muted/30 transition group flex items-start gap-3"
                                            >
                                                <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                                                    <Users className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-semibold text-foreground group-hover:text-primary transition flex items-center gap-1">
                                                        <span>User & Staff Accounts</span>
                                                        <ExternalLink className="h-3 w-3 opacity-60" />
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                                        Register cashiers, manage roles, assign branch affiliations, and reset credentials.
                                                    </p>
                                                </div>
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            )}

                        </div>

                    </div>

                </div>
            </div>
        </AuthenticatedLayout>
    );
}
