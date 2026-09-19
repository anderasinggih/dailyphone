import { Head, useForm } from '@inertiajs/react';
import { FormEventHandler, useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import ApplicationLogo from '@/Components/ApplicationLogo';

export default function Login({
    status,
}: {
    status?: string;
}) {
    const { data, setData, post, processing, errors, reset } = useForm({
        email: '',
        password: '',
        remember: false as boolean,
    });

    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = (e: MediaQueryListEvent | MediaQueryList) => {
            if (e.matches) document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
        };
        apply(mediaQuery);
        mediaQuery.addEventListener('change', apply);
        return () => mediaQuery.removeEventListener('change', apply);
    }, []);

    const submit: FormEventHandler = (e) => {
        e.preventDefault();
        post(route('login'), {
            onFinish: () => reset('password'),
        });
    };

    return (
        <div className="min-h-screen bg-background flex flex-col justify-center items-center px-5 relative overflow-hidden font-sans transition-colors duration-300">
            <Head title="Sign In" />

            {}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-1/3 -left-1/4 w-[70%] h-[70%] rounded-full bg-primary/8 dark:bg-primary/12 blur-[100px]" />
                <div className="absolute -bottom-1/3 -right-1/4 w-[60%] h-[60%] rounded-full bg-primary/6 dark:bg-primary/10 blur-[100px]" />
            </div>

            <div className="w-full max-w-[380px] z-10 flex flex-col gap-6">

                {/* Brand Logo & Title */}
                <div className="flex flex-col items-center gap-3 pt-2">
                    <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/80 shadow-[0_8px_20px_rgba(0,122,255,0.28)] flex items-center justify-center">
                        <ApplicationLogo className="h-9 w-9 fill-current text-white" />
                    </div>

                    <div className="text-center">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Daily Phone</h1>
                        <p className="text-xs text-muted-foreground mt-1 font-normal">
                            Inventory & sales management platform
                        </p>
                    </div>
                </div>

                {status && (
                    <div className="px-4 py-2.5 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/20 text-xs font-medium text-emerald-600 dark:text-emerald-400 text-center">
                        {status}
                    </div>
                )}

                {/* Login Form Card */}
                <form onSubmit={submit} className="space-y-4">
                    <div className="apple-card p-4 space-y-3.5 bg-card/95 backdrop-blur-md">
                        {/* Email Input */}
                        <div>
                            <label htmlFor="email" className="block text-[11px] font-semibold text-muted-foreground mb-1 tracking-wide">
                                EMAIL ADDRESS
                            </label>
                            <input
                                id="email"
                                type="email"
                                name="email"
                                value={data.email}
                                autoComplete="username"
                                required
                                placeholder="admin@housephone.com"
                                onChange={(e) => setData('email', e.target.value)}
                                className="w-full rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                            />
                            {errors.email && (
                                <p className="text-[11px] font-medium text-destructive mt-1">{errors.email}</p>
                            )}
                        </div>

                        {/* Password Input */}
                        <div>
                            <label htmlFor="password" className="block text-[11px] font-semibold text-muted-foreground mb-1 tracking-wide">
                                PASSWORD
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    name="password"
                                    value={data.password}
                                    autoComplete="current-password"
                                    required
                                    placeholder="••••••••"
                                    onChange={(e) => setData('password', e.target.value)}
                                    className="w-full rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 pr-10 text-xs font-medium text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors p-1"
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {errors.password && (
                                <p className="text-[11px] font-medium text-destructive mt-1">{errors.password}</p>
                            )}
                        </div>

                        {/* Remember Me */}
                        <div className="pt-1">
                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    name="remember"
                                    checked={data.remember}
                                    onChange={(e) => setData('remember', e.target.checked)}
                                    className="h-4 w-4 rounded-md border-border/80 text-primary bg-background focus:ring-primary/40 transition"
                                />
                                <span className="text-xs text-muted-foreground font-medium">
                                    Remember this device
                                </span>
                            </label>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={processing}
                        className="w-full flex items-center justify-center h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all"
                    >
                        {processing ? (
                            <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            'Sign In'
                        )}
                    </button>
                </form>

                {/* Footer note */}
                <p className="text-center text-[11px] text-muted-foreground/80 font-normal pb-4">
                    © {new Date().getFullYear()} Daily Phone. All rights reserved.
                </p>
            </div>
        </div>
    );
}

