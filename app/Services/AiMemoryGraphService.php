<?php

namespace App\Services;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Builds the "neural memory" graph. Every training note becomes a node that is
 * automatically linked to the most related existing notes. Links are TYPED so
 * the graph has real meaning: each synapse carries a relation kind ("same_topic",
 * "rule_applies", "persistent_hint", ...), a numeric weight (strength) and a
 * short reason, which the AI can later read to navigate the memory along
 * specific paths.
 *
 * Nodes can carry a short label (title) and explicit relation hints
 * (related_keywords) written by the AI itself, acting as strong signals for
 * where the node should plug into the network.
 */
class AiMemoryGraphService
{
    protected const MAX_LINKS = 5;

    // The AI "brain" taxonomy. Every node belongs to ONE typed kind so the mind
    // map can color-code neurons by role, and the AI can reorganize a node into
    // the kind that actually fits its content (validation, condition, memory…).
    public const KINDS = [
        self::KIND_RULE,
        self::KIND_VALIDATION,
        self::KIND_CONDITION,
        self::KIND_EMOTIONS,
        self::KIND_NOTE,
        self::KIND_MEMORY,
        self::KIND_PREFERENCE,
        self::KIND_IDENTITY,
        self::KIND_GOAL,
        self::KIND_WARNING,
    ];

    public const KIND_RULE = 'rule';

    public const KIND_VALIDATION = 'validation';

    public const KIND_CONDITION = 'condition';

    public const KIND_EMOTIONS = 'emotions';

    public const KIND_NOTE = 'note';

    public const KIND_MEMORY = 'memory';

    public const KIND_PREFERENCE = 'preference';

    public const KIND_IDENTITY = 'identity';

    public const KIND_GOAL = 'goal';

    public const KIND_WARNING = 'warning';

    // Kinds that are NOT user-typed directives but still qualify as "brain
    // content" — used by the candidate pool whenever a query may match any
    // non-rule neuron (rules are always injected separately into prompts).
    public const NON_RULE_KINDS = [
        self::KIND_VALIDATION,
        self::KIND_CONDITION,
        self::KIND_EMOTIONS,
        self::KIND_NOTE,
        self::KIND_MEMORY,
        self::KIND_PREFERENCE,
        self::KIND_IDENTITY,
        self::KIND_GOAL,
        self::KIND_WARNING,
    ];

    protected const MIN_SCORE = 0.08;

    protected const HINT_BOOST = 0.35;

    protected const TITLE_BOOST = 0.15;

    // Jaccard similarity above this means "same memory, rephrased".
    protected const DUPLICATE_THRESHOLD = 0.72;

    // Token cosine band between "definitely the same memory" and "definitely a
    // different topic": nodes that land here share most of their vocabulary —
    // the strong signature of the SAME topic carrying a possibly DIFFERENT fact
    // (a daily fact that changed), not a pure rephrase (already caught by the
    // duplicate gate at DUPLICATE_THRESHOLD / consolidation at 0.92).
    public const CONFLICT_FLOOR = 0.72;

    public const CONFLICT_CEILING = 0.92;

    // Per-link JSON key that flags a synapse for the superadmin conflict review.
    public const METADATA_CONFLICT_FLAG = 'possible_conflict';

    // Meaningful typed relations for the resolve-conflict review actions.
    public const RELATION_SUPERSEDES = 'supersedes';

    public const RELATION_CONTRADICTS = 'contradicts';

    protected const STOPWORDS = [
        'yang', 'dan', 'di', 'ke', 'dari', 'dengan', 'untuk', 'pada', 'itu', 'ini', 'adalah',
        'agar', 'supaya', 'jangan', 'tidak', 'saat', 'ketika', 'harus', 'bisa', 'dapat',
        'atau', 'karena', 'juga', 'akan', 'serta', 'anda', 'kamu', 'kita', 'saya', 'dalam',
        'the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'never', 'always',
        'pernah', 'sudah', 'belum', 'hanya', 'semua', 'tolong', 'pastikan', 'coba', 'gunakan',
        'beri', 'buat', 'atau', 'lebih', 'kurang', 'jika', 'sangat', 'penting', 'wajib',
    ];

