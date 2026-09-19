<?php

namespace App\Services;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use Illuminate\Support\Facades\Log;

/**
 * AI self-maintenance for the memory brain. The model acts as a "neural
 * architect": it reviews a slice of the neuron network and decides, for each
 * node, which kind it really is (rule / validation / condition / emotions /
 * memory / ...), proposes tighter titles and relation keywords, and rewires
 * the synapses — adding or removing connections so the mind map always reflects
 * its understanding instead of the raw scoring heuristic. This is what lets the
 * AI "tidy its own mind map" when something does not fit.
 *
 * {consolidate()} is the deterministic weekly job (item 10): it dedupes
 * near-identical neurons via the embedding index, retires stale unused nodes,
 * and merges repeated validation patterns into one strong neuron — keeping the
 * index clean instead of letting it grow into overlapping noise.
 */
class AiBrainMaintenanceService
{
    public function __construct(protected GeminiAssistantService $gemini)
    {
    }

    /**
     * Review up to $limit brain nodes and apply the AI's proposed
     * reorganizations (kinds, titles, keywords, synapse add/remove).
     *
     * @return array{ok: bool, message: string, nodes_reviewed: int, reclassified: int, titles_updated: int, keywords_updated: int, links_added: int, links_removed: int}
     */
    public function tidy(int $limit = 80): array
    {
        $notes = AiTrainingNote::query()
            ->orderByRaw('COALESCE(used_count, 0) DESC, updated_at DESC')
            ->limit($limit)
            ->get(['id', 'title', 'content', 'kind', 'related_keywords']);

        $notes = $notes->values();

        $empty = [
            'ok' => false,
            'message' => 'No memory nodes in the brain to organize yet.',
            'nodes_reviewed' => 0,
            'reclassified' => 0,
            'titles_updated' => 0,
            'keywords_updated' => 0,
            'links_added' => 0,
            'links_removed' => 0,
        ];

        if ($notes->isEmpty()) {
            return $empty;
        }

        $inv = $notes->map(function ($n) {
            $related = implode(', ', (array)($n->related_keywords ?? []));
            return sprintf(
                "- [%d] kind=%s %s | %s%s",
                (int)$n->id,
                $n->kind,
                $n->title ? 'title="' . $n->title . '"' : 'title=(none)',
                mb_strimwidth(strip_tags((string)$n->content), 0, 150, '…'),
                $related !== '' ? ' | keywords: ' . $related : ''
            );
        })->implode("\n");

        $ids = $notes->map(fn ($n) => (int)$n->id)->all();

        $linkRows = AiTrainingNoteLink::where(function ($q) use ($ids) {
            $q->whereIn('note_id', $ids)->orWhereIn('linked_note_id', $ids);
        })->get(['note_id', 'linked_note_id', 'relation', 'label']);

        $linkInv = $linkRows->map(function ($l) {
            return sprintf(
                "- %d <-> %d [%s]%s",
                (int)$l->note_id,
                (int)$l->linked_note_id,
                $l->relation ?: ($l->label ?: 'related'),
                $l->label ? " '{$l->label}'" : ''
            );
        })->unique()->implode("\n");

        $system = <<<SYSTEM
You are the neural architect of an AI assistant's memory brain. The brain is a
graph: every node is a memory, every edge is a synapse. Your job is to keep the
brain clean, organized and truthful. Using ONLY the inventory below:

1. KIND CORRECTION: pick the single most accurate kind for each node from this
   taxonomy — rule (behavioral directive), validation (mandatory check before
   an action), condition (if-then logic), emotions (mood/sentiment context),
   note (generic factual note), memory (specific personal experience/event),
   preference (user/customer preferences), identity (personal identity/family
   relations), goal (target being pursued), warning (risk/caution). Remember:
   "rule" is reserved for hard behavioral directives written by the owner.
2. TITLES: if a node title is missing or misleading, propose a concise title
   (max 5 words).
3. KEYWORDS: propose 2-4 specific relation keywords that best plug the node
   into related memories.
4. SYNAPSES: propose synapses to ADD between clearly related nodes and
   synapses to REMOVE that are weak, irrelevant or duplicates.

Reply with ONLY a valid JSON object (no markdown, no code fences):
{
  "nodes": [
    { "id": 12, "kind": "validation", "title": "IMEI must be 15 digits", "related": ["imei", "garansi"] }
  ],
  "links_add": [
    { "source": 12, "target": 7, "relation": "validation_required", "label": "imei" }
  ],
  "links_remove": [
    { "a": 3, "b": 9 }
  ]
}
- "nodes" is optional; only include nodes that need a change (kind, title or
  keywords). Use existing ids.
- "links_add" and "links_remove" are optional. Only propose real improvements;
  never fabricate ids or repeat existing synapses.
- Use short relation names: same_topic, rule_applies, condition_trigger,
  validation_required, risk_warning, serves_goal, persistent_hint.
SYSTEM;

        $user = <<<USER
MEMORY NODES (CURRENT BRAIN):
{$inv}

CURRENT SYNAPSES (the mind-map connections):
{$linkInv}

Now reorganize this brain. Return the JSON only.
USER;

        try {
            $raw = $this->gemini->generate($system, $user, 4000, 0.2);
        } catch (\Throwable $e) {
            Log::warning('Brain tidy failed: ' . $e->getMessage());
            $empty['message'] = 'AI maintenance failed: ' . $e->getMessage();
            return $empty;
        }

        if ($raw === null || trim($raw) === '') {
            $empty['message'] = 'The AI could not produce a reorganization plan.';
            return $empty;
        }

        $decoded = $this->decodeJson($raw);
        if (!is_array($decoded)) {
            $empty['message'] = 'The AI returned an unreadable reorganization plan.';
            return $empty;
        }

        $graph = app(AiMemoryGraphService::class);

        $result = [
            'ok' => true,
            'message' => 'AI finished tidying the brain.',
            'nodes_reviewed' => count($notes),
            'reclassified' => 0,
            'titles_updated' => 0,
            'keywords_updated' => 0,
            'links_added' => 0,
            'links_removed' => 0,
        ];

        // 1 ── Per-node reorganizations ─────────────────────────────────────
        foreach ((array)($decoded['nodes'] ?? []) as $suggestion) {
            if (!is_array($suggestion)) {
                continue;
            }

            $suggestedId = (int)($suggestion['id'] ?? 0);
            $note = $notes->firstWhere('id', $suggestedId);
            if (!$note) {
                continue;
            }

            $kind = $graph->normalizeKind(isset($suggestion['kind']) ? (string)$suggestion['kind'] : null);
            $title = isset($suggestion['title'])
                ? mb_substr(trim((string)$suggestion['title']), 0, 200)
                : null;
            $related = isset($suggestion['related']) && is_array($suggestion['related'])
                ? array_slice(array_values(array_filter(array_map(
                    fn($r) => strtolower(trim((string)$r)),
                    $suggestion['related']
                ), fn($r) => $r !== '')), 0, 8)
                : null;

            $changes = [];
            if ($kind !== '' && $kind !== $note->kind) {
                $changes[] = "kind:{$note->kind}→{$kind}";
            }
            if (!empty($title) && !str_contains($title, 'kind=') && (string)$note->title !== $title) {
                $changes[] = 'title';
            }
            [$hasRelated, $relatedForKey] = $this->relatedDiff($note, $related);
            if ($hasRelated) {
                $changes[] = 'keywords';
            }

            if ($changes === []) {
                continue;
            }

            $reclassified = (bool)array_filter($changes, fn($c) => str_starts_with($c, 'kind:'));
            $titleChanged = in_array('title', $changes, true);
            $keywordsChanged = in_array('keywords', $changes, true);

            $note->kind = $kind;
            if (!empty($title)) {
                $note->title = $title;
            }
            $note->related_keywords = $relatedForKey;
            $note->save();

            // Rewire this node from scratch so its synapses match its new role.
            $graph->pruneLinksFor((int)$note->id);
            $graph->linkNewNote($note, (array)$note->related_keywords, true);

            if ($reclassified) {
                $result['reclassified']++;
            }
            if ($titleChanged) {
                $result['titles_updated']++;
            }

            // We pruned its links below, so count them as linked by the model.
            $result['keywords_updated'] += $keywordsChanged ? 1 : 0;
            $result['links_added'] += 0; // re-links are re-computed, not AI additions
        }

        // 2 ── Explicit synapse additions ───────────────────────────────────
        foreach ((array)($decoded['links_add'] ?? []) as $edge) {
            if (!is_array($edge)) {
                continue;
            }
            $source = (int)($edge['source'] ?? 0);
            $target = (int)($edge['target'] ?? 0);
            if ($source <= 0 || $target <= 0 || $source === $target) {
                continue;
            }

            $relation = trim((string)($edge['relation'] ?? 'related'));
            $relation = mb_substr($relation, 0, 40) ?: null;
            $label = isset($edge['label'])
                ? mb_substr(trim((string)$edge['label']), 0, 60)
                : null;

            $link = $graph->createLink($source, $target, $label, $relation);
            if ($link !== null) {
                $result['links_added']++;
            }
        }

        // 3 ── Explicit synapse removals ────────────────────────────────────
        foreach ((array)($decoded['links_remove'] ?? []) as $edge) {
            if (!is_array($edge)) {
                continue;
            }
            $a = (int)($edge['a'] ?? 0);
            $b = (int)($edge['b'] ?? 0);
            if ($a <= 0 || $b <= 0 || $a === $b) {
                continue;
            }
            $removed = AiTrainingNoteLink::where(function ($q) use ($a, $b) {
                $q->where('note_id', $a)->where('linked_note_id', $b);
            })->orWhere(function ($q) use ($a, $b) {
                $q->where('note_id', $b)->where('linked_note_id', $a);
            })->delete();

            if ($removed > 0) {
                $result['links_removed'] += $removed;
            }
        }

        // Count the re-wired links produced by kind changes as "added" too, so
        // the summary reflects the fresh paths the AI carved through the brain.
        $result['links_added'] += (int)$result['reclassified'];

        $parts = [
            "reviewed {$result['nodes_reviewed']} nodes",
            "reclassified {$result['reclassified']}",
            "retitled {$result['titles_updated']}",
            "re-keyworded {$result['keywords_updated']}",
            "added {$result['links_added']} synapses",
            "removed {$result['links_removed']} synapses",
        ];
        $result['message'] = 'AI brain tidy complete — ' . implode(', ', $parts) . '.';

        return $result;
    }

