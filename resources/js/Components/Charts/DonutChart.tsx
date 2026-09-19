import React from 'react';

interface DonutChartProps {
    data: Array<{ label: string; value: number; color: string }>;
    title: string;
    isCurrency?: boolean;
}

export default function DonutChart({ data, title, isCurrency = false }: DonutChartProps) {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    let accumulatedPercentage = 0;

    const formatVal = (val: number) => {
        if (isCurrency) {
            return new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(val);
        }
        return `${val} Unit`;
    };

    return (
        <div className="apple-card p-4 flex flex-col justify-between h-[300px] text-card-foreground">
            <div className="flex items-center justify-between mb-3 border-b border-border/50 pb-2">
                <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
            </div>

            {total === 0 ? (
                <div className="flex-1 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                    No data available
                </div>
            ) : (
                <div className="flex flex-1 items-center gap-6 justify-center min-h-0">
                    <div className="relative w-32 h-32 sm:w-36 sm:h-36 md:w-44 md:h-44 flex items-center justify-center shrink-0">
                        <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                            {data.map((item, idx) => {
                                const percentage = (item.value / total) * 100;
                                const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;
                                const strokeDashoffset = -((accumulatedPercentage / 100) * circumference);
                                accumulatedPercentage += percentage;

                                return (
                                    <circle
                                        key={idx}
                                        cx="50"
                                        cy="50"
                                        r={radius}
                                        fill="transparent"
                                        stroke={item.color}
                                        strokeWidth="10"
                                        strokeDasharray={strokeDasharray}
                                        strokeDashoffset={strokeDashoffset}
                                        className="transition-all duration-300 hover:stroke-[12px] cursor-pointer"
                                    />
                                );
                            })}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-lg sm:text-2xl font-bold tracking-tight text-foreground">
                                {isCurrency ? 'Total' : total}
                            </span>
                            <span className="text-[9px] text-muted-foreground font-semibold mt-0.5">
                                {isCurrency ? 'Proportion' : 'Total Units'}
                            </span>
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col gap-2 overflow-y-auto max-h-[220px] pr-1">
                        {data.map((item, idx) => (
                            <div key={idx} className="flex items-start gap-1.5 text-left">
                                <div className="h-2.5 w-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: item.color }} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-foreground truncate leading-tight">{item.label}</p>
                                    <p className="text-[11px] text-muted-foreground font-medium leading-none mt-0.5">
                                        {formatVal(item.value)} • {((item.value / total) * 100).toFixed(0)}%
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