    /**
     * Link a freshly created note to its most related neighbours.
     *
     * @param  array  $hints  Optional relation keywords (e.g. from the AI memo
     *                        `related` field or manual entry) used both as node
     *                        labels and to boost candidate ranking.
     * @param  bool  $fullScan  When true, every existing note is compared (used
     *                          by the offline rebuild command for a complete
     *                          re-layout). Live writes default to false so we only
     *                          score candidates sharing a real token with the new
     *                          note, keeping per-node cost bounded as memory grows.
     * @return AiTrainingNoteLink[]
     */
    public function linkNewNote(AiTrainingNote $note, array $hints = [], bool $fullScan = false): array
    {
        $created = [];

        $others = $fullScan
            ? AiTrainingNote::where('id', '!=', $note->id)->get()
            : $this->linkCandidates($note);

        if ($others->isEmpty()) {
            return $created;
        }

        $noteTokens = $this->tokenize($this->labelSource($note));
        if (empty($noteTokens)) {
            return $created;
        }

        $hints = array_values(array_unique(array_filter(array_map(function ($h) {
            return strtolower(trim((string) $h));
        }, $hints), fn ($h) => $h !== '')));

        // IDF over the whole current memory so rare, meaningful words weigh
        // more than common ones when matching two memories.
        $docs = $this->tokenizedDocs($others->push($note));
        $idf = $this->computeIdf($docs);
        $noteVec = $this->tokenVector($noteTokens, $idf);
        $noteTitleTokens = $this->tokenize((string) $note->title);

        $scores = [];

        foreach ($others as $other) {
            $otherTokens = $docs[$other->id] ?? [];
            if (empty($otherTokens)) {
                continue;
            }

            $otherVec = $this->tokenVector($otherTokens, $idf);
            $cosine = $this->cosine($noteVec, $otherVec);
            $score = $cosine;
            $shared = array_intersect($noteTokens, $otherTokens);

            // Shared title words are a strong topical signal.
            $titleShared = array_intersect($noteTitleTokens, $this->tokenize((string) $other->title));
            $shared = array_merge($shared, $titleShared);
            $shared = array_values(array_unique($shared));
            if ($titleShared) {
                $score += self::TITLE_BOOST;
            }

            // Hints are the AI's own "where does this plug in" signal.
            $hintMatches = [];
            foreach ($hints as $hint) {
                if ($this->containsTokenOrText($other, $hint)) {
                    $hintMatches[] = $hint;
                    $score += self::HINT_BOOST * (0.6 + 0.4 * min(count($hintMatches), 4));
                }
            }

            [$relation, $reason] = $this->classifyRelation($note, $other, $hintMatches, $shared);

            if ($score > 0.0001) {
                $scores[$other->id] = [
                    'score' => $score,
                    'cosine' => $cosine,
                    'label' => $this->pickLabel($shared, $hintMatches),
                    'relation' => $relation,
                    'reason' => $reason,
                ];
            }
        }

        // Rank and keep the strongest candidates.
        uasort($scores, fn ($a, $b) => $b['score'] <=> $a['score']);
        $top = array_slice($scores, 0, self::MAX_LINKS, true);

        // If nothing is related enough, keep the graph connected by linking to
        // the most recently touched note ("fresh memory" synapse).
        $strong = array_filter($top, fn ($c) => $c['score'] >= self::MIN_SCORE);
        if ($strong === [] && $others->isNotEmpty()) {
            $fallback = $others->sortByDesc('updated_at')->first();
            $strong = [$fallback->id => [
                'score' => 0.05,
                'label' => $hints[0] ?? null,
                'relation' => 'fresh_memory',
                'reason' => 'Recent memory kept the graph connected.',
            ]];
        }

        foreach ($strong as $targetId => $meta) {
            // A synapse whose endpoints share most of their vocabulary but are
            // NOT pure rephrases is a candidate conflict: same topic, possibly
            // different facts. Flag it so the superadmin can review the pair.
            $cosine = (float) ($meta['cosine'] ?? $meta['score']);
            $conflicting = $cosine >= self::CONFLICT_FLOOR && $cosine < self::CONFLICT_CEILING;

            $link = $this->createLink(
                $note->id,
                (int) $targetId,
                $meta['label'],
                $meta['relation'] ?? null,
                round(min((float) $meta['score'], 1.0), 3),
                $meta['reason'] ?? null,
                $conflicting ? [self::METADATA_CONFLICT_FLAG => true] : null
            );
            if ($link !== null) {
                $created[] = $link;
            }
        }

        return $created;
    }

