import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    variant?: 'primary' | 'success' | 'danger' | 'muted';
    children: React.ReactNode;
    className?: string;
}

export default function Badge({
    variant = 'muted',
    children,
    className = '',
    ...props
}: BadgeProps) {
    const variantClass = {
        primary: 'apple-badge-primary',
        success: 'apple-badge-success',
        danger: 'apple-badge-danger',
        muted: 'apple-badge-muted',
    }[variant];

    return (
        <span className={`apple-badge ${variantClass} ${className}`} {...props}>
            {children}
        </span>
    );
}
