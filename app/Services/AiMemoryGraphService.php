<?php

namespace App\Services;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;

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

    protected const MIN_SCORE = 0.08;

    protected const HINT_BOOST = 0.35;

    protected const TITLE_BOOST = 0.15;

    // Jaccard similarity above this means "same memory, rephrased".
    protected const DUPLICATE_THRESHOLD = 0.72;

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
     * @param array $hints Optional relation keywords (e.g. from the AI memo
     *                     `related` field or manual entry) used both as node
     *                     labels and to boost candidate ranking.
     *
     * @return AiTrainingNoteLink[]
     */
    public function linkNewNote(AiTrainingNote $note, array $hints = []): array
    {
        $created = [];

        $others = AiTrainingNote::where('id', '!=', $note->id)->get();
        if ($others->isEmpty()) {
            return $created;
        }

        $noteTokens = $this->tokenize($this->labelSource($note));
        if (empty($noteTokens)) {
            return $created;
        }

        $hints = array_values(array_unique(array_filter(array_map(function ($h) {
            return strtolower(trim((string)$h));
        }, $hints), fn($h) => $h !== '')));

        // IDF over the whole current memory so rare, meaningful words weigh
        // more than common ones when matching two memories.
        $docs = $this->tokenizedDocs($others->push($note));
        $idf = $this->computeIdf($docs);
        $noteVec = $this->tokenVector($noteTokens, $idf);
        $noteTitleTokens = $this->tokenize((string)$note->title);

        $scores = [];

        foreach ($others as $other) {
            $otherTokens = $docs[$other->id] ?? [];
            if (empty($otherTokens)) {
                continue;
            }

            $otherVec = $this->tokenVector($otherTokens, $idf);
            $score = $this->cosine($noteVec, $otherVec);
            $shared = array_intersect($noteTokens, $otherTokens);

            // Shared title words are a strong topical signal.
            $titleShared = array_intersect($noteTitleTokens, $this->tokenize((string)$other->title));
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
                    'label' => $this->pickLabel($shared, $hintMatches),
                    'relation' => $relation,
                    'reason' => $reason,
                ];
            }
        }

        // Rank and keep the strongest candidates.
        uasort($scores, fn($a, $b) => $b['score'] <=> $a['score']);
        $top = array_slice($scores, 0, self::MAX_LINKS, true);

        // If nothing is related enough, keep the graph connected by linking to
        // the most recently touched note ("fresh memory" synapse).
        $strong = array_filter($top, fn($c) => $c['score'] >= self::MIN_SCORE);
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
            $link = $this->createLink(
                $note->id,
                (int)$targetId,
                $meta['label'],
                $meta['relation'] ?? null,
                round(min((float)$meta['score'], 1.0), 3),
                $meta['reason'] ?? null
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
        ?string $reason = null
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
            $created += count($this->linkNewNote($note, $note->related_keywords ?? []));
        });

        return $created;
    }

    /**
     * True when the content is an exact OR a rephrased duplicate of an already
     * stored memory. Used before every save so the AI does not accumulate the
     * same rule/fact twice in different wording.
     */
    public function isDuplicateContent(string $content): bool
    {
        $normalized = trim($content);
        if ($normalized === '') {
            return true;
        }

        // Cheap exact check first.
        if (AiTrainingNote::where('content_hash', md5($normalized))->exists()) {
            return true;
        }

        $newTokens = $this->tokenize($normalized);
        if (count($newTokens) < 4) {
            return false;
        }

        $candidates = AiTrainingNote::query()->pluck('content');
        foreach ($candidates as $existing) {
            $existingTokens = $this->tokenize((string)$existing);
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
                'id' => (int)$n->id,
                'title' => $n->title ?: $this->titleFromContent((string)$n->content),
                'content' => (string)$n->content,
                'kind' => $n->kind,
                'is_active' => $n->is_active,
                'author_name' => $n->author_name ?? 'System',
                'degree' => $degree[$n->id] ?? 0,
            ];
        })->values()->all();

        $linkIds = $linkRows->map(fn($l) => [
            'id' => (int)$l->id,
            'source' => (int)$l->note_id,
            'target' => (int)$l->linked_note_id,
            'label' => $l->label,
            'relation' => $l->relation,
            'weight' => $l->weight !== null ? (float)$l->weight : null,
            'reason' => $l->reason,
        ])->values()->all();

        return ['nodes' => $nodes, 'links' => $linkIds];
    }

    /**
     * Derive a short, stable-enough node label from free-text content.
     */
    public function titleFromContent(string $content): string
    {
        $clean = trim((string)preg_replace('/[\s]+/', ' ', strip_tags($content)));
        $clean = (string)preg_replace('/^[\s\-*#>\d.]+\s*/', '', $clean);

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

        if (($note->kind === 'rule') !== ($other->kind === 'rule') && $sharedTokens !== []) {
            return ['rule_applies', 'Behavioral rule applies to this related topic'];
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
        $title = (string)($note->title ?? '');
        return trim($title . ' ' . $note->content);
    }

    protected function containsTokenOrText(AiTrainingNote $note, string $hint): bool
    {
        $hint = strtolower(trim($hint));

        // Only meaningful keywords count as link hints — tiny tokens or bare
        // numbers would otherwise tie wholly unrelated memories together.
        if (strlen($hint) < 4 || preg_match('/^\d+$/', $hint)) {
            return false;
        }

        $title = (string)$note->title;
        $content = (string)$note->content;
        $related = (array)($note->related_keywords ?? []);

        if (str_contains(strtolower($content), $hint) || str_contains(strtolower($title), $hint)) {
            return true;
        }

        foreach ($related as $keyword) {
            if (strtolower(trim((string)$keyword)) === $hint) {
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
            return !in_array($t, self::STOPWORDS, true);
        });

        return array_values(array_unique($tokens));
    }

    protected function pickLabel(array $sharedTokens, array $hintMatches = []): ?string
    {
        foreach ($hintMatches as $hint) {
            if (strlen((string)$hint) >= 3) {
                return $hint;
            }
        }

        foreach ($sharedTokens as $token) {
            if (strlen((string)$token) >= 4) {
                return (string)$token;
            }
        }

        return $sharedTokens === [] ? null : (string)$sharedTokens[0];
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

        $normA = sqrt(array_sum(array_map(fn($w) => $w * $w, $a)));
        $normB = sqrt(array_sum(array_map(fn($w) => $w * $w, $b)));
        if ($normA <= 0.0 || $normB <= 0.0) {
            return 0.0;
        }

        return $dot / ($normA * $normB);
    }
}