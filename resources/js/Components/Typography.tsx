import React from 'react';

interface TypographyProps extends React.HTMLAttributes<HTMLElement> {
    children: React.ReactNode;
    className?: string;
}

export function H1({ children, className = '', ...props }: TypographyProps) {
    return (
        <h1 className={`h1 ${className}`} {...props}>
            {children}
        </h1>
    );
}

export function H2({ children, className = '', ...props }: TypographyProps) {
    return (
        <h2 className={`h2 ${className}`} {...props}>
            {children}
        </h2>
    );
}

export function H3({ children, className = '', ...props }: TypographyProps) {
    return (
        <h3 className={`h3 ${className}`} {...props}>
            {children}
        </h3>
    );
}

export function Text1({ children, className = '', ...props }: TypographyProps) {
    return (
        <p className={`text1 ${className}`} {...props}>
            {children}
        </p>
    );
}

export function Text2({ children, className = '', ...props }: TypographyProps) {
    return (
        <p className={`text2 ${className}`} {...props}>
            {children}
        </p>
    );
}

export function Caption({ children, className = '', ...props }: TypographyProps) {
    return (
        <span className={`caption ${className}`} {...props}>
            {children}
        </span>
    );
}