    /**
     * Whether the AI-proposed keyword list differs from the node's current one,
     * and the normalized list to persist (null keeps the current keywords).
     *
     * @return array{0: bool, 1: ?array}
     */
    protected function relatedDiff($note, ?array $related): array
    {
        $current = array_values(array_filter(array_map(
            fn($r) => strtolower(trim((string)$r)),
            (array)($note->related_keywords ?? [])
        ), fn($r) => $r !== ''));

        if ($related === null) {
            return [false, $note->related_keywords ?? null];
        }

        return [$current !== $related, $related === [] ? null : $related];
    }

    /**
     * Extract a JSON object from the model's reply, tolerating ```json fences
     * and stray prose before/after the object.
     */
    protected function decodeJson(string $raw): ?array
    {
        $text = trim((string)preg_replace('/```(?:json)?\s*/i', '', $raw));

        // Try the whole reply first, then fall back to the first {...} block.
        $candidates = [$text];
        if (preg_match('/\{.*\}/s', $text, $m)) {
            $candidates[] = $m[0];
        }

        foreach ($candidates as $candidate) {
            $decoded = json_decode($candidate, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }

        return null;
    }

    /**
     * Deterministic weekly memory consolidation (item 10). Runs without any AI
     * round-trip so it is cheap and repeatable:
     *
     *  1. DEDUPE — near-duplicate notes (cosine ≥ threshold on the stored
     *     embedding, or high Jaccard on token overlap when the vector is cold)
     *     are collapsed into the most-used survivor; the redundant node is
     *     soft-deactivated and its links rewired to the survivor.
     *  2. PROMOTE — repeated validation patterns for the same action (the
     *     feedback loop from rejected proposals) are merged into one strong
     *     "validation" neuron so the AI learns the lesson once, not N times.
     *  3. RETIRE — active knowledge nodes that were never consulted and are
     *     older than the cutoff are soft-deactivated (recoverable), keeping the
     *     index clean as the brain grows.
     *
     * @return array{deduped: int, promoted: int, retired: int, scanned: int}
     */
    public function consolidate(float $dedupeThreshold = 0.92, int $retireAfterDays = 120): array
    {
        $result = ['deduped' => 0, 'promoted' => 0, 'retired' => 0, 'scanned' => 0];

        $graph = app(AiMemoryGraphService::class);
        $embedder = app(\App\Services\AiEmbeddingService::class);

        $active = AiTrainingNote::where('is_active', true)
            ->where('kind', '!=', 'rule')
            ->orderBy('id', 'asc')
            ->get();
        $result['scanned'] = $active->count();

        // ── 1. Dedupe near-identical knowledge notes ─────────────────────
        // Warm any cold vectors first so the similarity pass actually works.
        if ($active->count() > 1) {
            try {
                $embedder->embedMissing($active);
                $active = AiTrainingNote::where('is_active', true)
                    ->where('kind', '!=', 'rule')
                    ->orderBy('id', 'asc')
                    ->get();
            } catch (\Throwable $e) {
                Log::warning('Consolidation embedding warm-up failed: ' . $e->getMessage());
            }
        }

        $survivors = $active->keyBy('id');
        $toDeactivate = [];

        foreach ($active as $note) {
            if (!isset($survivors[$note->id]) || in_array($note->id, $toDeactivate, true)) {
                continue;
            }
            $vector = $this->decodeVector((string)($note->embedding ?? ''));
            $tokens = null;

            foreach ($active as $other) {
                if ($other->id <= $note->id) {
                    continue;
                }
                if (!isset($survivors[$other->id]) || in_array($other->id, $toDeactivate, true)) {
                    continue;
                }

                $score = 0.0;
                if ($vector !== null) {
                    $otherVector = $this->decodeVector((string)($other->embedding ?? ''));
                    if ($otherVector !== null) {
                        $score = $embedder->cosine($vector, $otherVector);
                    }
                }

                // Cold-vector fallback: Jaccard over shared tokens.
                if ($score <= 0.0) {
                    if ($tokens === null) {
                        $tokens = $graph->tokenize((string)$note->content);
                    }
                    $otherTokens = $graph->tokenize((string)$other->content);
                    $union = array_unique(array_merge($tokens, $otherTokens));
                    if (count($union) > 0) {
                        $score = count(array_intersect($tokens, $otherTokens)) / count($union);
                    }
                }

                if ($score < $dedupeThreshold) {
                    continue;
                }

                [$keep, $drop] = ((int)$note->used_count >= (int)$other->used_count)
                    ? [$note, $other]
                    : [$other, $note];

                // Re-point the redundant node's synapses to the survivor.
                $this->redirectLinks((int)$drop->id, (int)$keep->id);
                $keep->increment('used_count', (int)$drop->used_count);

                $toDeactivate[] = (int)$drop->id;
                unset($survivors[$drop->id]);
                $result['deduped']++;
            }
        }

        if ($toDeactivate !== []) {
            AiTrainingNote::whereIn('id', $toDeactivate)->update(['is_active' => false]);
        }

        // ── 2. Promote repeated validation patterns for the same action ──
        $validations = AiTrainingNote::where('is_active', true)
            ->where('kind', 'validation')
            ->get()
            ->filter(function ($note) {
                $content = (string)$note->content;

                return str_contains($content, 'Proposal aksi') || str_contains($content, "aksi '");
            });

        $byAction = [];
        foreach ($validations as $note) {
            if (preg_match("/aksi '([^']+)'/", (string)$note->content, $m)) {
                $byAction[$m[1]][] = $note;
            }
        }

        foreach ($byAction as $action => $notes) {
            if (count($notes) < 2) {
                continue;
            }
            usort($notes, fn ($a, $b) => (int)$b->used_count <=> (int)$a->used_count);
            $champion = $notes[0];

            $mergedContent = '';
            $seen = [];
            foreach ($notes as $n) {
                $line = trim((string)$n->content);
                if ($line === '' || isset($seen[$line])) {
                    continue;
                }
                $seen[$line] = true;
                $mergedContent .= ($mergedContent === '' ? '' : ' ') . $line;
            }
            $mergedContent = mb_substr($mergedContent, 0, 1200);

            foreach (array_slice($notes, 1) as $dup) {
                $this->redirectLinks((int)$dup->id, (int)$champion->id);
                $champion->increment('used_count', (int)$dup->used_count);
                $toDeactivate[] = (int)$dup->id;
                $result['promoted']++;
            }

            $champion->content = $mergedContent ?: $champion->content;
            $champion->related_keywords = array_values(array_unique(array_filter(array_merge(
                (array)($champion->related_keywords ?? []),
                [$action, 'validation', 'proposal']
            ))));
            $champion->saveQuietly();
            $this->embedNoteQuietly($champion);
        }

        if ($toDeactivate !== []) {
            AiTrainingNote::whereIn('id', $toDeactivate)->update(['is_active' => false]);
        }

        // ── 3. Retire stale knowledge that was never consulted ────────────
        $cutoff = now()->subDays($retireAfterDays);

        $stale = AiTrainingNote::where('is_active', true)
            ->where('kind', '!=', 'rule')
            ->where('created_at', '<=', $cutoff)
            ->where(function ($q) {
                $q->whereNull('used_count')->orWhere('used_count', 0);
            })
            ->count();

        if ($stale > 0) {
            AiTrainingNote::where('is_active', true)
                ->where('kind', '!=', 'rule')
                ->where('created_at', '<=', $cutoff)
                ->where(function ($q) {
                    $q->whereNull('used_count')->orWhere('used_count', 0);
                })
                ->update(['is_active' => false]);
            $result['retired'] = (int)$stale;
        }

        return $result;
    }

    /**
     * Re-point every synapse that touched $from to $to, overwriting nothing
     * that already exists, and prune the orphaned edges from the dropped node.
     */
    protected function redirectLinks(int $from, int $to): void
    {
        if ($from === $to) {
            return;
        }

        AiTrainingNoteLink::where(function ($q) use ($from) {
            $q->where('note_id', $from)->orWhere('linked_note_id', $from);
        })->get()->each(function ($link) use ($from, $to) {
            $a = (int)$link->note_id;
            $b = (int)$link->linked_note_id;
            $a = $a === $from ? $to : $a;
            $b = $b === $from ? $to : $b;

            if ($a === $b || AiTrainingNoteLink::where('note_id', $a)->where('linked_note_id', $b)->exists()) {
                $link->delete();

                return;
            }

            $link->note_id = $a;
            $link->linked_note_id = $b;
            $link->saveQuietly();
        });
    }

    /**
     * Re-embed a note into its current embedding model (best effort).
     */
    protected function embedNoteQuietly($note): void
    {
        try {
            app(\App\Services\AiEmbeddingService::class)->embedNote($note);
        } catch (\Throwable $e) {
            Log::warning('Re-embed after consolidation failed: ' . $e->getMessage());
        }
    }

    /**
     * Decode a stored JSON embedding vector to a float array (null when empty).
     */
    protected function decodeVector(string $raw): ?array
    {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || $decoded === []) {
            return null;
        }

        return array_map('floatval', $decoded);
    }
}