// AI "brain" node taxonomy. Every training-memory node belongs to exactly one
// kind, rendered with its own Apple-HIG color in the mind map so the role of
// each neuron is readable at a glance. Mirrors AiMemoryGraphService::KINDS.

export const KINDS = [
    'rule',
    'validation',
    'condition',
    'emotions',
    'note',
    'memory',
    'preference',
    'identity',
    'goal',
    'warning',
] as const;

export type Kind = (typeof KINDS)[number];

export interface KindMeta {
    label: string;
    color: string;
    blurb: string;
}

// Apple system-palette colors per kind. Rule stays Apple Blue as the primary
// brand directive; the remaining kinds use the rest of the iOS palette.
export const KIND_META: Record<Kind, KindMeta> = {
    rule:       { label: 'Directive',        color: '#007AFF', blurb: 'Behavioral rule, always obeyed' },
    validation: { label: 'Validation',       color: '#34C759', blurb: 'Mandatory check before an action' },
    condition:  { label: 'Condition',        color: '#FF9500', blurb: 'If-then logic gate' },
    emotions:   { label: 'Emotion',          color: '#FF2D55', blurb: 'Mood / sentiment context' },
    note:       { label: 'Note',             color: '#8E8E93', blurb: 'Generic factual note' },
    memory:     { label: 'Memory',           color: '#AF52DE', blurb: 'Personal experience / event' },
    preference: { label: 'Preference',       color: '#00C7BE', blurb: 'User / customer preference' },
    identity:   { label: 'Identity',         color: '#5AC8FA', blurb: 'Personal identity / relations' },
    goal:       { label: 'Goal',             color: '#FFCC00', blurb: 'Target being pursued' },
    warning:    { label: 'Warning',          color: '#FF3B30', blurb: 'Risk / caution to remember' },
};

export function kindMeta(kind?: string | null): KindMeta {
    return KIND_META[kindOf(kind)];
}

export function kindOf(kind?: string | null): Kind {
    return (KINDS as readonly string[]).includes(kind ?? '') ? (kind as Kind) : 'note';
}

export function kindList(): Kind[] {
    return [...KINDS];
}