// Human-readable (English) names for the typed synapses between AI memory
// nodes. Shared by the mind-map detail panel and the training-notes list view
// so every relation is always labelled the same way.
export const RELATION_LABEL: Record<string, string> = {
    same_topic: 'Same topic',
    rule_applies: 'Rule applies',
    validation_required: 'Validation required',
    condition_trigger: 'Condition trigger',
    risk_warning: 'Risk warning',
    serves_goal: 'Serves goal',
    persistent_hint: 'Keyword link',
    closely_related: 'Closely related',
    related: 'Related',
    fresh_memory: 'Fresh memory',
};

export function relationName(relation?: string | null, label?: string | null): string {
    if (relation && RELATION_LABEL[relation]) {
        return RELATION_LABEL[relation];
    }
    return label && label.trim() !== '' ? label : 'Related';
}