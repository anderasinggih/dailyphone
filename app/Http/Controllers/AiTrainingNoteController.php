<?php

namespace App\Http\Controllers;

use App\Models\AiTrainingNote;
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
            ->get()
            ->map(fn($n) => [
                'id' => $n->id,
                'kind' => $n->kind,
                'title' => $n->title,
                'content' => $n->content,
                'is_active' => $n->is_active,
                'author_name' => $n->author_name,
                'author_role' => $n->author_role,
                'updated_at' => $n->updated_at->diffForHumans(),
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

    public function toggle(Request $request, $id): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $note = AiTrainingNote::findOrFail($id);
        $note->update(['is_active' => !$note->is_active]);

        $snippet = mb_strimwidth((string)$note->content, 0, 60, '…');

        return redirect()->route('settings.ai.training-notes')
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

        return redirect()->route('settings.ai.training-notes')
            ->with('success', 'Training note deleted from AI memory.');
    }
}