    /**
     * Create a symmetric, de-duplicated link between two notes.
     */
    public function createLink(
        int $noteId,
        int $linkedId,
        ?string $label = null,
        ?string $relation = null,
        ?float $weight = null,
        ?string $reason = null,
        ?array $metadata = null
    ): ?AiTrainingNoteLink {
        if ($noteId === $linkedId) {
            return null;
        }

        $exists = AiTrainingNoteLink::where(function ($q) use ($noteId, $linkedId) {
            $q->where('note_id', $noteId)->where('linked_note_id', $linkedId);
        })->orWhere(function ($q) use ($noteId, $linkedId) {
            $q->where('note_id', $linkedId)->where('linked_note_id', $noteId);
        })->exists();

        if ($exists) {
            return null;
        }

        return AiTrainingNoteLink::create([
            'note_id' => $noteId,
            'linked_note_id' => $linkedId,
            'label' => $label,
            'relation' => $relation,
            'weight' => $weight,
            'reason' => $reason,
            'metadata' => $metadata,
        ]);
    }

    /**
     * Remove every link that references the given note id.
     */
    public function pruneLinksFor(int $noteId): void
    {
        AiTrainingNoteLink::where('note_id', $noteId)
            ->orWhere('linked_note_id', $noteId)
            ->delete();
    }

    /**
     * Rebuild the whole synapse network from scratch by replaying note history
     * in insertion order (same growth semantics as live linking).
     *
     * @return int number of synapses created
     */
    public function rebuildAllLinks(): int
    {
        AiTrainingNoteLink::query()->delete();

        $created = 0;
        AiTrainingNote::orderBy('id', 'asc')->get()->each(function ($note) use (&$created) {
            $created += count($this->linkNewNote($note, $note->related_keywords ?? [], true));
        });

        return $created;
    }

    /**
     * The candidate notes a fresh note should be compared against: every note
     * that shares at least one informative token with the new note's title +
     * content + hints, falling back to recently touched notes when nothing
     * shares a word (so brand-new topics still plug into the graph). This keeps
     * per-write cost proportional to the relevant neighbourhood, not the whole
     * table, as the memory grows.
     */
    protected function linkCandidates(AiTrainingNote $note): Collection
    {
        $tokens = $this->tokenize($this->labelSource($note));
        foreach ((array) ($note->related_keywords ?? []) as $hint) {
            foreach ($this->tokenize((string) $hint) as $t) {
                $tokens[] = $t;
            }
        }

        $ids = $this->candidateNoteIds($tokens, 300);
        if ($ids === []) {
            $ids = AiTrainingNote::where('id', '!=', $note->id)
                ->orderBy('updated_at', 'desc')
                ->limit(100)
                ->pluck('id')
                ->all();
        }

        return AiTrainingNote::whereIn('id', $ids)
            ->where('id', '!=', $note->id)
            ->where('is_stale', false)
            ->get();
    }

    /**
     * Ids of every note that shares at least one informative token with the
     * given token list, found with cheap LIKE filters over title, content and
     * related keywords. Ordered most-recent-first and capped so a huge memory
     * never forces a full-table materialization into PHP.
     */
    public function candidateNoteIds(array $tokens, int $limit = 300): array
    {
        $tokens = array_values(array_unique(array_filter(array_map(function ($t) {
            $t = strtolower(trim((string) $t));

            return strlen($t) >= 4 ? $t : null;
        }, $tokens))));

        if ($tokens === []) {
            return [];
        }

        // Longest tokens first: they are the strongest, most selective filters.
        usort($tokens, fn ($a, $b) => strlen((string) $b) <=> strlen((string) $a));
        $tokens = array_slice($tokens, 0, 8);

        $query = AiTrainingNote::query()->select('id')->where('is_stale', false);
        $query->where(function ($q) use ($tokens) {
            foreach ($tokens as $token) {
                // related_keywords is a JSON column, but LIKE over its serialized
                // text works identically on MySQL and SQLite for substring hits.
                $q->orWhere('title', 'like', "%{$token}%")
                    ->orWhere('content', 'like', "%{$token}%")
                    ->orWhere('related_keywords', 'like', "%{$token}%");
            }
        });

        return $query->orderBy('updated_at', 'desc')->limit($limit)->pluck('id')->all();
    }

