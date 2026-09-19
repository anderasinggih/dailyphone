import React, { useState } from 'react';

interface LineChartProps {
    data: Array<{ month: string; revenue: number }>;
}

export default function LineChart({ data }: LineChartProps) {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    const formatIDR = (val: number) => {
        return `IDR ${new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(val)}`;
    };

    if (!data || data.length === 0) {
        return (
            <div className="apple-card p-5 flex flex-col justify-between h-[360px] text-card-foreground border border-border/60">
                <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue Trend</span>
                </div>
                <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                    No transaction data available
                </div>
            </div>
        );
    }

    const revenues = data.map(d => d.revenue);
    const maxVal = Math.max(...revenues, 1);
    const minVal = Math.min(...revenues, 0);

    const points = data.map((d, i) => {
        const x = (i / Math.max(data.length - 1, 1)) * 1000;
        const y = 280 - ((d.revenue - minVal) / Math.max(maxVal - minVal, 1)) * 240 - 15;
        return { x, y, month: d.month, revenue: d.revenue };
    });

    const getSmoothPath = (pts: typeof points) => {
        if (pts.length === 0) return '';
        if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
        let path = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const cpX1 = p0.x + (p1.x - p0.x) * 0.45;
            const cpY1 = p0.y;
            const cpX2 = p0.x + (p1.x - p0.x) * 0.55;
            const cpY2 = p1.y;
            path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
        }
        return path;
    };

    const getSmoothAreaPath = (pts: typeof points) => {
        if (pts.length === 0) return '';
        if (pts.length === 1) return `M ${pts[0].x} 300 L ${pts[0].x} ${pts[0].y} L ${pts[0].x} 300 Z`;
        let path = `M ${pts[0].x} 300 L ${pts[0].x} ${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const cpX1 = p0.x + (p1.x - p0.x) * 0.45;
            const cpY1 = p0.y;
            const cpX2 = p0.x + (p1.x - p0.x) * 0.55;
            const cpY2 = p1.y;
            path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
        }
        path += ` L ${pts[pts.length - 1].x} 300 Z`;
        return path;
    };

    const linePath = getSmoothPath(points);
    const areaPath = getSmoothAreaPath(points);
    const activeIndex = hoveredIdx !== null ? hoveredIdx : data.length - 1;
    const activeItem = data[activeIndex] || data[0];

    const prevItem = activeIndex > 0 ? data[activeIndex - 1] : null;
    const deltaPercent = prevItem && prevItem.revenue > 0
        ? ((activeItem.revenue - prevItem.revenue) / prevItem.revenue) * 100
        : null;

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const index = Math.round((x / width) * (data.length - 1));
        if (index >= 0 && index < data.length) {
            setHoveredIdx(index);
        }
    };

    return (
        <div className="apple-card p-4 sm:p-5 flex flex-col justify-between h-[340px] md:h-[380px] text-card-foreground border border-border/60">
            <div className="flex items-start justify-between gap-3 pb-2 border-b border-border/40">
                <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Monthly Revenue Trend
                    </span>
                    <div className="flex items-baseline gap-2.5 mt-1">
                        <span className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                            {formatIDR(activeItem.revenue)}
                        </span>
                        {deltaPercent !== null && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                deltaPercent >= 0
                                    ? 'text-primary bg-primary/10'
                                    : 'text-destructive bg-destructive/10'
                            }`}>
                                {deltaPercent >= 0 ? '+' : ''}{deltaPercent.toFixed(1)}%
                            </span>
                        )}
                    </div>
                </div>

                <div className="text-right">
                    <span className="text-[11px] text-muted-foreground block">Period</span>
                    <span className="text-xs font-semibold text-foreground">{activeItem.month}</span>
                </div>
            </div>

            <div className="flex-1 flex gap-2 min-h-0 relative mt-2">
                <div className="flex-1 h-full relative group">
                    <svg
                        className="w-full h-full cursor-crosshair overflow-visible"
                        viewBox="0 0 1000 300"
                        preserveAspectRatio="none"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={() => setHoveredIdx(null)}
                    >
                        <defs>
                            <linearGradient id="appleBlueGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.14" />
                                <stop offset="50%" stopColor="var(--primary)" stopOpacity="0.03" />
                                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                            </linearGradient>
                        </defs>

                        {areaPath && (
                            <path d={areaPath} fill="url(#appleBlueGrad)" />
                        )}

                        {linePath && (
                            <path
                                d={linePath}
                                fill="none"
                                stroke="var(--primary)"
                                strokeWidth="1"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                            />
                        )}
                    </svg>
                </div>

                <div className="w-14 h-full flex flex-col justify-between text-right text-[10px] text-muted-foreground select-none pb-2 pt-1 pl-2">
                    <div>
                        <span className="text-[9px] text-muted-foreground/60 block">MAX</span>
                        <span className="font-semibold text-foreground">
                            {maxVal >= 1000000 ? `${(maxVal / 1000000).toFixed(1)}M` : `${maxVal}`}
                        </span>
                    </div>
                    <div>
                        <span className="text-[9px] text-muted-foreground/60 block">MIN</span>
                        <span>
                            {minVal >= 1000000 ? `${(minVal / 1000000).toFixed(1)}M` : `${minVal}`}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex justify-between w-full pr-16 pl-1 pt-2 border-t border-border/30 mt-2">
                {data.map((d, idx) => (
                    <span
                        key={idx}
                        className={`text-[11px] select-none transition-colors ${
                            idx === activeIndex
                                ? 'text-primary font-bold'
                                : 'text-muted-foreground'
                        }`}
                    >
                        {d.month.split(' ')[0]}
                    </span>
                ))}
            </div>
        </div>
    );
}
