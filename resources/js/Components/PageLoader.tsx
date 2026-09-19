import { useEffect, useState, useRef } from 'react';
import { router } from '@inertiajs/react';
import { Loader2 } from 'lucide-react';

/**
 * PageLoader — global Inertia navigation loading indicator.
 * Shows a thin animated top progress bar driven by Inertia's real progress
 * events, plus a centered loading pill that appears when a request is slow,
 * so navigation never feels frozen. No external dependencies.
 */
export default function PageLoader() {
    const [visible, setVisible] = useState(false);
    const [progress, setProgress] = useState(0);
    const [showSpinner, setShowSpinner] = useState(false);

    const fadeOutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const spinnerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const removeStart = router.on('start', () => {
            if (fadeOutRef.current) clearTimeout(fadeOutRef.current);
            setProgress(0);
            setVisible(true);
            setShowSpinner(false);
            spinnerRef.current = setTimeout(() => setShowSpinner(true), 350);
        });

        const removeProgress = router.on('progress', (event) => {
            const percentage = (event as any).detail?.progress?.percentage;
            if (typeof percentage === 'number') {
                setProgress(Math.min(100, Math.max(0, percentage)));
            }
        });

        const removeFinish = router.on('finish', () => {
            if (spinnerRef.current) clearTimeout(spinnerRef.current);
            setProgress(100);
            setShowSpinner(false);
            fadeOutRef.current = setTimeout(() => {
                setVisible(false);
                setProgress(0);
            }, 300);
        });

        return () => {
            removeStart();
            removeProgress();
            removeFinish();
            if (fadeOutRef.current) clearTimeout(fadeOutRef.current);
            if (spinnerRef.current) clearTimeout(spinnerRef.current);
        };
    }, []);

    if (!visible) return null;

    return (
        <>
            {/* ── Top progress bar ── */}
            <div
                className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none"
                style={{ height: '3px' }}
            >
                <div
                    className="h-full bg-primary shadow-[0_0_10px_3px] shadow-primary/50 transition-all ease-out"
                    style={{
                        width: `${progress}%`,
                        opacity: progress >= 100 ? 0 : 1,
                        transition: 'width 250ms ease-out, opacity 250ms ease',
                    }}
                />
            </div>

            {/* ── Very subtle page dim during active load ── */}
            {progress < 100 && (
                <div
                    className="fixed inset-0 z-[9998] pointer-events-none"
                    style={{
                        backgroundColor: 'rgba(0,0,0,0.04)',
                        backdropFilter: 'brightness(0.97)',
                    }}
                />
            )}

            {/* ── Centered loading pill for slow loads ── */}
            {showSpinner && progress < 100 && (
                <div className="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center">
                    <div className="apple-floating-glass rounded-full px-4 py-2 flex items-center gap-2 shadow-xl border border-border/60">
                        <Loader2 className="h-4 w-4 text-primary animate-spin" />
                        <span className="text-xs font-semibold text-foreground">Loading…</span>
                    </div>
                </div>
            )}
        </>
    );
}