    /**
     * The full set of valid node kinds (brain taxonomy).
     */
    public function kinds(): array
    {
        return self::KINDS;
    }

    /**
     * Coerce any kind string into a valid taxonomy value. Unknown or empty
     * values land on the generic 'note' kind, so untrusted input (AI memos,
     * manual entry, link hints) can never produce an undefined node category.
     */
    public function normalizeKind(?string $kind): string
    {
        $kind = strtolower(trim((string) $kind));

        return in_array($kind, self::KINDS, true) ? $kind : self::KIND_NOTE;
    }

    /**
     * Re-classify an existing node into another kind and re-wire its synapses
     * afterwards, because a node's place in the brain defines which relations
     * make sense (a directive relates differently than a memory). Used by the
     * manual "reclassify" control and by AI self-maintenance.
     */
    public function reclassifyNode(int $noteId, ?string $kind, ?string $title = null, ?array $related = null): array
    {
        $note = AiTrainingNote::findOrFail($noteId);
        $newKind = $this->normalizeKind($kind);

        $change = [];
        if ($note->kind !== $newKind) {
            $note->kind = $newKind;
            $change[] = "kind:{$note->getOriginal('kind')}→{$newKind}";
        }
        if ($title !== null && trim((string) $title) !== '' && (string) $note->title !== trim((string) $title)) {
            $note->title = mb_substr(trim((string) $title), 0, 200);
            $change[] = 'title';
        }
        if (is_array($related)) {
            $normalized = array_values(array_unique(array_filter(array_map(
                fn ($r) => strtolower(trim((string) $r)),
                $related
            ), fn ($r) => $r !== '')));
            $note->related_keywords = $normalized === [] ? null : array_slice($normalized, 0, 8);
            $change[] = 'related';
        }

        $note->save();

        // Re-connect the node from scratch so its synapses reflect the new role.
        if ($change !== []) {
            $this->pruneLinksFor($noteId);
            $links = $this->linkNewNote($note, (array) $note->related_keywords, true);
            $change[] = 're-linked ('.count($links).')';
        }

        return [
            'changed' => $change !== [],
            'changes' => $change,
            'kind' => $newKind,
        ];
    }

    /**
     * Settle a consensual (flagged) conflict between two nodes. The reviewer
     * names the WINNING node and the verdict:
     *
     * - supersedes: the winning node's fact replaced the other's. The loser is
     *   marked stale (retrieval stops surfacing it) and records the winner as
     *   its replacement, so the reviewer can undo the call later.
     * - contradicts: both facts stay alive — the reviewer simply acknowledged
     *   the contradiction, so only the synapse is relabelled.
     *
     * Either way every `possible_conflict` pen mark touching the loser vertex
     * is cleared.
     *
     * @return array{loser_id: int, winner_id: int, action: string, conflicts_cleared: int}
     */
    public function settleConflict(int $linkId, int $winnerId, string $action): array
    {
        $link = AiTrainingNoteLink::findOrFail($linkId);
        if ($winnerId !== (int) $link->note_id && $winnerId !== (int) $link->linked_note_id) {
            throw new \InvalidArgumentException('The winning note must be one endpoint of the synapse.');
        }
        $loserId = $link->getOtherId($winnerId);

        $action = in_array($action, [self::RELATION_SUPERSEDES, self::RELATION_CONTRADICTS], true)
            ? $action
            : self::RELATION_SUPERSEDES;

        $loser = AiTrainingNote::findOrFail($loserId);
        if ($action === self::RELATION_SUPERSEDES) {
            $loser->update([
                'is_stale' => true,
                'superseded_by_note_id' => $winnerId,
            ]);
        } else {
            $loser->update([
                'is_stale' => false,
                'superseded_by_note_id' => null,
            ]);
        }

        $cleared = 0;
        $touching = AiTrainingNoteLink::where('note_id', $loserId)
            ->orWhere('linked_note_id', $loserId)
            ->get();

        foreach ($touching as $l) {
            $meta = $l->metadata ?? [];
            if (($meta[self::METADATA_CONFLICT_FLAG] ?? false) === true) {
                $cleared++;
            }
            unset($meta[self::METADATA_CONFLICT_FLAG]);
            $l->update([
                'relation' => $l->id === $link->id ? $action : $l->relation,
                'metadata' => $meta === [] ? null : $meta,
            ]);
        }

        return [
            'loser_id' => $loserId,
            'winner_id' => $winnerId,
            'action' => $action,
            'conflicts_cleared' => $cleared,
        ];
    }

