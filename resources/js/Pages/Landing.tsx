import { Head, Link } from '@inertiajs/react';
import ApplicationLogo from '@/Components/ApplicationLogo';
import { ArrowRight, Smartphone, ShieldCheck, BarChart3, Clock, Sparkles } from 'lucide-react';

export default function Landing() {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-primary selection:text-white font-sans transition-colors duration-300">
            <Head title="Daily Phone — POS & Inventory Platform" />

            {/* Navigation Bar */}
            <header className="sticky top-0 z-50 backdrop-blur-2xl bg-background/80 border-b border-border/60">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center shadow-xs">
                            <ApplicationLogo className="h-5 w-5 fill-current text-white" />
                        </div>
                        <span className="font-bold text-base tracking-tight text-foreground">Daily Phone</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link
                            href={route('login')}
                            className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-xs"
                        >
                            Open Portal
                            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                    </div>
                </div>
            </header>

            {/* Hero Section */}
            <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-16 sm:py-24 max-w-4xl mx-auto">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-border/80 bg-muted/50 text-muted-foreground text-xs font-medium mb-8 animate-in fade-in duration-300">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span>Next Generation Retail OS for Phone Stores</span>
                </div>

                <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-foreground leading-[1.1] max-w-3xl">
                    Unified POS, Inventory & Store Intelligence.
                </h1>

                <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl font-normal leading-relaxed">
                    Engineered with minimalist aesthetics and real-time synchronization. Manage multi-branch phones, live cashier shifts, and digital invoices seamlessly.
                </p>

                <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                    <Link
                        href={route('login')}
                        className="w-full sm:w-auto inline-flex items-center justify-center h-12 px-7 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all shadow-md"
                    >
                        Launch Daily Phone
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                </div>

                {/* Feature Highlights Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16 sm:mt-20 w-full text-left">
                    <div className="apple-card p-5">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                            <Smartphone className="h-5 w-5" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">Unit & IMEI Tracking</h3>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                            Exact serial number lifecycle management, multi-branch stock transfers, and quick checkout.
                        </p>
                    </div>

                    <div className="apple-card p-5">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                            <Clock className="h-5 w-5" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">Shift & Attendance</h3>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                            GPS-verified cashier shifts, opening cash reconciliation, petty cash, and automated payroll.
                        </p>
                    </div>

                    <div className="apple-card p-5">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                            <BarChart3 className="h-5 w-5" />
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">Executive Analytics</h3>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                            Ultra-clean financial telemetry, profit calculations, real-time activity feed, and digital invoices.
                        </p>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
                <p>© {new Date().getFullYear()} Daily Phone. All rights reserved.</p>
            </footer>
        </div>
    );
}
