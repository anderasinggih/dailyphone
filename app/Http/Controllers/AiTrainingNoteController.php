<?php

namespace App\Http\Controllers;

use App\Models\AiTrainingNote;
use App\Models\AiTrainingNoteLink;
use App\Services\AiMemoryGraphService;
use Illuminate\Http\Request;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class AiTrainingNoteController extends Controller
{
    public function index(Request $request): Response
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $notes = AiTrainingNote::query()
            ->orderByRaw("CASE WHEN kind = 'rule' THEN 0 ELSE 1 END")
            ->orderBy('updated_at', 'desc')
            ->get();

        $notesById = $notes->keyBy('id');

        // Resolve each note's live synapses (relation kind, label, strength and
        // reason) so the List view can show why this memory is connected to
        // others — in the same way the mind map does.
        $synapses = [];
        AiTrainingNoteLink::get(['note_id', 'linked_note_id', 'label', 'relation', 'weight', 'reason'])
            ->each(function ($l) use (&$synapses, $notesById) {
                if (!isset($notesById[$l->linked_note_id])) {
                    return;
                }
                $synapses[$l->note_id][] = [
                    'id' => (int)$l->linked_note_id,
                    'title' => $notesById[$l->linked_note_id]->title,
                    'label' => $l->label,
                    'relation' => $l->relation,
                    'weight' => $l->weight !== null ? (float)$l->weight : null,
                    'reason' => $l->reason,
                ];
                if (!isset($notesById[$l->note_id])) {
                    return;
                }
                $synapses[$l->linked_note_id][] = [
                    'id' => (int)$l->note_id,
                    'title' => $notesById[$l->note_id]->title,
                    'label' => $l->label,
                    'relation' => $l->relation,
                    'weight' => $l->weight !== null ? (float)$l->weight : null,
                    'reason' => $l->reason,
                ];
            });

        $notes = $notes->map(fn($n) => [
            'id' => $n->id,
            'kind' => $n->kind,
            'title' => $n->title,
            'content' => $n->content,
            'is_active' => $n->is_active,
            'author_name' => $n->author_name,
            'author_role' => $n->author_role,
            'updated_at' => $n->updated_at->diffForHumans(),
            'links' => $synapses[$n->id] ?? [],
        ]);

        return Inertia::render('Settings/AiTrainingNotes', [
            'notes' => $notes,
            'graph' => app(AiMemoryGraphService::class)->graphData(),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $request->validate([
            'content' => 'required|string|max:1000',
            'kind' => 'required|in:rule,knowledge',
        ]);

        $content = trim($request->input('content'));
        $kind = $request->input('kind');
        $graph = app(AiMemoryGraphService::class);

        if (!$graph->isDuplicateContent($content)) {
            AiTrainingNote::create([
                'user_id' => $request->user()->id,
                'author_name' => $request->user()->name,
                'author_role' => $request->user()->role,
                'content' => $content,
                'title' => $graph->titleFromContent($content),
                'content_hash' => md5($content),
                'kind' => $kind,
                'is_active' => true,
            ]);
        }

        return redirect()->route('settings.ai.training-notes')
            ->with('success', 'Training note saved to AI memory.');
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

        $result = app(\App\Services\AiFileIngestService::class)
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
        $note->update(['is_active' => !$note->is_active]);

        $snippet = mb_strimwidth((string)$note->content, 0, 60, '…');

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
}