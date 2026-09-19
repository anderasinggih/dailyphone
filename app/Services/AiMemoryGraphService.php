<?php

namespace App\Services;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;

/**
 * Builds the "neural memory" graph: when a new training note is saved, it is
 * automatically linked to the most related existing notes so the memory forms
 * a free, unlimited network of connected nodes.
 *
 * Nodes can carry an optional short label (title) and explicit relation hints
 * (related_keywords) written by the AI itself, which act as strong signals for
 * where the node should plug into the network.
 */
class AiMemoryGraphService
{
    protected const MAX_LINKS = 4;

    protected const MIN_SCORE = 0.18;

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

        $scores = [];
        $labelHits = [];

        foreach ($others as $other) {
            $otherTokens = $this->tokenize($this->labelSource($other));
            if (empty($otherTokens)) {
                continue;
            }

            $shared = array_intersect($noteTokens, $otherTokens);
            $score = count($shared) / (sqrt(count($noteTokens) * count($otherTokens)) ?: 1);

            // Hints act as strong relation signals: if any related keyword
            // appears in the other note, the edge is boosted substantially.
            $hintMatches = [];
            foreach ($hints as $hint) {
                if ($this->containsTokenOrText($other, $hint)) {
                    $hintMatches[] = $hint;
                    $score = max($score, $score + 0.45);
                }
            }
            $labelHits[$other->id] = $hintMatches;

            $label = $this->pickLabel($shared, $hintMatches);

            if ($score > 0) {
                $scores[$other->id] = ['score' => $score, 'label' => $label];
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
            $strong = [$fallback->id => ['score' => 0.05, 'label' => $hints[0] ?? null]];
        }

        foreach ($strong as $targetId => $meta) {
            $link = $this->createLink($note->id, (int)$targetId, $meta['label']);
            if ($link !== null) {
                $created[] = $link;
            }
        }

        return $created;
    }

    /**
     * Create a symmetric, de-duplicated link between two notes.
     */
    public function createLink(int $noteId, int $linkedId, ?string $label = null): ?AiTrainingNoteLink
    {
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
     * Export the whole memory as graph-ready nodes + edges for the mind-map UI.
     *
     * @return array{nodes: array<int, array<string, mixed>>, links: array<int, array<string, mixed>>}
     */
    public function graphData(): array
    {
        $notes = AiTrainingNote::query()
            ->orderBy('id', 'asc')
            ->get();

        $linkRows = AiTrainingNoteLink::get(['id', 'note_id', 'linked_note_id', 'label']);

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
     * Combine title and content so relations can match on either.
     */
    protected function labelSource(AiTrainingNote $note): string
    {
        $title = (string)($note->title ?? '');
        return trim($title . ' ' . $note->content);
    }

    protected function containsTokenOrText(AiTrainingNote $note, string $hint): bool
    {
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
}