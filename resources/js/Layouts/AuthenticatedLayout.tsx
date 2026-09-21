import ApplicationLogo from '@/Components/ApplicationLogo';
import Dropdown from '@/Components/Dropdown';
import ResponsiveNavLink from '@/Components/ResponsiveNavLink';
import { Link, usePage } from '@inertiajs/react';
import { PropsWithChildren, ReactNode, useState, useEffect } from 'react';
import {
    LayoutDashboard,
    Smartphone,
    Layers,
    Store,
    UserCog,
    History,
    Users,
    Clock,
    Sun,
    Moon,
    X,
    Settings as SettingsIcon,
    Activity,
    MoreHorizontal,
    LogOut,
    User,
    Banknote,
    ChevronRight,
    Sparkles,
} from 'lucide-react';
import GeminiStar from '@/Components/GeminiStar';

export default function Authenticated({
    header,
    children,
    hideMobileNav = false,
    hideNavbar = false,
}: PropsWithChildren<{ header?: ReactNode; hideMobileNav?: boolean; hideNavbar?: boolean }>) {
    const user = usePage().props.auth.user;

    const [showMobileMore, setShowMobileMore] = useState(false);

    const toggleMobileMore = () => {
        setShowMobileMore(!showMobileMore);
    };

    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('theme');
            if (saved === 'dark' || saved === 'light') return saved;
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'light';
    });

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [theme]);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            const saved = localStorage.getItem('theme');
            if (!saved) {
                setTheme(e.matches ? 'dark' : 'light');
            }
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
    };

    const { isClockedIn } = (usePage().props.auth as any);
    const isKaryawan = user.role === 'karyawan';
    const isKaryawanNotCheckedIn = isKaryawan && !isClockedIn;

    const statusAccent = isKaryawan
        ? isClockedIn
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-500 dark:text-rose-400'
        : '';

    const statusBg = isKaryawan
        ? isClockedIn
            ? 'bg-emerald-500/8 dark:bg-emerald-500/12 border-emerald-500/20'
            : 'bg-rose-500/8 dark:bg-rose-500/12 border-rose-500/20'
        : 'bg-white/70 dark:bg-black/50 border-white/25 dark:border-white/10';

    const navLink = (isActive: boolean) => {
        const base = 'apple-nav-pill ';
        if (isKaryawan && !isClockedIn) {
            return base + (isActive
                ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                : 'text-rose-400/70 hover:bg-rose-500/10 hover:text-rose-600');
        }
        if (isKaryawan && isClockedIn) {
            return base + (isActive
                ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                : 'text-emerald-500/70 hover:bg-emerald-500/10 hover:text-emerald-600');
        }
        return base + (isActive ? 'apple-nav-pill-active' : 'apple-nav-pill-inactive');
    };

    const getMobileTabs = () => {
        const tabs = [
            { name: 'Sell', href: route('selling.index'), icon: Smartphone, current: route().current('selling.index') },
            { name: 'Dashboard', href: route('dashboard'), icon: LayoutDashboard, current: route().current('dashboard') },
        ];
        if (user.role !== 'karyawan') {
            tabs.push({ name: 'Inventory', href: route('sale-data.index'), icon: Layers, current: route().current('sale-data.index') });
        }
        tabs.push({ name: 'Activity', href: route('timeline.index'), icon: Activity, current: route().current('timeline.index') });
        return tabs;
    };

    const getMoreMenuItems = () => {
        const items: { name: string; href: string; icon: any; current: boolean }[] = [];
        items.push({ name: 'Assistant', href: route('assistant.index'), icon: GeminiStar, current: route().current('assistant.index') });
        items.push({ name: 'Visualize', href: route('assistant.visualization'), icon: Sparkles, current: route().current('assistant.visualization') });
        items.push({ name: 'History', href: route('sales-history.index'), icon: History, current: route().current('sales-history.index') });
        items.push({ name: 'Customers', href: route('customers.index'), icon: Users, current: route().current('customers.index') });
        items.push({ name: 'Shifts', href: route('shifts.index'), icon: Clock, current: route().current('shifts.index') });
        if (user.role === 'superadmin') {
            items.push({ name: 'Stores', href: route('stores.index'), icon: Store, current: route().current('stores.index') });
            items.push({ name: 'Cash Notes', href: route('money-notes.index'), icon: Banknote, current: route().current('money-notes.index') });
        }
        return items;
    };

    const mobileTabs = getMobileTabs();
    const activeTabColor = isKaryawanNotCheckedIn
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-primary';
    const activeTabBg = isKaryawanNotCheckedIn
        ? 'bg-rose-500/12'
        : 'bg-primary/10';

    return (
        <div className="min-h-screen bg-background text-foreground transition-colors duration-300 font-sans">

            {!hideNavbar && (
            <nav className={`hidden sm:block sticky top-0 z-50 transition-all duration-300 backdrop-blur-2xl border-b ${statusBg}`}>
                <div className="mx-auto max-w-none px-5 lg:px-8">
                    <div className="flex h-[52px] items-center justify-between gap-4">

                        {/* Brand Logo */}
                        <Link href={route('dashboard')} className="flex items-center gap-2.5 shrink-0">
                            <ApplicationLogo className={`h-8 w-auto fill-current ${isKaryawan ? statusAccent : 'text-primary'}`} />
                            <span className={`text-[15px] font-bold tracking-tight hidden lg:block ${isKaryawan ? statusAccent : 'text-foreground'}`}>
                                Daily Phone
                            </span>
                        </Link>

                        {}
                        <div className="hidden sm:flex items-center gap-0.5 flex-1 justify-center">
                            <Link href={route('dashboard')} prefetch className={navLink(!!route().current('dashboard'))}>
                                <LayoutDashboard className="h-4 w-4" />
                                <span>Dashboard</span>
                            </Link>

                            <Link href={route('selling.index')} prefetch className={navLink(!!route().current('selling.index'))}>
                                <Smartphone className="h-4 w-4" />
                                <span>Sell</span>
                            </Link>

                            {user.role !== 'karyawan' && (
                                <Link href={route('sale-data.index')} prefetch className={navLink(!!route().current('sale-data.index'))}>
                                    <Layers className="h-4 w-4" />
                                    <span>Inventory</span>
                                </Link>
                            )}

                            <Link href={route('timeline.index')} prefetch className={navLink(!!route().current('timeline.index'))}>
                                <Activity className="h-4 w-4" />
                                <span>Activity</span>
                            </Link>

                            <Link href={route('assistant.index')} prefetch className={navLink(!!route().current('assistant.index'))}>
                                <GeminiStar className="h-4 w-4 text-primary" />
                                <span>Assistant</span>
                            </Link>

                            <Link href={route('sales-history.index')} prefetch className={navLink(!!route().current('sales-history.index'))}>
                                <History className="h-4 w-4" />
                                <span>History</span>
                            </Link>

                            <div className="hidden xl:flex items-center gap-0.5">
                                <Link href={route('customers.index')} prefetch className={navLink(!!route().current('customers.index'))}>
                                    <Users className="h-4 w-4" />
                                    <span>Customers</span>
                                </Link>

                                <Link href={route('shifts.index')} prefetch className={navLink(!!route().current('shifts.index'))}>
                                    <Clock className="h-4 w-4" />
                                    <span>Shifts</span>
                                </Link>

                                {user.role === 'superadmin' && (
                                    <>
                                        <Link href={route('stores.index')} prefetch className={navLink(!!route().current('stores.index'))}>
                                            <Store className="h-4 w-4" />
                                            <span>Stores</span>
                                        </Link>
                                        <Link href={route('money-notes.index')} prefetch className={navLink(!!route().current('money-notes.index'))}>
                                            <Banknote className="h-4 w-4" />
                                            <span>Cash Notes</span>
                                        </Link>
                                    </>
                                )}
                            </div>

                            <div className="xl:hidden">
                                <Dropdown>
                                    <Dropdown.Trigger>
                                        <button
                                            type="button"
                                            className={navLink(
                                                !!route().current('customers.index') ||
                                                !!route().current('assistant.visualization') ||
                                                !!route().current('shifts.index') ||
                                                !!route().current('stores.index') ||
                                                !!route().current('money-notes.index')
                                            )}
                                        >
                                            <MoreHorizontal className="h-4 w-4" />
                                            <span>More</span>
                                        </button>
                                    </Dropdown.Trigger>
                                    <Dropdown.Content align="right" width="48">
                                        <Dropdown.Link href={route('assistant.visualization')}>
                                            <span className="flex items-center gap-2">
                                                <Sparkles className="h-4 w-4 text-muted-foreground" />
                                                Visualize
                                            </span>
                                        </Dropdown.Link>
                                        <Dropdown.Link href={route('customers.index')}>
                                            <span className="flex items-center gap-2">
                                                <Users className="h-4 w-4 text-muted-foreground" />
                                                Customers
                                            </span>
                                        </Dropdown.Link>
                                        <Dropdown.Link href={route('shifts.index')}>
                                            <span className="flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-muted-foreground" />
                                                Shifts
                                            </span>
                                        </Dropdown.Link>
                                        {user.role === 'superadmin' && (
                                            <>
                                                <Dropdown.Link href={route('stores.index')}>
                                                    <span className="flex items-center gap-2">
                                                        <Store className="h-4 w-4 text-muted-foreground" />
                                                        Stores
                                                    </span>
                                                </Dropdown.Link>
                                                <Dropdown.Link href={route('money-notes.index')}>
                                                    <span className="flex items-center gap-2">
                                                        <Banknote className="h-4 w-4 text-muted-foreground" />
                                                        Cash Notes
                                                    </span>
                                                </Dropdown.Link>
                                            </>
                                        )}
                                    </Dropdown.Content>
                                </Dropdown>
                            </div>
                        </div>

                        <div className="hidden sm:flex items-center gap-2 shrink-0">
                            <button
                                onClick={toggleTheme}
                                className="p-2 rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground transition-all duration-200"
                                title="Toggle Theme"
                            >
                                {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
                            </button>

                            {user.role === 'superadmin' && (
                                <Link
                                    href={route('settings.general')}
                                    prefetch
                                    className={navLink(
                                        !!route().current('settings.general') ||
                                        !!route().current('settings.parameters') ||
                                        !!route().current('users.index') ||
                                        !!route().current('settings.ai.training-notes')
                                    )}
                                    title="Settings"
                                >
                                    <SettingsIcon className="h-4 w-4" />
                                    <span>Settings</span>
                                </Link>
                            )}

                            <div className="relative">
                                <Dropdown>
                                    <Dropdown.Trigger>
                                        <button
                                            type="button"
                                            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-foreground/6 hover:bg-foreground/10 transition-all duration-200"
                                        >
                                            <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                                                <span className="text-[10px] font-bold text-primary">
                                                    {user.name.charAt(0).toUpperCase()}
                                                </span>
                                            </div>
                                            <span className="text-[13px] font-medium text-foreground max-w-[100px] truncate">
                                                {user.name}
                                            </span>
                                        </button>
                                    </Dropdown.Trigger>
                                    <Dropdown.Content>
                                        <Dropdown.Link href={route('profile.edit')}>Profile</Dropdown.Link>
                                        <Dropdown.Link href={route('logout')} method="post" as="button">
                                            Log Out
                                        </Dropdown.Link>
                                    </Dropdown.Content>
                                </Dropdown>
                            </div>
                        </div>
                    </div>
                </div>
            </nav>
            )}

            {!hideMobileNav && (
                <div className="sm:hidden fixed bottom-3 left-4 right-4 z-50 transition-all duration-300 pointer-events-none"
                    style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                    <div className={`pointer-events-auto mx-auto max-w-md h-[58px] px-2 rounded-full apple-floating-glass transition-all duration-300 flex items-center justify-around ${
                        isKaryawan
                            ? isClockedIn
                                ? 'ring-1 ring-emerald-500/30'
                                : 'ring-1 ring-rose-500/30'
                            : ''
                    }`}>
                    {mobileTabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <Link
                                key={tab.name}
                                href={tab.href}
                                prefetch
                                className={`flex flex-col items-center justify-center flex-1 py-1 gap-0.5 transition-all duration-200 ${
                                    tab.current
                                        ? activeTabColor
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <div className={`relative flex items-center justify-center w-10 h-6 rounded-full transition-all duration-200 ${
                                    tab.current ? activeTabBg : ''
                                }`}>
                                    <Icon className="h-5 w-5" strokeWidth={tab.current ? 2.2 : 1.8} />
                                </div>
                                <span className={`text-[10px] leading-none ${tab.current ? 'font-semibold' : 'font-medium'}`}>
                                    {tab.name}
                                </span>
                            </Link>
                        );
                    })}

                    <button
                        onClick={toggleMobileMore}
                        className={`flex flex-col items-center justify-center flex-1 py-1 gap-0.5 transition-all duration-200 ${
                            showMobileMore ? activeTabColor : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <div className={`flex items-center justify-center w-10 h-6 rounded-full transition-all duration-200 ${showMobileMore ? activeTabBg : ''}`}>
                            <MoreHorizontal className="h-5 w-5" strokeWidth={showMobileMore ? 2.2 : 1.8} />
                        </div>
                        <span className={`text-[10px] leading-none ${showMobileMore ? 'font-semibold' : 'font-medium'}`}>More</span>
                    </button>
                </div>
            </div>
            )}

            {showMobileMore && (
                <>
                    <div
                        className="sm:hidden fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-xs z-40 transition-opacity"
                        onClick={toggleMobileMore}
                    />

                    <div className="sm:hidden fixed bottom-[calc(72px+env(safe-area-inset-bottom,0px))] left-3 right-3 max-w-[340px] mx-auto z-40
                                    apple-floating-glass
                                    rounded-2xl border border-border/80 shadow-xl
                                    animate-in slide-in-from-bottom-2 duration-200 overflow-hidden">

                        {/* Drag indicator */}
                        <div className="flex justify-center pt-2 pb-1">
                            <div className="w-8 h-1 rounded-full bg-foreground/20" />
                        </div>

                        {/* Compact Header: User Info & Theme */}
                        <div className="flex items-center justify-between px-3.5 py-2 border-b border-border/40">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                                    <span className="text-xs font-bold text-primary">
                                        {user.name.charAt(0).toUpperCase()}
                                    </span>
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{user.name}</p>
                                    <p className="text-[10px] text-muted-foreground capitalize">{user.role}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition"
                            >
                                {theme === 'dark' ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <Moon className="h-3.5 w-3.5 text-slate-600" />}
                            </button>
                        </div>

                        {/* Menu Items */}
                        <div className="p-1.5 max-h-[320px] overflow-y-auto space-y-0.5">
                            {getMoreMenuItems().map((item) => {
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.name}
                                        href={item.href}
                                        onClick={() => setShowMobileMore(false)}
                                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition ${
                                            item.current
                                                ? 'bg-primary/10 text-primary'
                                                : 'hover:bg-muted text-foreground'
                                        }`}
                                    >
                                        <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                                            item.current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                                        }`}>
                                            <Icon className="h-3.5 w-3.5" />
                                        </div>
                                        <span className="text-xs font-semibold flex-1">{item.name}</span>
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                                    </Link>
                                );
                            })}

                            {user.role === 'superadmin' && (
                                <Link
                                    href={route('settings.general')}
                                    onClick={() => setShowMobileMore(false)}
                                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition ${
                                        route().current('settings.general') || route().current('settings.parameters') || route().current('settings.ai.training-notes') || route().current('settings.ai.skills')
                                            ? 'bg-primary/10 text-primary'
                                            : 'hover:bg-muted text-foreground'
                                    }`}
                                >
                                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                                        route().current('settings.general') || route().current('settings.parameters') || route().current('settings.ai.training-notes') || route().current('settings.ai.skills')
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted text-muted-foreground'
                                    }`}>
                                        <SettingsIcon className="h-3.5 w-3.5" />
                                    </div>
                                    <span className="text-xs font-semibold flex-1">Settings</span>
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                                </Link>
                            )}
                        </div>

                        {/* Compact Bottom Actions */}
                        <div className="px-2 pb-2 pt-1 border-t border-border/40 space-y-1">
                            <Link
                                href={route('profile.edit')}
                                onClick={() => setShowMobileMore(false)}
                                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-muted text-foreground transition"
                            >
                                <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                                    <User className="h-3.5 w-3.5" />
                                </div>
                                <span className="text-xs font-semibold flex-1">My Profile</span>
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                            </Link>

                            <Link
                                method="post"
                                href={route('logout')}
                                as="button"
                                className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-destructive/10 hover:bg-destructive/15 text-destructive transition"
                            >
                                <div className="h-7 w-7 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
                                    <LogOut className="h-3.5 w-3.5" />
                                </div>
                                <span className="text-xs font-bold flex-1 text-left">Log Out</span>
                            </Link>
                        </div>
                    </div>
                </>
            )}

            <main className={`${hideMobileNav ? 'pb-0' : 'pb-[calc(84px+env(safe-area-inset-bottom,0px))]'} sm:pb-0 transition-colors duration-300`}>
                {header && (
                    <div className="mx-auto max-w-none px-4 pt-6 sm:px-6 lg:px-8">
                        <div className="pb-2">
                            {header}
                        </div>
                    </div>
                )}
                {children}
            </main>
        </div>
    );
}