    /**
     * Undo a "supersedes" verdict: the node becomes a live neuron again, no
     * longer points at a replacement, and its synapses are re-wired so it
     * rejoins the graph exactly where it used to sit.
     */
    public function restoreNode(int $noteId): AiTrainingNote
    {
        $note = AiTrainingNote::findOrFail($noteId);
        $note->update([
            'is_stale' => false,
            'superseded_by_note_id' => null,
        ]);

        $this->pruneLinksFor((int) $note->id);
        $this->linkNewNote($note, (array) $note->related_keywords, true);

        return $note->refresh();
    }

    /**
     * Bounded knowledge candidate pool for a chat query: only notes that
     * actually share a real token with the query are materialized, so the
     * ranking loop below never walks the whole memory table.
     *
     * @param  array|string|null  $kind  Restrict to one kind, one of several
     *                                   kinds, or null to include every active
     *                                   non-rule neuron (rules load separately).
     */
    public function candidateNotes(?string $query, array|string|null $kind = null, int $limit = 200): Collection
    {
        $tokens = $this->tokenize(trim((string) $query));
        $ids = $this->candidateNoteIds($tokens, $limit);

        if ($ids === []) {
            return collect();
        }

        $query = AiTrainingNote::whereIn('id', $ids)
            ->where('is_active', true)
            ->where('is_stale', false);
        if (is_array($kind)) {
            $kinds = array_values(array_filter(array_map(
                fn ($k) => $this->normalizeKind(is_string($k) ? $k : null),
                $kind
            )));
            $query->whereIn('kind', $kinds === [] ? self::NON_RULE_KINDS : $kinds);
        } elseif (is_string($kind) && $kind !== '') {
            $query->where('kind', $this->normalizeKind($kind));
        } else {
            $query->whereIn('kind', self::NON_RULE_KINDS);
        }

        return $query->limit($limit)->get();
    }

    /**
     * True when the content is an exact OR a rephrased duplicate of an already
     * stored memory. Used before every save so the AI does not accumulate the
     * same rule/fact twice in different wording.
     *
     * The rephrased check is bounded: only notes sharing at least one real
     * token are compared (rephrased duplicates virtually always share their
     * key words — "Yaya adik Singgih" vs "Singgih punya adik Yaya" both
     * contain "adik" & "singgih"). Exact duplicates are caught first by the
     * content hash, which scans every row cheaply via the unique index.
     */
    public function isDuplicateContent(string $content): bool
    {
        $normalized = trim($content);
        if ($normalized === '') {
            return true;
        }

        // Cheap exact check first (indexed, scans all rows quickly). Stale nodes are
        // skipped: their fact is outdated, so re-recording the current wording
        // is not a duplicate of the live memory.
        if (AiTrainingNote::where('content_hash', md5($normalized))->where('is_stale', false)->exists()) {
            return true;
        }

        $newTokens = $this->tokenize($normalized);
        if (count($newTokens) < 4) {
            return false;
        }

        $candidates = AiTrainingNote::whereIn('id', $this->candidateNoteIds($newTokens, 300))
            ->get(['content']);

        foreach ($candidates as $existing) {
            $existingTokens = $this->tokenize((string) $existing->content);
            if (count($existingTokens) < 3) {
                continue;
            }
            $union = count(array_unique(array_merge($newTokens, $existingTokens)));
            if ($union === 0) {
                continue;
            }
            $jaccard = count(array_intersect($newTokens, $existingTokens)) / $union;
            if ($jaccard >= self::DUPLICATE_THRESHOLD) {
                return true;
            }
        }

        return false;
    }

