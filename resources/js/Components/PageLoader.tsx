import { useEffect, useState, useRef } from 'react';
import { router } from '@inertiajs/react';

/**
 * PageLoader — Inertia page transition loading indicator.
 * Shows a thin animated top progress bar and a very subtle page-dimming
 * overlay whenever Inertia is navigating between pages.
 * No external dependencies.
 */
export default function PageLoader() {
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [visible, setVisible] = useState(false);

    const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const fadeOutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const startProgress = () => {
        setProgress(0);
        setVisible(true);
        setLoading(true);

        // Simulate natural-feeling progress that slows near the end
        let p = 0;
        progressRef.current = setInterval(() => {
            p += Math.random() * 8 + 3; // advance 3–11% each tick
            if (p >= 90) {
                p = 90; // hold at 90% until done
                if (progressRef.current) clearInterval(progressRef.current);
            }
            setProgress(p);
        }, 140);
    };

    const finishProgress = () => {
        if (progressRef.current) {
            clearInterval(progressRef.current);
        }
        setProgress(100);
        setLoading(false);

        // Brief delay then fade out
        fadeOutRef.current = setTimeout(() => {
            setVisible(false);
            setProgress(0);
        }, 350);
    };

    useEffect(() => {
        const removeStart = router.on('start', () => {
            if (fadeOutRef.current) clearTimeout(fadeOutRef.current);
            startProgress();
        });

        const removeFinish = router.on('finish', () => {
            finishProgress();
        });

        return () => {
            removeStart();
            removeFinish();
            if (progressRef.current) clearInterval(progressRef.current);
            if (fadeOutRef.current) clearTimeout(fadeOutRef.current);
        };
    }, []);

    if (!visible) return null;

    return (
        <>
            {/* ── Top progress bar ── */}
            <div
                className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none"
                style={{ height: '2.5px' }}
            >
                <div
                    className="h-full bg-primary shadow-[0_0_8px_2px] shadow-primary/60 transition-all ease-out"
                    style={{
                        width: `${progress}%`,
                        transitionDuration: progress === 100 ? '200ms' : '400ms',
                        opacity: progress >= 100 ? 0 : 1,
                        transition: `width ${progress === 100 ? '200ms' : '400ms'} ease-out, opacity 300ms ease`,
                    }}
                />
                {/* Subtle shimmer glow at the tip */}
                {loading && progress < 100 && (
                    <div
                        className="absolute top-0 h-full w-20 rounded-full"
                        style={{
                            left: `calc(${progress}% - 5rem)`,
                            background: 'linear-gradient(90deg, transparent, rgba(var(--primary-rgb, 0, 122, 255), 0.6), transparent)',
                            filter: 'blur(3px)',
                        }}
                    />
                )}
            </div>

            {/* ── Very subtle page dim (only during active load, not on finish) ── */}
            {loading && (
                <div
                    className="fixed inset-0 z-[9998] pointer-events-none"
                    style={{
                        backgroundColor: 'rgba(0,0,0,0.04)',
                        backdropFilter: 'brightness(0.97)',
                    }}
                />
            )}
        </>
    );
}
