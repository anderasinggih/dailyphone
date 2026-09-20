<?php

namespace App\Http\Controllers;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use App\Services\AiBrainMaintenanceService;
use App\Services\AiEmbeddingService;
use App\Services\AiFileIngestService;
use App\Services\AiMemoryGraphService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Inertia\Inertia;
use Inertia\Response;

class AiTrainingNoteController extends Controller
{
    /** Upper bound on how many neurons the mind map renders at once. */
    protected const MAP_MAX_NODES = 300;

    /** Graph nodes carry a snippet instead of the full body to keep the payload light. */
    protected const GRAPH_CONTENT_SNIPPET = 220;

    /** Rows shown per page in the Training Notes List view. */
    protected const LIST_PER_PAGE = 25;

    public function index(Request $request): Response
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        [$pageNotes, $pagination, $filters] = $this->resolveList($request);

        $notes = $this->mapWithSynapses($pageNotes);

        return Inertia::render('Settings/AiTrainingNotes', [
            'notes' => $notes,
            'pagination' => $pagination,
            'filters' => $filters,
            'stats' => $this->stats(),
            'graph' => $this->mapGraphData(),
        ]);
    }

    /**
     * Semantic "find a memory" lookup used by the mind-map search and any
     * quick search control. Embedding matches first (when the index is warm),
     * then literal token hits for rules & paused nodes are merged on top.
     */
    public function searchApi(Request $request): JsonResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $q = trim((string) $request->input('q', ''));
        $limit = min(30, max(1, (int) $request->input('limit', 12)));

        if ($q === '') {
            return response()->json(['query' => $q, 'method' => 'keyword', 'results' => []]);
        }

        $embedder = app(AiEmbeddingService::class);
        $results = collect();
        $method = 'keyword';

        if ($embedder->isConfigured()) {
            $semantic = $embedder->search($q, $limit * 2, 0.18, null);
            if ($semantic['notes']->isNotEmpty()) {
                $results = $semantic['notes'];
                $method = 'semantic';
            }
        }

        // Literal matches widen the net: rules (excluded from embedding search)
        // plus paused nodes so a hidden memory is still discoverable.
        $like = '%'.$q.'%';
        $have = $results->pluck('id')->flip();
        $literal = AiTrainingNote::query()
            ->where(function ($b) use ($like) {
                $b->where('title', 'like', $like)
                    ->orWhere('content', 'like', $like)
                    ->orWhere('related_keywords', 'like', $like);
            })
            ->limit(60)
            ->orderByRaw("CASE WHEN kind = 'rule' THEN 0 ELSE 1 END")
            ->orderBy('updated_at', 'desc')
            ->get()
            ->reject(fn ($n) => isset($have[$n->id]));

        // Rank: rules first (behavioral directives are always load-bearing),
        // then semantic score, then recency.
        $items = $results
            ->map(fn ($n) => ['note' => $n, 'score' => $n->retrieval_score])
            ->values()
            ->all();
        foreach ($literal as $n) {
            $items[] = ['note' => $n, 'score' => null];
        }

        usort($items, function ($a, $b) {
            $r = strcmp($a['note']->kind === 'rule' ? '0' : '1', $b['note']->kind === 'rule' ? '0' : '1');
            if ($r !== 0) {
                return $r;
            }
            $sa = $a['score'] ?? -1.0;
            $sb = $b['score'] ?? -1.0;
            if ($sa !== $sb) {
                return $sb <=> $sa;
            }

            return $b['note']->updated_at->timestamp <=> $a['note']->updated_at->timestamp;
        });

        $items = array_slice($items, 0, $limit);

        $results = [];
        foreach ($items as $entry) {
            $n = $entry['note'];
            $results[] = [
                'id' => (int) $n->id,
                'title' => $n->title ?: app(AiMemoryGraphService::class)->titleFromContent((string) $n->content),
                'kind' => $n->kind,
                'is_active' => (bool) $n->is_active,
                'is_stale' => (bool) $n->is_stale,
                'score' => $entry['score'] !== null ? round((float) $entry['score'], 3) : null,
                'snippet' => mb_strimwidth(strip_tags((string) $n->content), 0, 160, '…'),
                'used_count' => (int) ($n->used_count ?? 0),
                'author_name' => $n->author_name ?? 'System',
            ];
        }

        return response()->json(['query' => $q, 'method' => $method, 'results' => $results]);
    }

    /**
     * Full node detail (content + complete synapse list) for the mind-map detail
     * panel, loaded on demand so the graph payload stays trim.
     */
    public function showApi(Request $request, $id): JsonResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $note = AiTrainingNote::findOrFail((int) $id);

        $ids = [(int) $note->id];
        $linkRows = AiTrainingNoteLink::where('note_id', $note->id)
            ->orWhere('linked_note_id', $note->id)
            ->get(['note_id', 'linked_note_id', 'label', 'relation', 'weight', 'reason', 'metadata']);

        $neighborIds = $linkRows->map(fn ($l) => $l->getOtherId((int) $note->id))->map('intval')->all();
        $titleById = [];
        if ($neighborIds !== []) {
            $titleById = AiTrainingNote::whereIn('id', $neighborIds)
                ->pluck('title', 'id')
                ->map(fn ($t) => $t ?: 'Memory')
                ->all();
        }

        $links = $linkRows->map(fn ($l) => [
            'id' => (int) $l->getOtherId((int) $note->id),
            'title' => $titleById[(int) $l->getOtherId((int) $note->id)] ?? 'Memory',
            'label' => $l->label,
            'relation' => $l->relation,
            'weight' => $l->weight !== null ? (float) $l->weight : null,
            'reason' => $l->reason,
            'possible_conflict' => (bool) (($l->metadata[AiMemoryGraphService::METADATA_CONFLICT_FLAG] ?? false) === true),
        ])->sortByDesc(fn ($l) => $l['weight'] ?? 0)->values()->all();

        return response()->json([
            'note' => [
                'id' => (int) $note->id,
                'kind' => $note->kind,
                'title' => $note->title ?: app(AiMemoryGraphService::class)->titleFromContent((string) $note->content),
                'content' => (string) $note->content,
                'is_active' => (bool) $note->is_active,
                'is_stale' => (bool) $note->is_stale,
                'superseded_by' => $note->superseded_by_note_id !== null ? (int) $note->superseded_by_note_id : null,
                'author_name' => $note->author_name ?? 'System',
                'occurred_at' => $note->occurred_at ? $note->occurred_at->format('d M Y') : null,
                'occurred_place' => $note->occurred_place,
                'involved_with' => $note->involved_with,
                'used_count' => (int) ($note->used_count ?? 0),
            ],
            'links' => $links,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $graph = app(AiMemoryGraphService::class);

        $request->validate([
            'content' => 'required|string|max:1000',
            'kind' => 'required|in:'.implode(',', $graph->kinds()),
            'occurred_at' => 'nullable|date',
            'occurred_place' => 'nullable|string|max:120',
            'involved_with' => 'nullable|string|max:120',
        ]);

        $content = trim($request->input('content'));
        $kind = $graph->normalizeKind($request->input('kind'));

        if (! $graph->isDuplicateContent($content)) {
            AiTrainingNote::create([
                'user_id' => $request->user()->id,
                'author_name' => $request->user()->name,
                'author_role' => $request->user()->role,
                'content' => $content,
                'title' => $graph->titleFromContent($content),
                'content_hash' => md5($content),
                'kind' => $kind,
                'is_active' => true,
                'occurred_at' => $request->filled('occurred_at') ? $request->input('occurred_at') : null,
                'occurred_place' => mb_substr(trim((string) $request->input('occurred_place', '')), 0, 120) ?: null,
                'involved_with' => mb_substr(trim((string) $request->input('involved_with', '')), 0, 120) ?: null,
            ]);
        }

        return redirect()->route('settings.ai.training-notes')
            ->with('success', 'Training note saved to AI memory.');
    }

    /**
     * Re-classify a node into another brain kind (validation, condition,
     * emotions, memory, ...). The node's synapses are rebuilt so its place in
     * the mind map always matches its role.
     */
    public function reclassify(Request $request, $id): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $graph = app(AiMemoryGraphService::class);

        $request->validate([
            'kind' => 'required|in:'.implode(',', $graph->kinds()),
        ]);

        $result = $graph->reclassifyNode((int) $id, $request->input('kind'));

        $snippet = mb_strimwidth((string) AiTrainingNote::find($id)?->title ?: 'node', 0, 50, '…');

        return redirect()->back()
            ->with('success', $result['changed']
                ? "Reclassified '{$snippet}' → ".$request->input('kind').' and rewired its synapses.'
                : "Node '{$snippet}' already has that kind.");
    }

    /**
     * Settle a possible-conflict synapse that auto-linking flagged. The
     * reviewer names the winning note and the verdict: "supersedes" marks the
     * loser stale (retrieval stops surfacing it), "contradicts" merely
     * acknowledges both facts stay alive. Either way the pen mark is lifted.
     */
    public function settle(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $request->validate([
            'link_id' => 'required|integer|exists:ai_training_note_links,id',
            'winner_id' => 'required|integer|exists:ai_training_notes,id',
            'action' => 'required|in:supersedes,contradicts',
        ]);

        $result = app(AiMemoryGraphService::class)->settleConflict(
            (int) $request->input('link_id'),
            (int) $request->input('winner_id'),
            (string) $request->input('action')
        );

        $verb = $result['action'] === 'supersedes' ? 'Superseded' : 'Recorded as a contradiction between';

        return redirect()->back()
            ->with('success', "{$verb} #{$result['loser_id']} and #{$result['winner_id']} (cleared {$result['conflicts_cleared']} conflict flag(s)).");
    }

    /**
     * Undo a supersede verdict: the node becomes a live neuron again, its
     * replacement pointer is dropped and its synapses are re-wired.
     */
    public function restore(Request $request, $id): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $note = app(AiMemoryGraphService::class)->restoreNode((int) $id);

        return redirect()->back()
            ->with('success', "Training note #{$note->id} is live again and its synapses were re-wired.");
    }

    /**
     * Let the AI tidy its own brain: it reviews the neuron network and fixes
     * node kinds, titles, keywords and synapse paths that no longer fit.
     * Returns the refreshed training-notes page so the mind map re-renders.
     */
    public function tidy(Request $request): Response
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $result = app(AiBrainMaintenanceService::class)->tidy(80);

        if ($result['ok']) {
            session()->flash('success', $result['message']);
        } else {
            session()->flash('error', $result['message']);
        }

        return $this->index($request);
    }

    /**
     * Index of every file learned from a GitHub repository ("skills"),
     * grouped by source repo so each skill set can be managed as one unit.
     */
    public function skillsIndex(Request $request): Response
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $notes = AiTrainingNote::query()
            ->whereNotNull('source_label')
            ->orderByDesc('updated_at')
            ->get()
            ->map(fn ($n) => [
                'id' => $n->id,
                'kind' => $n->kind,
                'title' => $n->title,
                'content' => $n->content,
                'is_active' => $n->is_active,
                'used_count' => (int) $n->used_count,
                'author_name' => $n->author_name,
                'updated_at' => $n->updated_at->diffForHumans(),
                'source_label' => $n->source_label,
                'source_url' => $n->source_url,
            ]);

        $repos = [];
        foreach ($notes as $note) {
            $key = $note['source_label'] ?: 'unknown';
            $repos[$key]['label'] = $key;
            $repos[$key]['url'] = $note['source_url'] ?: "https://github.com/{$key}";
            $repos[$key]['files'][] = $note;
        }

        $repos = collect(array_values($repos))->map(function ($repo) {
            $files = $repo['files'];
            $repo['total'] = count($files);
            $repo['active'] = collect($files)->where('is_active', true)->count();

            return $repo;
        })->values();

        return Inertia::render('Settings/AiSkillsLibrary', [
            'repos' => $repos,
        ]);
    }

    /**
     * Learn a new public GitHub repository and save its readable files as
     * AI skill/memory neurons (deduplicated by content).
     */
    public function storeRepo(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $request->validate([
            'repo' => 'required|string|max:200',
        ]);

        $result = app(AiFileIngestService::class)
            ->ingestRepository($request->input('repo'), $request->user());

        return redirect()->route('settings.ai.skills')
            ->with($result['success'] ? 'success' : 'error', $result['message']);
    }

    /**
     * Delete every skill file learned from one GitHub repository at once.
     * Node links are pruned automatically by the model's deleted hook.
     */
    public function destroyRepo(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $request->validate([
            'repo' => 'required|string|max:200',
        ]);

        $repo = trim((string) $request->input('repo'));
        if ($repo === '') {
            return redirect()->route('settings.ai.skills')
                ->with('error', 'Repo name cannot be empty.');
        }

        $notes = AiTrainingNote::where('source_label', $repo)->get();
        if ($notes->isEmpty()) {
            return redirect()->route('settings.ai.skills')
                ->with('error', "No skill files found for repo '{$repo}'.");
        }

        // Delete one-by-one so the model's deleted hook prunes every neuron
        // link, keeping the memory graph free of dangling synapses.
        $count = 0;
        foreach ($notes as $note) {
            $note->delete();
            $count++;
        }

        return redirect()->route('settings.ai.skills')
            ->with('success', "Removed {$count} skill files of repo '{$repo}' from AI memory.");
    }

    public function toggle(Request $request, $id): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $note = AiTrainingNote::findOrFail($id);
        $note->update(['is_active' => ! $note->is_active]);

        $snippet = mb_strimwidth((string) $note->content, 0, 60, '…');

        return redirect()->back()
            ->with('success', $note->is_active
                ? "Training note '{$snippet}' is now active."
                : "Training note '{$snippet}' is now paused.");
    }

    public function destroy(Request $request, $id): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        AiTrainingNote::findOrFail($id)->delete();

        return redirect()->back()
            ->with('success', 'Training note deleted from AI memory.');
    }

    /* ───────────────────────────────────────────────────────────
       Internals — list resolution, stats & the capped map payload
       ─────────────────────────────────────────────────────────── */

    /**
     * Branch note: filters & pagination. A query triggers semantic retrieval
     * (embedding index) merged with literal token hits; otherwise the plain
     * store stays ordered rules-first-by-recency and simply paginates.
     *
     * @return array{0: Collection, 1: array, 2: array}
     */
    protected function resolveList(Request $request): array
    {
        $q = trim((string) $request->input('q', ''));
        $kind = in_array($request->input('kind'), (new AiMemoryGraphService)->kinds(), true)
            ? (string) $request->input('kind')
            : null;
        $status = in_array($request->input('status'), ['active', 'paused'], true)
            ? (string) $request->input('status')
            : null;
        $page = max(1, (int) $request->input('page', 1));
        $perPage = self::LIST_PER_PAGE;

        $query = AiTrainingNote::query()
            ->orderByRaw("CASE WHEN kind = 'rule' THEN 0 ELSE 1 END")
            ->orderBy('updated_at', 'desc');

        if ($kind !== null) {
            $query->where('kind', $kind);
        }
        if ($status === 'active') {
            $query->where('is_active', true);
        } elseif ($status === 'paused') {
            $query->where('is_active', false);
        }

        $method = 'keyword';
        if ($q !== '') {
            $merged = $this->searchIds($q, $query, $method);

            if ($merged === []) {
                $total = 0;
                $pageNotes = collect();
            } else {
                $query->whereIn('id', $merged);
                $total = (clone $query)->count();
                $pageNotes = $query->forPage($page, $perPage)->get();
            }
        } else {
            $total = (clone $query)->count();
            $pageNotes = $query->forPage($page, $perPage)->get();
        }

        $pagination = [
            'total' => $total,
            'per_page' => $perPage,
            'current_page' => $page,
            'last_page' => max(1, (int) ceil($total / $perPage)),
        ];

        $filters = ['q' => $q, 'kind' => $kind, 'status' => $status, 'method' => $method];

        return [$pageNotes, $pagination, $filters];
    }

    /**
     * Merge ranked ids for a free-text query: embedding hits first, literal
     * token matches (title/content/related_keywords) second. $method flips to
     * 'semantic' when the embedding index really answered the query.
     *
     * @return int[]
     */
    protected function searchIds(string $q, $query, string &$method): array
    {
        $embedder = app(AiEmbeddingService::class);
        $ids = [];

        if ($embedder->isConfigured()) {
            $semantic = $embedder->search($q, 120, 0.18, null);
            $ids = $semantic['notes']->pluck('id')->map('intval')->all();
            if ($ids !== []) {
                $method = 'semantic';
            }
        }

        $like = '%'.$q.'%';
        $literalIds = (clone $query)
            ->where(function ($b) use ($like) {
                $b->where('title', 'like', $like)
                    ->orWhere('content', 'like', $like)
                    ->orWhere('related_keywords', 'like', $like);
            })
            ->limit(300)
            ->pluck('id')
            ->all();

        return array_values(array_unique(array_merge($ids, array_map('intval', $literalIds))));
    }

    /**
     * Resolve each note's live synapses (relation kind, label, strength and
     * reason) so the List view can show why this memory is connected to others.
     * Neighbour titles are fetched in one extra query, not per row.
     *
     * @return array<int, array<string, mixed>>
     */
    protected function mapWithSynapses($pageNotes): array
    {
        $pageNotes = $pageNotes->values();
        $ids = $pageNotes->pluck('id')->map('intval')->all();
        $synapses = [];

        if ($ids !== []) {
            $linkRows = AiTrainingNoteLink::where(function ($w) use ($ids) {
                $w->whereIn('note_id', $ids)->orWhereIn('linked_note_id', $ids);
            })->get(['note_id', 'linked_note_id', 'label', 'relation', 'weight', 'reason', 'metadata']);

            $neighborIds = $linkRows->flatMap(fn ($l) => [$l->note_id, $l->linked_note_id])
                ->map('intval')
                ->unique()
                ->reject(fn ($id) => in_array($id, $ids, true))
                ->values()
                ->all();

            $titles = $neighborIds === []
                ? collect()
                : AiTrainingNote::whereIn('id', $neighborIds)->pluck('title', 'id');

            // Titles for the page's own notes too, so a synapse between two
            // notes that are both on this page still resolves; `??` also
            // guards against links pointing at already-deleted notes.
            $pageById = collect($pageNotes->all())->keyBy('id');
            $titleOf = function ($id) use ($titles, $pageById) {
                $t = $titles[$id] ?? null;
                if ($t !== null && $t !== '') {
                    return $t;
                }
                $owned = $pageById[$id] ?? null;

                return $owned ? ($owned->title ?: 'Memory') : 'Memory';
            };

            $idSet = array_flip($ids);
            $flag = AiMemoryGraphService::METADATA_CONFLICT_FLAG;
            foreach ($linkRows as $l) {
                $left = (int) $l->note_id;
                $right = (int) $l->linked_note_id;
                if (isset($idSet[$left])) {
                    $synapses[$left][] = [
                        'id' => $right,
                        'title' => $titleOf($right),
                        'label' => $l->label,
                        'relation' => $l->relation,
                        'weight' => $l->weight !== null ? (float) $l->weight : null,
                        'reason' => $l->reason,
                        'possible_conflict' => (bool) (($l->metadata[$flag] ?? false) === true),
                    ];
                }
                if (isset($idSet[$right])) {
                    $synapses[$right][] = [
                        'id' => $left,
                        'title' => $titleOf($left),
                        'label' => $l->label,
                        'relation' => $l->relation,
                        'weight' => $l->weight !== null ? (float) $l->weight : null,
                        'reason' => $l->reason,
                        'possible_conflict' => (bool) (($l->metadata[$flag] ?? false) === true),
                    ];
                }
            }
        }

        return $pageNotes->map(fn ($n) => [
            'id' => $n->id,
            'kind' => $n->kind,
            'title' => $n->title,
            'content' => $n->content,
            'is_active' => $n->is_active,
            'is_stale' => (bool) $n->is_stale,
            'superseded_by' => $n->superseded_by_note_id !== null ? (int) $n->superseded_by_note_id : null,
            'used_count' => (int) $n->used_count,
            'last_used_at' => $n->last_used_at ? $n->last_used_at->diffForHumans() : null,
            'occurred_at' => $n->occurred_at ? $n->occurred_at->format('d M Y') : null,
            'occurred_place' => $n->occurred_place,
            'involved_with' => $n->involved_with,
            'author_name' => $n->author_name,
            'author_role' => $n->author_role,
            'updated_at' => $n->updated_at->diffForHumans(),
            'links' => $synapses[$n->id] ?? [],
        ])->values()->all();
    }

    /**
     * Brain statistics for the four stat cards, computed server-side so the
     * page does not need every node shipped to the browser to count them.
     *
     * @return array{total: int, active: int, rules: int, uses: int, topNote: array|null}
     */
    protected function stats(): array
    {
        $top = AiTrainingNote::orderByDesc('used_count')->first();

        return [
            'total' => (int) AiTrainingNote::count(),
            'active' => (int) AiTrainingNote::where('is_active', true)->count(),
            'stale' => (int) AiTrainingNote::where('is_stale', true)->count(),
            'conflicts' => AiTrainingNoteLink::whereNotNull('metadata')
                ->get(['metadata'])
                ->filter(fn ($l) => (($l->metadata[AiMemoryGraphService::METADATA_CONFLICT_FLAG] ?? false) === true))
                ->count(),
            'rules' => (int) AiTrainingNote::where('kind', 'rule')->where('is_active', true)->count(),
            'uses' => (int) AiTrainingNote::sum('used_count'),
            'topNote' => ($top && (int) $top->used_count > 0)
                ? [
                    'title' => $top->title ?: app(AiMemoryGraphService::class)->titleFromContent((string) $top->content),
                    'used' => (int) $top->used_count,
                ]
                : null,
        ];
    }

    /**
     * The mind-map payload, bounded so the force graph stays fast. Rules are
     * always inside; the remaining slots go to the most load-bearing neurons
     * (active, consulted, recent). Edges are limited to included nodes.
     *
     * @return array{nodes: array<int, array<string, mixed>>, links: array<int, array<string, mixed>>}
     */
    protected function mapGraphData(): array
    {
        $graph = app(AiMemoryGraphService::class);

        $notes = AiTrainingNote::query()
            ->orderByRaw("CASE WHEN kind = 'rule' THEN 0 WHEN is_active = 1 THEN 1 ELSE 2 END")
            ->orderByDesc('used_count')
            ->orderByDesc('updated_at')
            ->limit(self::MAP_MAX_NODES)
            ->get(['id', 'title', 'content', 'kind', 'is_active', 'is_stale', 'used_count', 'author_name']);

        $ids = $notes->pluck('id')->map('intval')->all();
        $idSet = collect($ids)->flip();

        $linkRows = AiTrainingNoteLink::whereIn('note_id', $ids)
            ->whereIn('linked_note_id', $ids)
            ->get(['id', 'note_id', 'linked_note_id', 'label', 'relation', 'weight', 'reason', 'metadata']);

        $degree = [];
        foreach ($linkRows as $l) {
            $degree[$l->note_id] = ($degree[$l->note_id] ?? 0) + 1;
            $degree[$l->linked_note_id] = ($degree[$l->linked_note_id] ?? 0) + 1;
        }

        $nodes = $notes->map(fn ($n) => [
            'id' => (int) $n->id,
            'title' => $n->title ?: $graph->titleFromContent((string) $n->content),
            'content' => mb_strimwidth(strip_tags((string) $n->content), 0, self::GRAPH_CONTENT_SNIPPET, '…'),
            'kind' => $n->kind,
            'is_active' => $n->is_active,
            'is_stale' => (bool) $n->is_stale,
            'author_name' => $n->author_name ?? 'System',
            'degree' => $degree[$n->id] ?? 0,
            'used_count' => (int) ($n->used_count ?? 0),
        ])->values()->all();

        $links = $linkRows->map(function ($l) {
            return [
                'id' => (int) $l->id,
                'source' => (int) $l->note_id,
                'target' => (int) $l->linked_note_id,
                'label' => $l->label,
                'relation' => $l->relation,
                'weight' => $l->weight !== null ? (float) $l->weight : null,
                'reason' => $l->reason,
                'possible_conflict' => (bool) (($l->metadata[AiMemoryGraphService::METADATA_CONFLICT_FLAG] ?? false) === true),
            ];
        })->values()->all();

        return ['nodes' => $nodes, 'links' => $links];
    }
}