    /**
     * Record that a set of memory nodes was actually consulted in a chat reply.
     * The AI cites the node ids it relied on; bump their counters so the
     * superadmin can see which neurons are load-bearing vs dead weight.
     */
    public function registerUsage(array $ids): void
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn ($id) => $id > 0)));
        if ($ids === []) {
            return;
        }

        AiTrainingNote::whereIn('id', $ids)->update([
            'used_count' => DB::raw('used_count + 1'),
            'last_used_at' => now(),
        ]);
    }

    /**
     * Export the whole memory as graph-ready nodes + edges for the mind-map UI.
     *
     * @return array{nodes: array<int, array<string, mixed>>, links: array<int, array<string, mixed>>}
     */
    public function graphData(): array
    {
        $notes = AiTrainingNote::query()
            ->orderBy('id', 'asc')
            ->get();

        $linkRows = AiTrainingNoteLink::get(['id', 'note_id', 'linked_note_id', 'label', 'relation', 'weight', 'reason']);

        $degree = [];
        foreach ($linkRows as $l) {
            $degree[$l->note_id] = ($degree[$l->note_id] ?? 0) + 1;
            $degree[$l->linked_note_id] = ($degree[$l->linked_note_id] ?? 0) + 1;
        }

        $nodes = $notes->map(function ($n) use ($degree) {
            return [
                'id' => (int) $n->id,
                'title' => $n->title ?: $this->titleFromContent((string) $n->content),
                'content' => (string) $n->content,
                'kind' => $n->kind,
                'is_active' => $n->is_active,
                'author_name' => $n->author_name ?? 'System',
                'degree' => $degree[$n->id] ?? 0,
                'used_count' => (int) ($n->used_count ?? 0),
            ];
        })->values()->all();

        $linkIds = $linkRows->map(fn ($l) => [
            'id' => (int) $l->id,
            'source' => (int) $l->note_id,
            'target' => (int) $l->linked_note_id,
            'label' => $l->label,
            'relation' => $l->relation,
            'weight' => $l->weight !== null ? (float) $l->weight : null,
            'reason' => $l->reason,
        ])->values()->all();

        return ['nodes' => $nodes, 'links' => $linkIds];
    }

    /**
     * Derive a short, stable-enough node label from free-text content.
     */
    public function titleFromContent(string $content): string
    {
        $clean = trim((string) preg_replace('/[\s]+/', ' ', strip_tags($content)));
        $clean = (string) preg_replace('/^[\s\-*#>\d.]+\s*/', '', $clean);

        if ($clean === '') {
            return 'Memory #';
        }

        // Strip trailing punctuation and cut to a readable node width.
        $clean = rtrim($clean, " \t\n\r\0\x0B,.;:!?");
        $title = mb_strimwidth($clean, 0, 62, '…');

        return ($title === '') ? 'Memory' : $title;
    }

    /**
     * Decide what KIND of relation two memories share and explain it, so the
     * graph is meaningful and the AI can follow labelled paths.
     *
     * @return array{0: string, 1: string} [relation, reason]
     */
    protected function classifyRelation(AiTrainingNote $note, AiTrainingNote $other, array $hintMatches, array $sharedTokens): array
    {
        if ($hintMatches !== []) {
            $keywords = implode(', ', array_slice($hintMatches, 0, 3));

            return ['persistent_hint', "AI-linked via keyword: {$keywords}"];
        }

        if ($sharedTokens !== []) {
            // A directive governs whatever it shares concepts with.
            if (($note->kind === 'rule') !== ($other->kind === 'rule')) {
                return ['rule_applies', 'Behavioral rule applies to this related topic'];
            }
            // Validation & condition nodes are the "logic circuits" of the brain:
            // attach them to the things they verify or gate.
            if (($note->kind === self::KIND_VALIDATION) !== ($other->kind === self::KIND_VALIDATION)) {
                return ['validation_required', 'Validation check applies to this related topic'];
            }
            if (($note->kind === self::KIND_CONDITION) !== ($other->kind === self::KIND_CONDITION)) {
                return ['condition_trigger', 'Conditional rule gates this related topic'];
            }
            if (($note->kind === self::KIND_WARNING) !== ($other->kind === self::KIND_WARNING)) {
                return ['risk_warning', 'Warning signal flags this related topic'];
            }
            if (($note->kind === self::KIND_GOAL) !== ($other->kind === self::KIND_GOAL)) {
                return ['serves_goal', 'Related memory serves this goal'];
            }
        }

        if (count($sharedTokens) >= 4) {
            return ['same_topic', 'Shares several key concepts'];
        }

        if (count($sharedTokens) >= 2) {
            return ['closely_related', 'Shares related concepts'];
        }

        return ['related', 'Connected by topic affinity'];
    }

    /**
     * Combine title and content so relations can match on either.
     */
    protected function labelSource(AiTrainingNote $note): string
    {
        $title = (string) ($note->title ?? '');

        return trim($title.' '.$note->content);
    }

    protected function containsTokenOrText(AiTrainingNote $note, string $hint): bool
    {
        $hint = strtolower(trim($hint));

        // Only meaningful keywords count as link hints — tiny tokens or bare
        // numbers would otherwise tie wholly unrelated memories together.
        if (strlen($hint) < 4 || preg_match('/^\d+$/', $hint)) {
            return false;
        }

        $title = (string) $note->title;
        $content = (string) $note->content;
        $related = (array) ($note->related_keywords ?? []);

        if (str_contains(strtolower($content), $hint) || str_contains(strtolower($title), $hint)) {
            return true;
        }

        foreach ($related as $keyword) {
            if (strtolower(trim((string) $keyword)) === $hint) {
                return true;
            }
        }

        return false;
    }

    /**
     * Normalize free text into a set of informative lowercase tokens.
     */
    public function tokenize(string $text): array
    {
        $text = strtolower($text);

        // Normalize capacity/weight shorthand: "128GB" and "128 gb" -> "128gb".
        $text = preg_replace('/(\d+(?:[.,]\d+)?)\s*(gb|tb|mb)/', '$1$2', $text);

        $tokens = preg_split('/[^a-z0-9]+/', $text) ?: [];
        $tokens = array_filter($tokens, function ($t) {
            if (strlen($t) < 3) {
                return false;
            }

            return ! in_array($t, self::STOPWORDS, true);
        });

        return array_values(array_unique($tokens));
    }

    protected function pickLabel(array $sharedTokens, array $hintMatches = []): ?string
    {
        foreach ($hintMatches as $hint) {
            if (strlen((string) $hint) >= 3) {
                return $hint;
            }
        }

        foreach ($sharedTokens as $token) {
            if (strlen((string) $token) >= 4) {
                return (string) $token;
            }
        }

        return $sharedTokens === [] ? null : (string) $sharedTokens[0];
    }

    /**
     * id => informative tokens for the whole memory pop.
     */
    protected function tokenizedDocs($notes): array
    {
        $docs = [];
        foreach ($notes as $note) {
            $docs[$note->id] = $this->tokenize($this->labelSource($note));
        }

        return $docs;
    }

    /**
     * Inverse document frequency per token: rare tokens carry more meaning.
     */
    protected function computeIdf(array $docs): array
    {
        $n = count($docs);
        $df = [];
        foreach ($docs as $tokens) {
            foreach (array_unique($tokens) as $token) {
                $df[$token] = ($df[$token] ?? 0) + 1;
            }
        }

        $idf = [];
        foreach ($df as $token => $count) {
            $idf[$token] = log(1 + $n / (1 + $count));
        }

        return $idf;
    }

    protected function tokenVector(array $tokens, array $idf): array
    {
        $vec = [];
        foreach (array_unique($tokens) as $token) {
            $vec[$token] = $idf[$token] ?? 1.0;
        }

        return $vec;
    }

    protected function cosine(array $a, array $b): float
    {
        if ($a === [] || $b === []) {
            return 0.0;
        }

        $dot = 0.0;
        foreach ($a as $token => $w) {
            if (isset($b[$token])) {
                $dot += $w * $b[$token];
            }
        }
        if ($dot <= 0.0) {
            return 0.0;
        }

        $normA = sqrt(array_sum(array_map(fn ($w) => $w * $w, $a)));
        $normB = sqrt(array_sum(array_map(fn ($w) => $w * $w, $b)));
        if ($normA <= 0.0 || $normB <= 0.0) {
            return 0.0;
        }

        return $dot / ($normA * $normB);
    }
}
