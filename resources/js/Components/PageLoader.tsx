import { useEffect, useState, useRef } from 'react';
import { router } from '@inertiajs/react';
import { Loader2 } from 'lucide-react';

/**
 * PageLoader — global Inertia navigation loading indicator.
 * Shows a centered loading pill (with dim overlay) whenever a navigation
 * takes longer than a short threshold, so loading never feels frozen.
 * No external dependencies.
 */
export default function PageLoader() {
    const [visible, setVisible] = useState(false);
    const [showSpinner, setShowSpinner] = useState(false);

    const fadeOutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const spinnerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const removeStart = router.on('start', () => {
            if (fadeOutRef.current) clearTimeout(fadeOutRef.current);
            setVisible(true);
            setShowSpinner(false);
            spinnerRef.current = setTimeout(() => setShowSpinner(true), 350);
        });

        const removeFinish = router.on('finish', () => {
            if (spinnerRef.current) clearTimeout(spinnerRef.current);
            setShowSpinner(false);
            fadeOutRef.current = setTimeout(() => setVisible(false), 300);
        });

        return () => {
            removeStart();
            removeFinish();
            if (fadeOutRef.current) clearTimeout(fadeOutRef.current);
            if (spinnerRef.current) clearTimeout(spinnerRef.current);
        };
    }, []);

    if (!visible) return null;

    return (
        <>
            {/* ── Very subtle page dim during active load ── */}
            <div
                className="fixed inset-0 z-[9998] pointer-events-none"
                style={{
                    backgroundColor: 'rgba(0,0,0,0.04)',
                    backdropFilter: 'brightness(0.97)',
                }}
            />

            {/* ── Centered loading pill ── */}
            {showSpinner && (
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