import React from 'react';

interface StatCardProps {
    title: string;
    value: number | string;
    description?: string;
    icon?: React.ReactNode;
    isCurrency?: boolean;
    suffix?: string;
    className?: string;
}

export default function StatCard({
    title,
    value,
    description,
    icon,
    isCurrency = true,
    suffix = 'Unit',
    className = '',
}: StatCardProps) {
    const formatted = typeof value === 'number'
        ? isCurrency
            ? new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(value)
            : `${value} ${suffix}`
        : value;

    return (
        <div className={`apple-card p-4 sm:p-5 text-card-foreground transition-all duration-200 ${className}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-muted-foreground mb-1 truncate">
                        {title}
                    </p>
                    <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-tight">
                        {formatted}
                    </h3>
                </div>
                {icon && (
                    <div className="rounded-xl p-2 bg-primary/10 text-primary shrink-0">
                        {icon}
                    </div>
                )}
            </div>
            {description && (
                <p className="mt-2 text-xs text-muted-foreground leading-normal font-normal">
                    {description}
                </p>
            )}
        </div>
    );
}
