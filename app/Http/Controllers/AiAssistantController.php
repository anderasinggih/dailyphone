<?php

namespace App\Http\Controllers;

use App\Services\GeminiAssistantService;
use App\Services\AiActionService;
use App\Events\AiAssistantRunProgress;
use App\Models\GeneralSetting;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class AiAssistantController extends Controller
{
    protected GeminiAssistantService $geminiService;
    protected AiActionService $aiActionService;

    // Real node counts computed for the current request when the user asks
    // "how many nodes", so the guard can tell a backed-up count from a made-up
    // one instead of trusting the model's own arithmetic.
    protected ?array $nodeStatsForGuard = null;

    // How many brand-new neuron nodes this chat run actually persisted (memos,
    // reconciled claims, silently extracted user facts). Reset per request so
    // the client toast reports real numbers, never the model's made-up ones.
    protected int $nodesSavedThisRun = 0;

    public function __construct(GeminiAssistantService $geminiService, AiActionService $aiActionService)
    {
        $this->geminiService = $geminiService;
        $this->aiActionService = $aiActionService;
    }

    /**
     * Render the full Assistant page (sessions sidebar + chat) inside the app shell.
     */
    public function index(Request $request): Response
    {
        return $this->renderAssistant($request, false);
    }

    /**
     * Render a focused, chat-only page with no main navigation shell, so a user
     * can concentrate on the AI assistant without touching any other page.
     * Keeps the exact same auth + verified authorization rules as every app page.
     */
    public function chatOnly(Request $request): Response
    {
        return $this->renderAssistant($request, true);
    }

    /**
     * Shared renderer for the Assistant page. When $chatOnly is true the client
     * renders the bare chat room (no app nav bars and no links leaving the chat).
     */
    protected function renderAssistant(Request $request, bool $chatOnly): Response
    {
        $settings = GeneralSetting::first();
        $isConfigured = $this->geminiService->isConfigured();
        $isEnabled = $this->geminiService->isEnabled();
        $model = $this->geminiService->getModel();
        $user = $request->user();

        // 1a. Fetch user's projects with their nested sessions + file trees.
        // Projects group sessions and own a shared file system whose files can
        // be @-referenced inside any session of that project.
        $projects = \App\Models\AiProject::where('user_id', $user->id)
            ->orderBy('updated_at', 'desc')
            ->get()
            ->map(function ($p) {
                return [
                    'id' => (int) $p->id,
                    'title' => $p->title,
                    'description' => $p->description,
                    'created_at' => $p->created_at,
                    'updated_at' => $p->updated_at,
                    'sessions' => $p->sessions()->get(['id', 'title', 'created_at', 'updated_at']),
                    'files' => $this->buildProjectFileTree($p->id),
                ];
            })
            ->values()
            ->all();

        // 1. Fetch user's chat sessions
        $sessions = \App\Models\AiSession::where('user_id', $user->id)
            ->orderBy('updated_at', 'desc')
            ->get(['id', 'project_id', 'title', 'custom_rules', 'ai_model', 'created_at', 'updated_at']);

        // 2. Determine active session
        $activeSessionId = $request->query('session_id');
        $activeSession = null;

        if ($activeSessionId) {
            $activeSession = $sessions->firstWhere('id', $activeSessionId);
        }

        if (!$activeSession && $sessions->isNotEmpty()) {
            $activeSession = $sessions->first();
        }

        // 3. Fetch chats for the active session
        $messages = [];
        if ($activeSession) {
            $messages = \App\Models\AiChat::where('session_id', $activeSession->id)
                ->orderBy('id', 'asc')
                ->get()
                ->map(function ($chat) {
                    return [
                        'id' => (string)$chat->id,
                        'role' => $chat->role,
                        'content' => $chat->content,
                        'action_status' => $chat->action_status,
                        'timestamp' => $chat->created_at->format('H:i'),
                    ];
                });
        }

        return Inertia::render('Assistant/Index', [
            'aiConfig' => [
                'is_configured' => $isConfigured,
                'is_enabled' => $isEnabled,
                'model' => $model,
            ],
            'userRole' => $user->role,
            'chatOnly' => $chatOnly,
            'projects' => $projects,
            'sessions' => $sessions,
            'activeSessionId' => $activeSession ? $activeSession->id : null,
            'initialMessages' => $messages,
        ]);
    }

    /**
     * Build the nested folder/file tree for a project from a single flat query.
     * Folders are rows with is_folder = true; nesting comes from parent_id.
     */
    protected function buildProjectFileTree(int $projectId): array
    {
        $rows = \App\Models\AiProjectFile::where('project_id', $projectId)
            ->orderBy('is_folder', 'desc')
            ->orderBy('name', 'asc')
            ->get();

        $byParent = $rows->groupBy(function ($f) {
            return (int) ($f->parent_id ?? 0);
        });

        $build = function (int $parentId) use (&$build, $byParent): array {
            $bucket = $byParent->get($parentId) ?? collect();

            return $bucket->map(function ($f) use ($build) {
                return [
                    'id' => (int) $f->id,
                    'name' => $f->name,
                    'is_folder' => (bool) $f->is_folder,
                    'kind' => $f->kind,
                    'mime_type' => $f->mime_type,
                    'size_bytes' => (int) $f->size_bytes,
                    'created_at' => $f->created_at,
                    'updated_at' => $f->updated_at,
                    'children' => $f->is_folder ? $build((int) $f->id) : [],
                ];
            })->values()->all();
        };

        return $build(0);
    }

    /**
     * Flat JSON payload for a single project file / folder row, used to
     * update the client-side tree after uploads and folder creation.
     */
    protected function projectFilePayload(\App\Models\AiProjectFile $f): array
    {
        return [
            'id' => (int) $f->id,
            'name' => $f->name,
            'is_folder' => (bool) $f->is_folder,
            'kind' => $f->kind,
            'mime_type' => $f->mime_type,
            'size_bytes' => (int) $f->size_bytes,
            'created_at' => $f->created_at,
            'updated_at' => $f->updated_at,
            'children' => $f->is_folder ? [] : [],
        ];
    }

    /**
     * Upload a file (image, spreadsheet, archive, document, ...) so the AI can
     * read it. Text is extracted server-side and remembered on the attachment;
     * images/PDFs are re-attached as inline data when the user sends a message.
     */
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|max:20480',
        ]);

        $user = $request->user();
        $file = $request->file('file');
        $originalName = $file->getClientOriginalName();
        $mime = $file->getMimeType();
        $ingest = app(\App\Services\AiFileIngestService::class);

        $kind = $ingest->classify($originalName, $mime);
        $storagePath = $file->store('ai-uploads', 'local');
        $fullPath = storage_path('app/private/' . $storagePath);

        $text = $ingest->extractText($fullPath, $mime, $originalName, \App\Services\AiFileIngestService::DOCUMENT_TEXT_MAX);

        $attachment = \App\Models\AiChatAttachment::create([
            'user_id' => $user->id,
            'original_name' => $originalName,
            'mime_type' => $mime,
            'size_bytes' => $file->getSize(),
            'kind' => $kind,
            'storage_path' => $storagePath,
            'extracted_text' => $text === '' ? null : $text,
            'content_hash' => md5_file($fullPath) ?: null,
        ]);

        return response()->json([
            'success' => true,
            'attachment' => [
                'id' => $attachment->id,
                'original_name' => $originalName,
                'kind' => $kind,
                'size_bytes' => $attachment->size_bytes,
                'text_chars' => mb_strlen($text),
            ],
        ]);
    }

    /**
     * Create a new chat session, optionally inside a project.
     */
    public function createSession(Request $request): JsonResponse
    {
        $request->validate([
            'project_id' => 'nullable|exists:ai_projects,id',
        ]);

        $projectId = $request->input('project_id');
        if ($projectId) {
            \App\Models\AiProject::where('user_id', $request->user()->id)->findOrFail($projectId);
        }

        $session = \App\Models\AiSession::create([
            'user_id' => $request->user()->id,
            'project_id' => $projectId ? (int) $projectId : null,
            'title' => 'New Chat',
        ]);

        return response()->json([
            'success' => true,
            'session' => $session,
        ]);
    }

    /**
     * Create a project and its first chat session.
     */
    public function createProject(Request $request): JsonResponse
    {
        $request->validate([
            'title' => 'required|string|max:120',
            'description' => 'nullable|string|max:2000',
        ]);

        $user = $request->user();
        $project = \App\Models\AiProject::create([
            'user_id' => $user->id,
            'title' => trim($request->input('title')),
            'description' => trim((string) $request->input('description')) ?: null,
        ]);

        $session = \App\Models\AiSession::create([
            'user_id' => $user->id,
            'project_id' => $project->id,
            'title' => 'New Chat',
        ]);

        $project->touch();

        return response()->json([
            'success' => true,
            'project' => [
                'id' => (int) $project->id,
                'title' => $project->title,
                'description' => $project->description,
                'created_at' => $project->created_at,
                'updated_at' => $project->updated_at,
                'sessions' => [$session],
                'files' => [],
            ],
        ]);
    }

    /**
     * Rename a project / update its description.
     */
    public function updateProject(Request $request, $id): JsonResponse
    {
        $request->validate([
            'title' => 'nullable|string|max:120',
            'description' => 'nullable|string|max:2000',
        ]);

        $project = \App\Models\AiProject::where('user_id', $request->user()->id)->findOrFail($id);

        $updateData = [];
        if ($request->has('title')) {
            $updateData['title'] = trim($request->input('title'));
        }
        if ($request->has('description')) {
            $updateData['description'] = trim((string) $request->input('description')) ?: null;
        }
        if ($updateData !== []) {
            $project->update($updateData);
        }

        return response()->json([
            'success' => true,
            'project' => [
                'id' => (int) $project->id,
                'title' => $project->title,
                'description' => $project->description,
                'updated_at' => $project->updated_at,
            ],
            'message' => 'Project updated successfully.',
        ]);
    }

    /**
     * Delete a project. Cascades to its sessions, chats and files.
     */
    public function deleteProject(Request $request, $id): JsonResponse
    {
        $project = \App\Models\AiProject::where('user_id', $request->user()->id)->findOrFail($id);

        // Remove stored blobs before the DB row (and its cascade) goes away.
        foreach ($project->files()->where('is_folder', false)->get() as $file) {
            if ($file->storage_path) {
                \Illuminate\Support\Facades\Storage::disk('local')->delete($file->storage_path);
            }
        }

        $project->delete();

        return response()->json([
            'success' => true,
            'message' => 'Project deleted successfully.',
        ]);
    }

    /**
     * Resolve a project that belongs to the current user (or abort 404).
     */
    protected function resolveProject($id): \App\Models\AiProject
    {
        return \App\Models\AiProject::where('user_id', request()->user()->id)->findOrFail($id);
    }

    /**
     * Resolve a file/folder row that belongs to the current user's project.
     */
    protected function resolveProjectFile($projectId, $fileId, bool $mustBeFolder = false): \App\Models\AiProjectFile
    {
        $file = \App\Models\AiProjectFile::where('project_id', $projectId)
            ->where('user_id', request()->user()->id)
            ->findOrFail($fileId);

        if ($mustBeFolder && ! $file->is_folder) {
            abort(422, 'Expected a folder.');
        }

        return $file;
    }

    /**
     * Unique name inside a given folder: appends " (2)", " (3)", ... so a
     * freshly uploaded file or folder never silently overwrites an existing
     * sibling whose content might already be referenced in a conversation.
     */
    protected function uniqueProjectEntryName(int $projectId, ?int $parentId, string $name): string
    {
        $existing = \App\Models\AiProjectFile::where('project_id', $projectId)
            ->where('parent_id', $parentId);
        $existsInBucket = $existing->pluck('name');

        if (! $existsInBucket->contains($name)) {
            return $name;
        }

        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $base = $ext !== '' ? substr($name, 0, -(strlen($ext) + 1)) : $name;

        for ($i = 2; $i <= 999; $i++) {
            $candidate = $ext !== ''
                ? $base . ' (' . $i . ').' . $ext
                : $base . ' (' . $i . ')';
            if (! $existsInBucket->contains($candidate)) {
                return $candidate;
            }
        }

        return $name . ' ' . uniqid();
    }

    /**
     * Upload a file into a project's file tree (max 10 MB per file). Text is
     * extracted server-side so it can be @-referenced into the AI context.
     */
    public function uploadProjectFile(Request $request, $project): JsonResponse
    {
        $project = $this->resolveProject($project);

        $request->validate([
            'file' => 'required|file|max:10240',
            'parent_id' => 'nullable|exists:ai_project_files,id',
        ]);

        $parentId = $request->input('parent_id');
        if ($parentId) {
            $this->resolveProjectFile($project->id, $parentId, mustBeFolder: true);
        }

        $user = $request->user();
        $file = $request->file('file');
        $originalName = $file->getClientOriginalName();
        $mime = $file->getMimeType();
        $name = $this->uniqueProjectEntryName($project->id, $parentId ? (int) $parentId : null, $originalName);

        $ingest = app(\App\Services\AiFileIngestService::class);
        $kind = $ingest->classify($originalName, $mime);
        $storagePath = $file->store('ai-projects', 'local');
        $fullPath = storage_path('app/private/' . $storagePath);

        $text = $ingest->extractText(
            $fullPath,
            $mime,
            $originalName,
            $ingest::ATTACHMENT_TEXT_MAX
        );

        $record = \App\Models\AiProjectFile::create([
            'user_id' => $user->id,
            'project_id' => $project->id,
            'parent_id' => $parentId ? (int) $parentId : null,
            'name' => $name,
            'is_folder' => false,
            'mime_type' => $mime,
            'size_bytes' => $file->getSize(),
            'kind' => $kind,
            'storage_path' => $storagePath,
            'extracted_text' => $text === '' ? null : $text,
            'content_hash' => md5_file($fullPath) ?: null,
        ]);

        $project->touch();

        return response()->json([
            'success' => true,
            'file' => $this->projectFilePayload($record),
        ]);
    }

    /**
     * Create a folder inside a project's file tree.
     */
    public function createProjectFolder(Request $request, $project): JsonResponse
    {
        $project = $this->resolveProject($project);

        $request->validate([
            'name' => 'required|string|max:120',
            'parent_id' => 'nullable|exists:ai_project_files,id',
        ]);

        $parentId = $request->input('parent_id');
        if ($parentId) {
            $this->resolveProjectFile($project->id, $parentId, mustBeFolder: true);
        }

        $name = $this->uniqueProjectEntryName($project->id, $parentId ? (int) $parentId : null, trim($request->input('name')));

        $folder = \App\Models\AiProjectFile::create([
            'user_id' => $request->user()->id,
            'project_id' => $project->id,
            'parent_id' => $parentId ? (int) $parentId : null,
            'name' => $name,
            'is_folder' => true,
        ]);

        $project->touch();

        return response()->json([
            'success' => true,
            'file' => $this->projectFilePayload($folder),
        ]);
    }

    /**
     * List a project's file tree (fresh copy used after mutations).
     */
    public function listProjectFiles(Request $request, $project): JsonResponse
    {
        $project = $this->resolveProject($project);

        return response()->json([
            'success' => true,
            'files' => $this->buildProjectFileTree($project->id),
        ]);
    }

    /**
     * Return the readable text of a project file for the built-in viewer.
     * Images / PDFs / archives return no text; the client renders those via
     * the preview stream endpoint instead.
     */
    public function getProjectFileContent(Request $request, $project, $file): JsonResponse
    {
        $project = $this->resolveProject($project);
        $record = $this->resolveProjectFile($project->id, $file);

        if ($record->is_folder) {
            abort(422, 'Folders have no content.');
        }

        $content = $record->extracted_text;
        if ($content === null && $record->storage_path) {
            $fullPath = storage_path('app/private/' . $record->storage_path);
            if (is_file($fullPath)) {
                $content = @file_get_contents($fullPath) ?: null;
            }
        }

        return response()->json([
            'success' => true,
            'file' => $this->projectFilePayload($record),
            'content' => $content,
        ]);
    }

    /**
     * Stream a project file so <img> / <iframe> previews render inline.
     */
    public function previewProjectFile(Request $request, $project, $file): BinaryFileResponse
    {
        $project = $this->resolveProject($project);
        $record = $this->resolveProjectFile($project->id, $file);

        if ($record->is_folder || ! $record->storage_path) {
            abort(404);
        }

        $fullPath = storage_path('app/private/' . $record->storage_path);
        if (! is_file($fullPath)) {
            abort(404);
        }

        return response()->file($fullPath, $record->mime_type ? ['Content-Type' => $record->mime_type] : []);
    }

    /**
     * Download a project file (with its original name).
     */
    public function downloadProjectFile(Request $request, $project, $file): BinaryFileResponse
    {
        $project = $this->resolveProject($project);
        $record = $this->resolveProjectFile($project->id, $file);

        if ($record->is_folder || ! $record->storage_path) {
            abort(404);
        }

        $fullPath = storage_path('app/private/' . $record->storage_path);
        if (! is_file($fullPath)) {
            abort(404);
        }

        return response()->download($fullPath, $record->name, $record->mime_type ? ['Content-Type' => $record->mime_type] : []);
    }

    /**
     * Delete a file (removes the stored blob) or folder (cascades to every
     * descendant). Wired to the sidebar + viewer UI.
     */
    public function deleteProjectFile(Request $request, $project, $file): JsonResponse
    {
        $project = $this->resolveProject($project);
        $record = $this->resolveProjectFile($project->id, $file);

        $blobsToDelete = collect();

        if ($record->is_folder) {
            // Gather every descendant file row (recursively) so their stored
            // blobs are removed too — the DB cascade only kills the rows.
            $blobsToDelete = \App\Models\AiProjectFile::where('project_id', $project->id)
                ->where('is_folder', false)
                ->whereNotNull('storage_path')
                ->get()
                ->filter(function ($f) use ($record) {
                    $node = $f;
                    $depth = 0;
                    while ($node && $node->parent_id && $depth < 1000) {
                        if ((int) $node->parent_id === (int) $record->id) {
                            return true;
                        }
                        $node = $node->parent()->first();
                        $depth++;
                    }
                    return false;
                });

            if ($blobsToDelete->isNotEmpty()) {
                foreach ($blobsToDelete as $f) {
                    \Illuminate\Support\Facades\Storage::disk('local')->delete($f->storage_path);
                }
            }
        } elseif ($record->storage_path) {
            \Illuminate\Support\Facades\Storage::disk('local')->delete($record->storage_path);
        }

        $record->delete();
        $project->touch();

        return response()->json([
            'success' => true,
            'message' => 'Deleted successfully.',
        ]);
    }

    /**
     * Process user chat message within a session and remember context.
     * Streams newline-delimited JSON progress events so the Assistant UI can
     * render "accessing neurons" live while the model is thinking.
     */
    public function chat(Request $request): JsonResponse|StreamedResponse
    {
        $request->validate([
            'message' => 'required_without:attachments|string|max:200000',
            'session_id' => 'nullable|exists:ai_sessions,id',
            'project_id' => 'nullable|exists:ai_projects,id',
            'attachments' => 'nullable|array',
            'attachments.*' => 'integer',
            'project_file_ids' => 'nullable|array',
            'project_file_ids.*' => 'integer',
            'model' => 'nullable|string|max:100',
        ]);

        if (!$this->geminiService->isEnabled()) {
            return response()->json([
                'success' => false,
                'reply' => 'AI Assistant is currently disabled in system settings.'
            ], 403);
        }

        $user = $request->user();
        $userText = trim($request->input('message') ?? '');
        $sessionId = $request->input('session_id');
        $attachmentIds = array_values(array_filter(array_map('intval', (array)$request->input('attachments', []))));
        $projectFileIds = array_values(array_filter(array_map('intval', (array)$request->input('project_file_ids', []))));

        $attachments = \App\Models\AiChatAttachment::where('user_id', $user->id)
            ->whereIn('id', $attachmentIds)
            ->get();

        // Resolve project files referenced with @-mentions / the file picker so
        // their extracted text can be injected into the model context alongside
        // ordinary uploaded attachments. They stay in the project tree (they are
        // not "consumed" or moved by a message).
        $projectFiles = collect();
        if ($projectFileIds !== []) {
            $projectFiles = \App\Models\AiProjectFile::where('user_id', $user->id)
                ->whereIn('id', $projectFileIds)
                ->where('is_folder', false)
                ->whereNotNull('storage_path')
                ->get();
        }

        if ($userText === '' && ($attachments->isNotEmpty() || $projectFiles->isNotEmpty())) {
            $userText = '📎 ' . $attachments->pluck('original_name')
                ->merge($projectFiles->pluck('name'))
                ->join(', ');
        }

        // If no session provided, find or create one
        try {
            if (!$sessionId) {
                $session = \App\Models\AiSession::create([
                    'user_id' => $user->id,
                    'title' => mb_substr($userText, 0, 80) . (mb_strlen($userText) > 80 ? '...' : ''),
                ]);
                $sessionId = $session->id;
            } else {
                $session = \App\Models\AiSession::where('user_id', $user->id)->findOrFail($sessionId);
                // If it was default title "New Chat", rename based on first query
                if ($session->title === 'New Chat') {
                    $session->update([
                        'title' => mb_substr($userText, 0, 80) . (mb_strlen($userText) > 80 ? '...' : ''),
                    ]);
                }
            }

            // 1. Save user message in this session
            $userChat = \App\Models\AiChat::create([
                'user_id' => $user->id,
                'session_id' => $sessionId,
                'role' => 'user',
                'content' => $userText,
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('AI Chat pre-stream persistence failed: ' . $e->getMessage(), [
                'exception' => $e
            ]);
            return response()->json([
                'success' => false,
                'message' => 'The message could not be saved. Please shorten it or try again.',
                'reply' => 'The message could not be saved. Please shorten it or try again.',
            ], 422);
        }

        // Link any uploaded attachments to this message so they stay with the
        // session history and can be reused / cleaned up later.
        if ($attachments->isNotEmpty()) {
            \App\Models\AiChatAttachment::whereKey($attachments->pluck('id'))
                ->update([
                    'user_id' => $user->id,
                    'session_id' => $sessionId,
                    'ai_chat_id' => $userChat->id,
                ]);
        }

        // 2. Fetch recent conversation memory for THIS SESSION ONLY (last 10 messages)
        $recentChats = \App\Models\AiChat::where('session_id', $sessionId)
            ->orderBy('id', 'desc')
            ->limit(10)
            ->get()
            ->reverse()
            ->values();

        // Rolling conversation summary (item 7, token-budget trimming): turn
        // the older -part already compressed into ai_summary into a compact
        // memory block the model can trust instead of the full transcript.
        $sessionSummary = $session->ai_summary;

        $messagesForModel = $recentChats->map(function ($c) {
            return [
                'role' => $c->role,
                'content' => $c->content,
            ];
        })->toArray();

        // Release the session lock before streaming so long requests do not
        // block other tabs / requests for the same user.
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }

        // Resolve the per-session model override once, before streaming starts.
        $requestedModel = $request->input('model') ?: null;

        $stream = function () use ($userText, $user, $session, $sessionId, $messagesForModel, $attachments, $projectFiles, $requestedModel, $sessionSummary) {
            $startTime = microtime(true);
            $run = [
                'user_id' => $user->id,
                'session_id' => $sessionId,
                'query' => mb_substr($userText, 0, 4000),
                'model' => $requestedModel ?: $this->geminiService->getModel(),
                'status' => 'success',
                'error' => null,
                'ai_chat_id' => null,
                'neurons_retrieved' => null,
                'tools_called' => null,
                'citations' => null,
                'retrieval_confidence' => null,
                'usage' => null,
            ];
            // Large attachments (PDF books, archives) can make the Gemini round
            // trip take minutes; make sure PHP's execution clock never cuts the
            // stream mid-flight, otherwise the client sees an empty response.
            @set_time_limit(600);
            @ini_set('zlib.output_compression', '0');

            $emit = function (array $payload): void {
                echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
                $levels = ob_get_level();
                for ($i = 0; $i < $levels; $i++) {
                    @ob_flush();
                }
                @flush();
            };

            // Live brain map across tabs: mirror the NDJSON events to the
            // superadmin's private Reverb channel so a chat in one tab pulses
            // the map in any other (memory map, second assistant tab). Never
            // fatal — the stream must keep flowing even if the socket pushes.
            $broadcast = function (array $payload): void {
                try {
                    broadcast(new AiAssistantRunProgress($payload));
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::debug('AI live broadcast failed: ' . $e->getMessage());
                }
            };

            // Durable per-stage snapshot persisted when the run completes.
            $accumulatedStages = [];
            $accumulatedUsedIds = [];

            try {
                // If the user asked to "learn / study / remember" an uploaded
                // document (PDF book, DOCX, ...), the system indexes it into real
                // knowledge neurons BEFORE the model replies — so the model can
                // honestly confirm with real numbers instead of guessing.
                $ingestNotice = '';
                if ($attachments->isNotEmpty()) {
                    $userTextLower = strtolower($userText);
                    $learnIntent = preg_match('/(bel[ae]jar|study|learn|pahami|memahami|pelajari|ingat|simpan|materi|bac[ae]|jadikan\s*(?:node|memory))/i', $userTextLower);
                    if ($learnIntent) {
                        $ingested = app(\App\Services\AiFileIngestService::class)->ingestDocument($attachments, $user);
                        if ($ingested['notes_count'] > 0) {
                            $ingestNotice = "\nSISTEM INGEST (FAKTUAL): " . $ingested['message'] . " Telah tersambung ke neuron network.\n";
                            $emit([
                                'type' => 'learned',
                                'notes_count' => $ingested['notes_count'],
                                'message' => $ingested['message'],
                            ]);
                        } else {
                            $ingestNotice = "\nSISTEM INGEST: file lampiran tidak memuat teks baru yang bisa diindeks (" . $ingested['message'] . "). Jangan mengklaim node dibuat.\n";
                        }
                    }
                }

                // If the user shares a URL (article / Wikipedia / news / PDF link)
                // and asks to read, study, summarize or memorize it, the backend
                // fetches the page and saves its content as real neuron nodes in
                // this same request. The grounded excerpt is handed to Gemini so
                // it can honestly summarize the article instead of guessing.
                $urlMatches = [];
                preg_match_all('#https?://\S+#iu', $userText, $urlMatches);
                if (!empty($urlMatches[0])) {
                    $readUrl = preg_match('/(bel[ae]jar|study|learn|pahami|memahami|pelajari|ingat|simpan|bac[ae]|ringkas|rangkum|summar|analisis|pinter|materi|jadikan\s*(?:node|memory))/i', $userText);
                    if ($readUrl) {
                        $urlToLearn = preg_replace('/[),.;:!?\'"*+>\]\}】）》]+$/u', '', $urlMatches[0][0]);
                        $ingestedUrl = app(\App\Services\AiFileIngestService::class)->ingestUrl($urlToLearn, $user);
                        if ($ingestedUrl['success'] && $ingestedUrl['notes_count'] > 0) {
                            $excerpt = (string) ($ingestedUrl['excerpt'] ?? '');
                            $ingestNotice .= "\nSISTEM INGEST (FAKTUAL): " . $ingestedUrl['message']
                                . "\nJudul artikel: " . ($ingestedUrl['title'] ?? '')
                                . "\nURL: " . ($ingestedUrl['url'] ?? $urlToLearn)
                                . "\nCUPLIKAN ISI ARTIKEL (sudah menjadi node neuron memory):\n" . $excerpt
                                . "\nGunakan cuplikan ini untuk menjawab / meringkas artikel secara jujur berdasarkan fakta dari tautan.\n";
                            $emit([
                                'type' => 'learned',
                                'notes_count' => $ingestedUrl['notes_count'],
                                'url' => $ingestedUrl['url'] ?? $urlToLearn,
                                'title' => $ingestedUrl['title'] ?? '',
                                'message' => $ingestedUrl['message'],
                            ]);
                        } else {
                            $ingestNotice .= "\nSISTEM INGEST: gagal mengambil isi tautan (" . $ingestedUrl['message'] . "). Jangan mengklaim artikel tersimpan.\n";
                        }
                    }
                }

                // Inter-turn momentum & situational recall: give retrieval the
                // recent conversation BEFORE the live neuron map is resolved, so
                // the map, the model context and the telemetry all share the
                // same blended seed set (semantic + conversation + episode).
                $this->geminiService->setConversationContext($messagesForModel);

                $network = $this->geminiService->resolveNeuronNetwork(
                    $userText,
                    // Stream each retrieval stage the moment it completes, so
                    // the live brain map lights up in real time: rules → the
                    // embedding index answering → situational seeds. The final
                    // 'neurons' event below carries the whole set + synapses.
                    function (string $stage, array $nodes) use ($emit, $broadcast, &$accumulatedStages, $userText) {
                        $emit(['type' => 'stage', 'stage' => $stage, 'nodes' => $nodes]);
                        $accumulatedStages[] = ['stage' => $stage, 'nodes' => $nodes];
                        $broadcast([
                            'kind' => 'stage',
                            'query' => mb_substr($userText, 0, 200),
                            'stage' => $stage,
                            'nodes' => $nodes,
                        ]);
                    }
                );
                $neurons = $network['nodes'];
                $emit(['type' => 'neurons', 'nodes' => $network['nodes'], 'edges' => $network['edges']]);
                $broadcast(['kind' => 'neurons', 'nodes' => $network['nodes'], 'edges' => $network['edges']]);

                // Feedback loop (item 3): when the superadmin rejected the last
                // proposal and now writes a corrective instruction, fold the
                // rejection + revision into a 'validation' neuron so the AI
                // "knows next time" instead of repeating the same mistake.
                try {
                    $this->learnFromProposalRejection($sessionId, $userText, $user);
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('Proposal feedback learning failed: ' . $e->getMessage());
                }

                // Real, verifiable node counts: when the user asks how many
                // nodes/memories exist or were added, hand the model the true
                // numbers from the database instead of letting it invent them.
                try {
                    $nodeNotice = $this->nodeStatsNotice($userText, $session);
                    if ($nodeNotice !== '') {
                        $ingestNotice .= "\n" . $nodeNotice;
                    }
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('Node stats notice failed: ' . $e->getMessage());
                }

                // 3. Send to Gemini with full session memory & custom session rules/training.
                // Project @-referenced files are folded in together with ordinary
                // uploads so the model sees their extracted text in the same block.
                $contextFiles = $attachments->concat($projectFiles);
                $result = $this->geminiService->chat($messagesForModel, $user, $session->custom_rules, $userText, $contextFiles,
                    function (string $delta) use ($emit) {
                        $emit(['type' => 'chunk', 'text' => $delta]);
                    },
                    $ingestNotice,
                    $requestedModel,
                    $sessionSummary
                );

                // 4. Save AI reply to database in this session
                if (!empty($result['reply'])) {
                    // The model sometimes claims a node was saved without ever
                    // emitting a real ```ai_memo block (so nothing persisted and
                    // the claim is a lie). Reconcile BEFORE storing: try one
                    // deterministic recovery call to actually save the memory;
                    // if that fails, correct the visible reply so the claim no
                    // longer deceives the user.
                    $this->reconcileMemoClaims(
                        $result,
                        $user,
                        $userText,
                        $ingestNotice,
                        $this->previousUserText($messagesForModel, $userText)
                    );

                    // Persist any training memos the AI wrote. The visible reply
                    // is already stripped client-side; the RAW text (which still
                    // contains the ```ai_memo blocks) is what we inspect here.
                    $rawReply = $result['raw_reply'] ?? $result['reply'];
                    if (!$this->hasPersistableMemo($rawReply)) {
                        // The model stayed silent AND emitted no ```ai_memo
                        // block this turn. Deterministically grab any clearly
                        // memory-worthy fact (preference / family relation) from
                        // the user's message and save it so the neuron still
                        // learns — no announcement, fully behind the scenes.
                        $this->silentlyPersistUserFact(
                            $result,
                            $user,
                            $userText,
                            $this->previousUserText($messagesForModel, $userText)
                        );
                        $rawReply = $result['raw_reply'] ?? $rawReply;
                    }
                    $this->persistTrainingMemos($rawReply, $user);

                    // Live toast: surface every real "new node" created during
                    // this chat turn so the user sees memory grow in the corner
                    // instead of trusting an unverifiable model announcement.
                    if ($this->nodesSavedThisRun > 0) {
                        $emit([
                            'type' => 'learned',
                            'source' => 'chat',
                            'notes_count' => $this->nodesSavedThisRun,
                            'message' => $this->nodesSavedThisRun === 1
                                ? 'A new node was saved to AI memory.'
                                : $this->nodesSavedThisRun . ' new nodes were saved to AI memory.',
                        ]);
                    }

                    // The AI cites which neuron nodes it actually consulted in a
                    // trailing metadata line (see the system prompt). Record that
                    // usage signal, then strip the line from the text the user
                    // sees / the session stores so it never leaks to the UI.
                    $usedNodeIds = $this->extractCitedNodeIds($result['reply']);
                    if ($usedNodeIds !== []) {
                        app(\App\Services\AiMemoryGraphService::class)->registerUsage($usedNodeIds);
                        // Live brain map: the nodes the model CITES back in its
                        // answer are the ones it really leaned on — pulse them
                        // as a final white confirmation after the token stream.
                        $emit(['type' => 'trace', 'used' => array_values(array_map('intval', $usedNodeIds))]);
                        $accumulatedUsedIds = array_values(array_unique(array_merge($accumulatedUsedIds, array_map('intval', $usedNodeIds))));
                        $broadcast(['kind' => 'trace', 'used' => array_values(array_map('intval', $usedNodeIds))]);
                    }
                    $replyText = $this->stripCitedNodeFooter($result['reply']);
                    $result['reply'] = $replyText;

                    $hasProposal = str_contains($replyText, '```action_proposal') || str_contains($replyText, '```json' . "\n" . '{' . "\n" . '  "action":');
                    $aiChat = \App\Models\AiChat::create([
                        'user_id' => $user->id,
                        'session_id' => $sessionId,
                        'role' => 'assistant',
                        'content' => $replyText,
                        'action_status' => $hasProposal ? 'pending' : null,
                    ]);

                    $result['message_id'] = (string)$aiChat->id;
                    $result['timestamp'] = $aiChat->created_at->format('H:i');

                    // Observability (item 12): persist what this run actually
                    // used — which neurons matched, which tools were called,
                    // token usage, latency and grounding citations — so a bad
                    // answer can be replayed and diagnosed instead of guessed.
                    try {
                        $this->recordAssistantRun(array_merge($run, [
                            'ai_chat_id' => (int)$aiChat->id,
                            'status' => 'success',
                            'latency_ms' => (int)round((microtime(true) - $startTime) * 1000),
                            'usage' => $result['usage'] ?? null,
                            'neurons_retrieved' => isset($neurons) ? array_column($neurons, 'id') : null,
                            'stages' => $accumulatedStages ?: null,
                            'used_ids' => $accumulatedUsedIds ?: null,
                            'tools_called' => $result['tools_called'] ?? null,
                            'citations' => collect($result['grounding']['sources'] ?? [])->values()->all(),
                            'retrieval_confidence' => $result['retrieval']['best_score'] ?? null,
                        ]));
                    } catch (\Throwable $e) {
                        \Illuminate\Support\Facades\Log::warning('AI run observability failed: ' . $e->getMessage());
                    }
                }

                // Token-budget context trimming (item 7): once a session has run
                // long enough that a large share of history is outside the
                // verbatim window, fold the older turns into the rolling
                // ai_summary. Summarization costs a Gemini round-trip, so it is
                // queued AFTER the reply has streamed — never blocking the user.
                try {
                    \App\Jobs\SummarizeAiSessionJob::dispatch($sessionId, $sessionSummary)
                        ->onConnection('deferred');
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('AI context summarization dispatch failed: ' . $e->getMessage());
                }

                // Touch session updated_at to keep recent sessions on top
                $session->touch();

                // Remember the per-session model preference when the client sent one
                if (!empty($requestedModel) && $session->ai_model !== $requestedModel) {
                    $session->update(['ai_model' => $requestedModel]);
                }

                $result['session_id'] = $sessionId;
                $result['session_title'] = $session->title;
                $result['neurons'] = $neurons;

                // Never ship the raw text (it may still hold temporary ```ai_memo
                // JSON) to the client — the visible `reply` is enough.
                unset($result['raw_reply']);

                $emit(['type' => 'done'] + $result);

                $broadcast([
                    'kind' => 'done',
                    'query' => mb_substr($userText, 0, 200),
                    'status' => 'success',
                    'latency_ms' => (int)round((microtime(true) - $startTime) * 1000),
                    'used' => $accumulatedUsedIds,
                ]);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::error('AI Chat Error: ' . $e->getMessage(), [
                    'exception' => $e
                ]);

                $emit([
                    'type' => 'error',
                    'success' => false,
                    'reply' => 'Maaf, sistem mengalami kendala: ' . $e->getMessage()
                ]);

                $broadcast([
                    'kind' => 'error',
                    'status' => 'error',
                    'query' => mb_substr($userText, 0, 200),
                    'message' => $e->getMessage(),
                ]);
            }
        };

        return response()->stream($stream, 200, [
            'Content-Type' => 'application/x-ndjson; charset=utf-8',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * Rename / update chat session title or custom training rules.
     */
    public function updateSession(Request $request, $id): JsonResponse
    {
        $request->validate([
            'title' => 'nullable|string|max:100',
            'custom_rules' => 'nullable|string|max:2000',
            'ai_model' => 'nullable|string|max:100',
        ]);

        $session = \App\Models\AiSession::where('user_id', $request->user()->id)->findOrFail($id);
        
        $updateData = [];
        if ($request->has('title')) {
            $updateData['title'] = trim($request->input('title'));
        }
        if ($request->has('custom_rules')) {
            $updateData['custom_rules'] = trim($request->input('custom_rules')) ?: null;
        }
        if ($request->has('ai_model')) {
            $updateData['ai_model'] = trim($request->input('ai_model')) ?: null;
        }

        if (!empty($updateData)) {
            $session->update($updateData);
        }

        return response()->json([
            'success' => true,
            'session' => $session,
            'message' => 'Chat session updated successfully.'
        ]);
    }

    /**
     * Delete a chat session.
     */
    public function deleteSession(Request $request, $id): JsonResponse
    {
        $session = \App\Models\AiSession::where('user_id', $request->user()->id)->findOrFail($id);
        $session->delete();

        return response()->json([
            'success' => true,
            'message' => 'Chat session deleted successfully.'
        ]);
    }

    /**
     * Lightweight AI Deal Summary for the checkout modal.
     * Runs deterministic integrity/anomaly checks server-side and asks Gemini
     * for upsell suggestions. NEVER includes or returns HPP/margin data.
     */
    public function checkoutSummary(Request $request): JsonResponse
    {
        $request->validate([
            'stock_id' => 'required|integer|exists:stocks,id',
            'price' => 'nullable|numeric|min:0',
            'buyer_phone' => 'nullable|string|max:30',
        ]);

        $stock = \App\Models\Stock::with(['brand', 'color', 'memory', 'license', 'store'])
            ->findOrFail($request->input('stock_id'));
        $price = (float)$request->input('price', $stock->sell_price);

        $checks = [];

        // 1. IMEI integrity
        $imei = (string)($stock->imei_1 ?? '');
        if ($imei === '') {
            $checks[] = ['type' => 'info', 'label' => 'IMEI', 'detail' => 'IMEI belum dicatat. Lengkapi untuk garansi & registrasi Bea Cukai.'];
        } elseif (preg_match('/^\d{15}$/', $imei)) {
            $checks[] = ['type' => 'ok', 'label' => 'IMEI', 'detail' => 'IMEI valid (15 digit).'];
        } else {
            $checks[] = ['type' => 'warn', 'label' => 'IMEI', 'detail' => "Format IMEI tidak standar 15 digit ('{$imei}'). Periksa untuk keperluan garansi & Bea Cukai."];
        }

        // 2. Serial number
        $serial = (string)($stock->serial_number ?? '');
        $checks[] = $serial === ''
            ? ['type' => 'info', 'label' => 'Serial', 'detail' => 'Serial number belum dicatat.']
            : ['type' => 'ok', 'label' => 'Serial', 'detail' => "Serial: {$serial}"];

        // 3. Repeat buyer (last 9 digits, formatting-agnostic)
        $phoneDigits = preg_replace('/\D/', '', $request->input('buyer_phone') ?? '');
        if ($phoneDigits !== '') {
            $last9 = substr($phoneDigits, -9);
            $priorCount = \App\Models\Sale::where('status', 'completed')
                ->whereHas('buyer', function ($q) use ($last9) {
                    $q->whereRaw('REPLACE(phone, "-", "") LIKE "%' . $last9 . '"');
                })
                ->count();

            $checks[] = $priorCount > 0
                ? ['type' => 'warn', 'label' => 'Repeat Buyer', 'detail' => "Nomor ini tercatat {$priorCount} transaksi sebelumnya. Cek nama & riwayat pelanggan (flag/loyalty)."]
                : ['type' => 'ok', 'label' => 'Customer', 'detail' => 'Nomor baru, belum ada riwayat transaksi.'];
        }

        // 4. Price anomaly vs same-model 90-day average sell price
        $modelIds = \App\Models\Stock::where('name', $stock->name)->pluck('id');
        $avgPrice = null;
        if ($modelIds->isNotEmpty()) {
            $avgPrice = \App\Models\SaleItem::whereIn('stock_id', $modelIds)
                ->whereHas('sale', function ($q) {
                    $q->where('status', 'completed')->where('created_at', '>=', now()->subDays(90));
                })
                ->where('actual_sell_price', '>', 0)
                ->avg('actual_sell_price');
        }

        if ($avgPrice) {
            $pct = round(($price / (float)$avgPrice) * 100);
            $fmtAvg = number_format($avgPrice, 0, ',', '.');
            $fmtPrice = number_format($price, 0, ',', '.');
            $checks[] = ($pct < 80 || $pct > 130)
                ? ['type' => 'warn', 'label' => 'Price Check', 'detail' => "Deal Rp {$fmtPrice} ≈ {$pct}% dari rata-rata model ini (Rp {$fmtAvg}). Pastikan deal memang disengaja."]
                : ['type' => 'ok', 'label' => 'Price Check', 'detail' => "Deal dalam rentang normal model ini (avg Rp {$fmtAvg})."];
        } else {
            $checks[] = ['type' => 'info', 'label' => 'Price Check', 'detail' => 'Belum ada data harga rata-rata untuk model ini.'];
        }

        // 5. AI upsell suggestions (marketing only, HPP never sent)
        $upsell = null;
        if ($this->geminiService->isEnabled() && $this->geminiService->isConfigured()) {
            try {
                $upsell = $this->geminiService->generateCheckoutUpsell($stock, $price);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Checkout upsell error: ' . $e->getMessage());
            }
        }

        return response()->json([
            'success' => true,
            'ai_enabled' => $upsell !== null,
            'checks' => $checks,
            'upsell' => $upsell,
        ]);
    }

    /**
     * Test API connection from Settings page.
     */
    public function testConnection(Request $request): JsonResponse
    {
        if ($request->user()->role !== 'superadmin') {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $testKey = $request->input('api_key');
        $testModel = $request->input('model');

        $res = $this->geminiService->testConnection($testKey, $testModel);

        return response()->json($res);
    }

    /**
     * Execute an AI action proposal approved by Superadmin.
     */
    public function executeAction(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized: Only Superadmin can execute AI actions.'
            ], 403);
        }

        $request->validate([
            'action' => 'required|string',
            'payload' => 'required|array',
            'session_id' => 'nullable|exists:ai_sessions,id',
            'message_id' => 'nullable',
        ]);

        $action = $request->input('action');
        $payload = $request->input('payload');
        $sessionId = $request->input('session_id');
        $messageId = $request->input('message_id');

        $result = $this->aiActionService->execute($action, $payload, $user, $sessionId ? (int) $sessionId : null);

        if ($result['success']) {
            // Update the proposal message status to 'executed' and save undo metadata if message_id provided
            if ($messageId && is_numeric($messageId)) {
                $updateFields = ['action_status' => 'executed'];
                if (!empty($result['undo'])) {
                    $updateFields['execution_data'] = $result['undo'];
                }

                \App\Models\AiChat::where('id', $messageId)
                    ->where('user_id', $user->id)
                    ->update($updateFields);
            }

            // If part of an active session, insert a system/assistant confirmation log
            if ($sessionId) {
                \App\Models\AiChat::create([
                    'user_id' => $user->id,
                    'session_id' => $sessionId,
                    'role' => 'assistant',
                    'content' => "✅ **Aksi Telah Berhasil Dieksekusi**\n\n" . $result['message'],
                ]);
            }
        }

        return response()->json($result);
    }

    /**
     * Undo a previously executed AI action.
     */
    public function undoAction(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            return response()->json(['success' => false, 'message' => 'Unauthorized.'], 403);
        }

        $request->validate([
            'message_id' => 'required|integer',
        ]);

        $messageId = $request->input('message_id');
        $chat = \App\Models\AiChat::where('id', $messageId)
            ->where('user_id', $user->id)
            ->first();

        if (!$chat) {
            return response()->json(['success' => false, 'message' => 'Message proposal not found.'], 404);
        }

        $undoData = $chat->execution_data;
        if (empty($undoData)) {
            return response()->json(['success' => false, 'message' => 'Tidak ada data rekaman untuk melakukan Undo pada aksi ini.'], 400);
        }

        $undoResult = $this->aiActionService->undoAction($undoData, $user);

        if ($undoResult['success']) {
            // Reset status back to pending so user can re-review or edit
            $chat->update([
                'action_status' => 'pending',
                'execution_data' => null,
            ]);

            if ($chat->session_id) {
                \App\Models\AiChat::create([
                    'user_id' => $user->id,
                    'session_id' => $chat->session_id,
                    'role' => 'assistant',
                    'content' => "↩️ **Aksi Telah Di-Undo (Dibatalkan)**\n\n" . $undoResult['message'],
                ]);
            }
        }

        return response()->json($undoResult);
    }

    /**
     * Update action proposal status (e.g. rejected or pending)
     */
    public function updateProposalStatus(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            return response()->json(['success' => false, 'message' => 'Unauthorized.'], 403);
        }

        $request->validate([
            'message_id' => 'required|integer',
            'status' => 'required|in:pending,rejected,executed',
        ]);

        $messageId = $request->input('message_id');
        $status = $request->input('status');

        $chat = \App\Models\AiChat::where('id', $messageId)
            ->where('user_id', $user->id)
            ->first();

        if ($chat) {
            $chat->update(['action_status' => $status]);
        }

        return response()->json(['success' => true, 'status' => $status]);
    }

    /**
     * Download a file generated by a run_python_script AI action.
     * Restricted to Superadmin (the only role that can generate them).
     */
    public function downloadGeneratedFile(Request $request, string $path): BinaryFileResponse
    {
        $user = $request->user();
        if ($user->role !== 'superadmin') {
            abort(403);
        }

        $base = realpath(storage_path('app/ai_generated'));
        $full = realpath(storage_path('app/ai_generated/' . $path));

        if ($base === false || $full === false) {
            abort(404);
        }
        if ($full !== $base && !str_starts_with($full, $base . DIRECTORY_SEPARATOR)) {
            abort(404);
        }
        if (!is_file($full)) {
            abort(404);
        }

        $mime = (function_exists('mime_content_type') ? mime_content_type($full) : false) ?: 'application/octet-stream';

        return response()->download($full, basename($full), ['Content-Type' => $mime]);
    }

    /**
     * Extract the node ids the AI cited as "Memori node yang dikonsultasi:
     * #12, #45" at the end of its reply. Any "#<id>" token at the tail of the
     * reply counts as a usage signal, so even free-form citations register.
     */
    protected function extractCitedNodeIds(string $text): array
    {
        $ids = [];

        if (preg_match('/(?:memori node)[^\n]*?:?\s*(.+)$/mi', $text, $m)) {
            foreach (preg_split('/[,\s#]+/', $m[1]) ?: [] as $part) {
                $v = (int)trim((string)$part);
                if ($v > 0) {
                    $ids[] = $v;
                }
            }
        }

        if ($ids === []) {
            preg_match_all('/#(\d+)/', mb_substr($text, -400), $m2);
            foreach ($m2[1] as $v) {
                $ids[] = (int)$v;
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * Persist one assistant execution for per-chat observability (item 12).
     * Fields that are not present are stored as null so partial runs still
     * leave a useful trace for later diagnosis.
     */
    protected function recordAssistantRun(array $data): void
    {
        $run = new \App\Models\AiAssistantRun([
            'user_id' => $data['user_id'] ?? null,
            'session_id' => $data['session_id'] ?? null,
            'ai_chat_id' => $data['ai_chat_id'] ?? null,
            'query' => $data['query'] ?? null,
            'model' => $data['model'] ?? null,
            'status' => $data['status'] ?? 'success',
            'latency_ms' => max(0, (int)($data['latency_ms'] ?? 0)),
            'error' => $data['error'] ?? null,
        ]);

        $usage = is_array($data['usage'] ?? null) ? $data['usage'] : [];
        $run->prompt_tokens = (int)($usage['prompt_tokens'] ?? 0);
        $run->completion_tokens = (int)($usage['completion_tokens'] ?? 0);
        $run->total_tokens = (int)($usage['total_tokens'] ?? 0);
$run->neurons_retrieved = $data['neurons_retrieved'] ?? null;
    $run->stages = $data['stages'] ?? null;
    $run->used_ids = $data['used_ids'] ?? null;
    $run->tools_called = $data['tools_called'] ?? null;
        $run->citations = $data['citations'] ?? null;
        $run->retrieval_confidence = $data['retrieval_confidence'] ?? null;

        $run->save();
    }

    /**
     * Feedback loop (item 3). When the last assistant message in this session is
     * a REJECTED proposal and the superadmin is now writing a corrective
     * instruction, extract the rejected proposal and the new instruction and
     * persist them as a 'validation' neuron — so next time a similar action is
     * proposed, semantic retrieval surfaces the rejection and the AI gets it
     * right without being told twice.
     */
    protected function learnFromProposalRejection(int $sessionId, string $userText, $user): void
    {
        $latest = \App\Models\AiChat::where('session_id', $sessionId)
            ->where('role', 'assistant')
            ->orderBy('id', 'desc')
            ->first();

        if (!$latest || $latest->action_status !== 'rejected' || (string)$latest->content === '') {
            return;
        }

        if (!preg_match('/```(?:action_proposal|json)?\s*(\{[\s\S]*?\})\s*```/', (string)$latest->content, $m)) {
            return;
        }

        $decoded = json_decode($m[1], true);
        if (!is_array($decoded)) {
            return;
        }

        $action = trim((string)($decoded['action'] ?? ''));
        $title = trim((string)($decoded['title'] ?? ''));
        if ($action === '') {
            return;
        }

        $instruction = mb_strimwidth(trim($userText), 0, 500, '…');
        $graph = app(\App\Services\AiMemoryGraphService::class);

        $content = "VALIDATION (PENOLAKAN PROPOSAL): Superadmin menolak proposal aksi '{$action}'"
            . ($title !== '' ? " ({$title})" : '')
            . " dengan instruksi revisi: \"{$instruction}\". Sebelum mengusulkan aksi '{$action}' lagi, pastikan proposal memenuhi instruksi tersebut.";

        if ($graph->isDuplicateContent($content)) {
            return;
        }

        \App\Models\AiTrainingNote::create([
            'user_id' => $user->id,
            'author_name' => 'System (proposal feedback)',
            'author_role' => 'superadmin',
            'content' => $content,
            'title' => $action . ' revision',
            'related_keywords' => ['proposal', 'rejection', 'validation', $action],
            'content_hash' => md5($content),
            'kind' => 'validation',
            'is_active' => true,
        ]);
    }

    /**
     * Remove the citation footer line from the reply before it is persisted /
     * shown, so telemetry metadata never leaks into the visible conversation.
     */
    protected function stripCitedNodeFooter(string $text): string
    {
        return trim((string) preg_replace('/(?:^|\n)\s*(?:Memori node yang dikonsultasi|Memory node[^\n]*consulted)[^\n]*/mi', '', $text));
    }

    /**
     * When the user asks about node/memory counts, return a factual one-line
     * notice built from the real database numbers (and remember them for the
     * guard). Returns '' for any other query so ordinary chats stay untouched.
     */
    protected function nodeStatsNotice(string $userText, $session): string
    {
        $q = mb_strtolower($userText);
        $isCountQuery = (bool) preg_match(
            '/\b(?:berapa|how\s+many|jumlah|count|banyaknya|total)\b.*\b(?:node|neuron|memor\w+)\b'
            . '|\b(?:node|neuron|memor\w+)\b.*\b(?:bertambah|ditambah|dibuat|tersimpan|tercatat|jumlah|count|total|ditulis|dibikin)\b',
            $q
        );
        $explicit = (bool) preg_match('/\b(?:nambah|tambah|buat|bikin)\b.*\b(?:node|neuron|memor\w+)\b.*\?*$/iu', $userText);

        if (!$isCountQuery && !$explicit) {
            return '';
        }

        $today = now()->toDateString();
        $stats = [
            'total' => (int)\App\Models\AiTrainingNote::count(),
            'active' => (int)\App\Models\AiTrainingNote::where('is_active', true)->count(),
            'today' => (int)\App\Models\AiTrainingNote::whereDate('created_at', $today)->count(),
            'since_session' => $session && $session->created_at
                ? (int)\App\Models\AiTrainingNote::where('created_at', '>=', $session->created_at)->count()
                : null,
        ];
        $this->nodeStatsForGuard = $stats;

        $parts = "total node = {$stats['total']}; node aktif = {$stats['active']}; node dibuat hari ini = {$stats['today']}";
        if ($stats['since_session'] !== null) {
            $parts .= "; node dibuat sejak sesi ini dimulai = {$stats['since_session']}";
        }

        return "NODE STATISTICS (FAKTUAL dari database — jawab pertanyaan jumlah node HANYA dari angka ini, JANGAN mengarang, JANGAN menyebut angka lain): {$parts}. Jika angka yang diminta tidak tersedia, katakan jujur kamu tidak bisa memastikannya.";
    }

    /**
     * Reconcile storage claims so the model's words stay truthful (honest
     * persistence). The model sometimes writes a confirmation in the visible
     * reply ("📝 Node baru: ...", "sudah tersimpan", "berhasil dicatat", ...)
     * without ever emitting a real ```ai_memo block — so persistTrainingMemos()
     * finds nothing to save and the claim would be a lie. Run BEFORE persisting:
     *
     * 1. If the raw reply already holds a parsable, content-bearing ```ai_memo
     *    block, the claim is backed by a real node → nothing to do.
     * 2. Otherwise try ONE deterministic reconstruction of the missed block,
     *    built from REAL FACTS — the named node from the claim marker, the
     *    user's own message(s), or a value the user just handed over — never
     *    from the model's acknowledgment wording ("NIM Dewi berhasil dicatat"),
     *    which would store the chat reply itself as if it were a memory.
     *    On success the block is appended to raw_reply so the subsequent
     *    persistTrainingMemos() call really stores the memory.
     * 3. If reconstruction yields nothing usable (ambiguous, duplicate or a DB
     *    error), rewrite the visible reply so the claim no longer deceives.
     *
     * When the system itself just ingested an attachment/URL into real nodes,
     * any "node baru" phrase in the reply refers to that genuine server-side
     * storage — reconciliation must not second-guess it.
     */
    protected function reconcileMemoClaims(array &$result, $user, string $userText, string $ingestNotice = '', string $priorUserText = ''): void
    {
        if (($result['success'] ?? true) === false) {
            return;
        }

        $visible = trim((string)($result['reply'] ?? ''));
        if ($visible === '') {
            return;
        }

        // A successful system ingest already created the nodes this reply talks
        // about, so a storage claim here is backed by the backend, not the model.
        if (str_contains($ingestNotice, 'SISTEM INGEST (FAKTUAL)')) {
            return;
        }

        $claim = $this->findStorageClaim($visible);
        if ($claim === null) {
            return;
        }

        // Already backed by a real, persistable memo block → the claim is honest.
        $rawReply = (string)($result['raw_reply'] ?? $visible);
        if ($this->hasPersistableMemo($rawReply)) {
            return;
        }

        // Invented node/memory counts ("4 node berhasil ditambahkan") can never
        // be honoured — there is no real subject to store. Neutralise straight
        // away instead of trying to reconstruct a memory from a bare number.
        if ($this->countIsFabricated($claim['sentence'] ?? (string)($claim['content'] ?? ''))) {
            $result['reply'] = $this->correctFalseClaim($visible);
            return;
        }

        // Reconstruct one ```ai_memo block from the claim's REAL subject:
        // never store the model's own acknowledgment as the memory content.
        $content = $this->reconstructClaimContent($claim, $userText, $priorUserText);
        if ($content === null || $content === '') {
            // Nothing factual to honour the claim with → stop the false claim.
            $result['reply'] = $this->correctFalseClaim($visible);
            return;
        }

        $payload = [
            'kind' => $this->claimKind($content),
            'title' => $this->shortClaimTitle($content),
            'related' => $this->relatedForClaim($userText, $content),
            'content' => $content,
        ];
        $payload = array_filter($payload, fn($v) => $v !== null && $v !== '' && $v !== []);

        if ($payload['content'] ?? '') {
            if ($this->persistMemo($payload, $user)) {
                // Saved for real; give the raw text the block it was missing so
                // the normal persistence path stays single-source-of-truth
                // (content_hash makes the follow-up persist a harmless no-op).
                $block = "\n\n```ai_memo\n" . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n```";
                $result['raw_reply'] = rtrim($rawReply) . $block;
                return;
            }
        }

        // Reconstruction or save failed → correct the lying claim instead of
        // shipping it (nothing factual could back the model's words).
        $result['reply'] = $this->correctFalseClaim($visible);
    }

    /**
     * True when the raw text contains at least one ```ai_memo block whose JSON
     * decodes and carries a non-empty content (exactly what persistMemo() would
     * actually store).
     */
    protected function hasPersistableMemo(string $text): bool
    {
        preg_match_all('/```ai_memo\s*([\s\S]*?)```/', $text, $matches);

        foreach ($matches[1] as $raw) {
            $decoded = json_decode(trim($raw), true);
            if (is_array($decoded) && trim((string)($decoded['content'] ?? '')) !== '') {
                return true;
            }
        }

        return false;
    }

    /**
     * Detect a positive first-person ("I saved this") storage claim in the
     * visible reply. Negated, hypothetical, suggestion-like sentences and
     * references to storage that happened earlier are ignored, so honest
     * statements about pre-existing or system-made nodes are left untouched.
     *
     * @return array{title: string, content: string, named: bool}|null
     */
    protected function findStorageClaim(string $text): ?array
    {
        $sentences = preg_split('/(?<=[.!?])\s+|\n+/u', trim($text)) ?: [trim($text)];
        $verbClaim = null;
        $countClaim = null;

        foreach ($sentences as $sentence) {
            $s = trim($sentence);
            if ($s === '') {
                continue;
            }

            // The visual confirmation marker — the system prompt only allows it
            // together with a real ```ai_memo block, so it is the strongest lie
            // and names the exact entity: prefer it over a vague verb claim.
            if (preg_match('/📝\s*node\s+baru\s*[:：\-]?\s*(.+?)$/iu', $s, $m)) {
                return $this->claimFrom($s, $m[1]) + ['named' => true];
            }

            $isPast = (bool) preg_match('/\b(?:sebelumnya|sebelum|pernah|sejak|sudah\s+tadi)\b/iu', $s);
            $isOpen = (bool) preg_match('/^\s*(?:apakah|berapa|kenapa|mengapa|bisakah|kapan|di\s+mana|where|why|when|how|tolong|mohon|silakan|silahkan)\b/iu', $s)
                || (bool) preg_match('/\b(?:jika|kalau|seandainya|sebaiknya|seharusnya)\b/iu', $s);
            if ($isPast || $isOpen) {
                continue;
            }

            // A count claim ("4 node berhasil ditambahkan", "sebanyak 3 node
            // tersimpan") is the exact hallucination pattern to kill: numbers
            // the model cannot possibly know unless backed by the database.
            if ($this->matchesNodeCountClaim($s)) {
                if ($this->countIsFabricated($s)) {
                    $countClaim = $countClaim ?? $s;
                    continue;
                }
                // The count matches real database statistics (the model was
                // handed NODE STATISTICS this request) → an honest statement,
                // so don't let the verb matcher below second-guess it either.
                continue;
            }

            // Positive completion ("berhasil/sudah/telah ... mencatat/menambah/
            // membuat") is a claim even when the same sentence carries negation
            // words, because "belum tersimpan ... yang berhasil ditambahkan" is
            // a contradiction, not an honest negative.
            if ($this->isPositiveCompletionClaim($s)
                || (!$this->isNegatedClaim($s) && $this->matchesStorageVerbClaim($s))) {
                $verbClaim = $verbClaim ?? $s;
            }
        }

        // An unverifiable node count beats a vague verb claim: it is the most
        // damaging fabrication and must be neutralised no matter what.
        if ($countClaim !== null) {
            return $this->claimFrom($countClaim, '') + ['named' => false];
        }

        return $verbClaim !== null ? $this->claimFrom($verbClaim, '') + ['named' => false] : null;
    }

    /**
     * Decide what a storage claim should actually persist. The model's
     * acknowledgment wording is never the memory — it only signals that a fact
     * was learned. Source material, in priority order:
     *
     * 1. The named node from the explicit "📝 Node baru: X" marker (a genuine
     *    fact the model wrote as the node itself).
     * 2. A clearly memory-worthy fact from the user's own current message.
     * 3. The same for the previous user message (what the claim just recorded).
     * 4. A lone value ("052870905") the user just handed over, paired with the
     *    label the claim attached to it ("NIM Dewi berhasil dicatat").
     *
     * Returns null when no real fact is recoverable, so the caller can correct
     * the false claim instead of polluting memory with chat reply text.
     *
     * @param array{title: string, content: string, named: bool} $claim
     */
    protected function reconstructClaimContent(array $claim, string $userText, string $priorUserText = ''): ?string
    {
        if (($claim['named'] ?? false) && trim((string)($claim['content'] ?? '')) !== '') {
            return $claim['content'];
        }

        foreach ([$userText, $priorUserText] as $text) {
            $fact = $this->extractUserFact((string)$text);
            if ($fact !== null && trim((string)($fact['content'] ?? '')) !== '') {
                return $fact['content'];
            }
        }

        $label = $this->claimLabel((string)($claim['content'] ?? ''));
        $value = $this->loneValue((string)$userText) ?: $this->loneValue((string)$priorUserText);
        if ($label !== null && $value !== null) {
            return $label . ': ' . $value;
        }

        return null;
    }

    /**
     * Short noun phrase a claim attached its value to: the words before the
     * storage verb ("NIM Dewi" in "NIM Dewi berhasil dicatat"). Requires at
     * least two meaningful words and rejects generic filler, so "Sekarang saya
     * perbarui…" style acknowledgments produce no label.
     */
    protected function claimLabel(string $sentence): ?string
    {
        $cut = preg_split(
            '/\s+(?:berhasil|sudah|telah|gagal|tersimp[ae]n|tercatat|di|ke|untuk|dengan|supaya|saya|kamu|sekarang|oke|mohon|maaf)\b/iu',
            $sentence,
            2
        )[0] ?? '';

        $label = trim((string) preg_replace('/[^0-9\p{L}\s]+/u', '', $cut));
        $label = trim((string) preg_replace('/\s+/u', ' ', $label));
        $words = preg_split('/\s+/u', $label) ?: [];

        if (count($words) < 2 || mb_strlen($label) < 4) {
            return null;
        }

        return mb_strimwidth(implode(' ', array_slice($words, 0, 5)), 0, 120, '');
    }

    /**
     * A bare value the user just typed (an ID, a code, a number) — one compact
     * token containing at least one digit. Used to honour claims like
     * "NIM Dewi berhasil dicatat" when the user simply sent "052870905".
     */
    protected function loneValue(string $text): ?string
    {
        $value = trim(trim((string)$text), " \t\n\r,.;:!?\"'");
        if ($value === '' || mb_strlen($value) < 4 || mb_strlen($value) > 30) {
            return null;
        }
        if (preg_match('/^[\p{L}\p{N}.\-:\/]+$/u', $value) && preg_match('/\d/', $value)) {
            return $value;
        }
        return null;
    }

    /**
     * The last user message BEFORE the current one, so reconciliation can mine
     * the fact a claim just acknowledged even when the current message isn't
     * the data itself.
     */
    protected function previousUserText(array $messagesForModel, string $currentUserText): string
    {
        $texts = [];
        foreach ($messagesForModel as $m) {
            if (($m['role'] ?? '') === 'user') {
                $texts[] = trim((string)($m['content'] ?? ''));
            }
        }

        for ($i = count($texts) - 1; $i >= 0; $i--) {
            if ($texts[$i] !== trim($currentUserText)) {
                return $texts[$i];
            }
        }

        return '';
    }

    /**
     * Compact first-person/perfected markers of "a memory was just saved".
     * No rigid phrase list — the model itself decides what deserves a node;
     * this only catches when it forgot to emit the block. Completions
     * ("berhasil menyimpan") are handled by isPositiveCompletionClaim();
     * this matcher covers the leftover first-person and state markers.
     */
    protected function matchesStorageVerbClaim(string $sentence): bool
    {
        return (bool) preg_match(
            '/\b(?:kucatat|kusimpan|kuingat|kurekam|kutambah|kubuat|kubikin)\b'
            . '|\b(?:tersimp[ae]n|tercatat|disimp[ae]n|terekam)\b'
            . '|\bnode\s+(?:baru|dibuat|ditambahkan|diproses|tersimpan|tercatat)\b'
            . '/iu',
            $sentence
        );
    }

    /**
     * An explicit completion marker ("berhasil / sudah / telah ... menyimpan /
     * mencatat / menambahkan / membuat") right before a storage verb. Detected
     * independently of surrounding negation so contradictory sentences like
     * "belum tersimpan ... yang berhasil ditambahkan" are still flagged.
     */
    protected function isPositiveCompletionClaim(string $sentence): bool
    {
        return (bool) preg_match(
            '/\b(?:berhasil|sudah|telah|sukses|baru\s+saja)\s+'
            . '(?:di|ter|ku|saya\s+)?(?:me|men|meng|mem)?'
            . '(?:catat|catet|simp[ae]n|ingat|rekam|tambah|buat|bikin|simpan|simpen|store|save|create|belajar|pelajari|learn)\w*\b'
            . '/iu',
            $sentence
        );
    }

    /**
     * A clearly negated storage sentence ("belum / tidak / gagal ..."). Honest
     * negatives are left alone; only positive completions above can override.
     */
    protected function isNegatedClaim(string $sentence): bool
    {
        return (bool) preg_match('/\b(?:belum|tidak|gagal|batal|jangan|bukan|tanpa|tak\s+(?:pernah|ada))\b/iu', $sentence);
    }

    /**
     * True when a sentence carries an invented node/Memory count ("4 node
     * berhasil ditambahkan", "sebanyak 3 node tersimpan") that cannot be
     * backed by any statistic the system handed it this request. Only fired
     * when the count coexists with storage/save context, so descriptive prose
     * ("saya merangkum dari 3 node") is never touched.
     */
    protected function matchesNodeCountClaim(string $sentence): bool
    {
        if (!preg_match(
            '/\b(?:berhasil|sudah|telah|sukses|baru\s+saja)\b'
            . '|tersimp|disimp|tercatat|terekam|bertambah|ditam?bah|dibuat|diproses'
            . '|\bnode\s+baru\b'
            . '/iu',
            $sentence
        )) {
            return false;
        }

        return $this->countCandidates($sentence) !== [];
    }

    /**
     * The literal numbers a count claim points at: adjacent to a node token
     * ("4 node") or reached through storage context just after it ("node
     * tersimpan = 11", "node yang berhasil ditambahkan sebanyak 4").
     */
    protected function countCandidates(string $sentence): array
    {
        $candidates = [];
        preg_match_all('/\b([0-9]+)\s*(?:node|neuron|memori|memory|catatan)\b/iu', $sentence, $m);
        foreach ($m[1] as $n) {
            if ($n !== '') {
                $candidates[(int)$n] = true;
            }
        }
        preg_match_all('/\b(?:node|neuron|memori|memory)\s+(?:yang\s+)?(?:berhasil|sudah|telah|sebanyak|ditambahkan|tersimpan|tercatat|dibuat|bertambah|ditambah|disimpan|diproses)?[^.\n\d]{0,14}([0-9]+)/iu', $sentence, $m2);
        foreach ($m2[1] as $n) {
            if ($n !== '') {
                $candidates[(int)$n] = true;
            }
        }

        return array_keys($candidates);
    }

    /**
     * A count claim is fabricated when none of its numbers match the real
     * database statistics for this request (or when no statistics were
     * handed to the model at all, so the number had no possible source).
     */
    protected function countIsFabricated(string $sentence): bool
    {
        $candidates = $this->countCandidates($sentence);
        if ($candidates === []) {
            return false;
        }

        $stats = $this->nodeStatsForGuard;
        if ($stats === null) {
            return true;
        }

        foreach ($candidates as $candidate) {
            foreach ($stats as $value) {
                if ($value !== null && (int)$value === $candidate) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Turn one claimed sentence into the memo payload seed: a short title and
     * the cleaned sentence as content. The claim's own wording is the source
     * material, so the reconstructed memory never invents facts.
     *
     * @return array{title: string, content: string}
     */
    protected function claimFrom(string $sentence, string $entity): array
    {
        $content = trim($entity !== '' ? $entity : $sentence);
        $content = trim((string) preg_replace('/^\s*>\s*/m', '', (string) trim((string) preg_replace('/[*_`#>]+/u', '', $content))));
        $content = rtrim($content, " \t\n\r,.;:!?");
        $content = trim((string) preg_replace('/\s+/u', ' ', $content));

        return [
            'sentence' => $sentence,
            'title' => $this->shortClaimTitle($entity !== '' ? $entity : $sentence),
            'content' => $content,
        ];
    }

    /**
     * Cap a reconstructed node title at ~5 words (the system-prompt rule for
     * ai_memo titles) while stripping markdown noise.
     */
    protected function shortClaimTitle(string $text): string
    {
        $clean = trim((string) preg_replace('/[*_`#>\[\]()]+/u', '', $text));
        $words = preg_split('/\s+/u', $clean) ?: [];

        return mb_strimwidth(implode(' ', array_slice($words, 0, 5)), 0, 120, '');
    }

    /**
     * Deterministic kind guess for a reconstructed memo: family-relation facts
     * become 'identity' nodes, everything else falls back to the safe 'note'.
     */
    protected function claimKind(string $content): string
    {
        return preg_match('/\b(?:adik|kakak|saudara|ibu|ayah|bapak|mama|papa|istri|suami|anak|kakek|nenek|paman|bibi|tante|keponakan|sepupu)\b/iu', $content)
            ? 'identity'
            : 'note';
    }

    /**
     * Small bounded set of related-keyword candidates for the reconstructed
     * memo, drawn from the claim sentence and the user's own message.
     */
    protected function relatedForClaim(string $userText, string $content): array
    {
        $stopwords = preg_split('/\s+/', strtolower(
            'yang dan atau untuk dengan dari pada ini itu ke di tidak ya sudah akan bisa lalu maka agar '
            . 'karena jika saya kamu kita node nodes memori memory baru tersimpan simpan catat ingat rekam '
            . 'berhasil silakan tolong mohon jangan lupa'
        )) ?: [];
        $stop = array_fill_keys($stopwords, true);

        $words = [];
        foreach ([$content, $userText] as $src) {
            foreach ((preg_split('/[^\p{L}\p{N}]+/u', strtolower($src)) ?: []) as $w) {
                if ($w === '' || mb_strlen($w) < 4 || isset($stop[$w])) {
                    continue;
                }
                $words[$w] = true;
            }
        }

        return array_slice(array_keys($words), 0, 4);
    }

    /**
     * Second runtime guard, placed right beside the reconciliation helpers:
     * when the model stays silent (no ```ai_memo block AND no visible storage
     * claim), there was previously no signal to save anything. The system now
     * deterministically scans the USER's message for a clearly memory-worthy
     * fact and persists it as a neuron node fully behind the scenes — no
     * announcement, no rewrite of the reply. Only runs when no persistable memo
     * exists, so it never fights the model's own writing.
     */
    protected function silentlyPersistUserFact(array &$result, $user, string $userText, string $priorUserText = ''): void
    {
        if (($result['success'] ?? true) === false) {
            return;
        }

        // The user's OWN words are always the source material — never the
        // model's summary — so nothing invented is ever persisted. Candidates
        // are tried in order: the current message, its command-stripped form
        // ("catat ya, ..."), and — when the user is only issuing a save/memory
        // command like "tambah ke node" — the fact they just stated in the
        // previous message, so explicit asks never dead-end with "gagal".
        $wantSave = $this->hasSaveIntent($userText);
        $candidates = [$userText];
        if ($wantSave) {
            $stripped = $this->stripSaveCommand($userText);
            if ($stripped !== '' && $stripped !== $userText) {
                $candidates[] = $stripped;
            }
            if (trim($priorUserText) !== '' && trim($priorUserText) !== trim($userText)) {
                $candidates[] = $priorUserText;
                $strippedPrior = $this->stripSaveCommand($priorUserText);
                if ($strippedPrior !== '' && $strippedPrior !== $priorUserText) {
                    $candidates[] = $strippedPrior;
                }
            }
        }

        $payload = null;
        foreach (array_values(array_unique(array_filter($candidates))) as $source) {
            $payload = $this->extractUserFact($source);
            if ($payload !== null) {
                break;
            }
        }

        // Still nothing and the user straight-up asked to save something:
        // fall back to the first clean declarative sentence — content comes
        // verbatim from the user, so it stays hallucination-free.
        if ($payload === null && $wantSave) {
            $candidate = null;
            foreach (array_values(array_unique(array_filter($candidates))) as $source) {
                $candidate = $this->declarativeFallback($source);
                if ($candidate !== null) {
                    break;
                }
            }
            if ($candidate === null) {
                return;
            }
            $payload = [
                'kind' => 'note',
                'title' => $this->shortClaimTitle($candidate),
                'related' => $this->relatedForClaim($candidate, $candidate),
                'content' => $candidate,
            ];
        }

        if ($payload === null) {
            return;
        }

        // persistMemo() dedupes by content_hash / semantic similarity, so only a
        // genuinely NEW neuron is created — repeated chats never spawn copies.
        if (!$this->persistMemo($payload, $user)) {
            return;
        }

        // Keep the persistence path single-source-of-truth: append the block the
        // raw text was missing so the follow-up persistTrainingMemos() call sees
        // it and turns into a harmless content_hash no-op.
        $block = "\n\n```ai_memo\n" . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n```";
        $current = (string)($result['raw_reply'] ?? $result['reply'] ?? '');
        $result['raw_reply'] = rtrim($current) . $block;
    }

    /**
     * True when the user's message is an explicit request to save / remember /
     * record something into AI memory ("catat ya", "simpan di memori",
     * "tambahkan ke node", "ingatkan saya", ...).
     */
    protected function hasSaveIntent(string $text): bool
    {
        return (bool) preg_match(
            '/\b(?:catat|catet|simpan|simpen|ingatkan|ingetin|ingat|rekam|hafal(?:kan)?|pelajari|pahami|tambah(?:kan)?|buat(?:kan)?|bikin|jadikan)\b/iu',
            $text
        ) || (bool) preg_match(
            '/(?:tambah(?:kan)?|simpan|simpen|catat|catet|ingatk?an|rekam|hafal(?:kan)?)[^.\n]{0,16}(?:node|memor[yì]|memory|catatan|ingatan|jaringan|neuron)/iu',
            $text
        );
    }

    /**
     * Peel leading request/command clauses off a save request so the actual
     * fact underneath shows through: "tolong catat ya eka rahayu adalah ibu
     * saya" -> "eka rahayu adalah ibu saya", "tambahkan ke node: ..." -> "...".
     */
    protected function stripSaveCommand(string $text): string
    {
        $t = trim($text);
        $peel = [
            '/^\s*(?:tolong|mohon|silakan|silahkan|bisakah|bolehkah|ya|dong|donk|deh|lah|aja|saja|ini|itu|nanti|minta|saya|aku|gue|gua)\b[^:]*?[:\-]\s*/iu',
            '/^\s*(?:tolong|mohon|silakan|silahkan|bisakah|bolehkah|ya|dong|donk|deh|lah|aja|saja|ini|itu|nanti|minta|saya|aku|gue|gua)\b/iu',
            '/^\s*(?:tambahkan|tambah\s+ke\b|simpan|simpen|catat|catet|ingatkan|ingetin|ingat|rekam|hafal(?:kan)?|buatkan|buatin|bikin|buatin\b|buat\b|jadikan|pelajari|pahami|belajar)\w*\b/iu',
            '/^\s*(?:ke|di|sebagai|jadi)\s+(?:node|memori|memory|catatan|ingatan|jaringan|neuron)\b/iu',
            '/^\s*[:\-|.,]\s*/u',
        ];

        $changed = true;
        while ($changed && $t !== '') {
            $changed = false;
            foreach ($peel as $re) {
                $next = trim((string) preg_replace($re, '', $t));
                if ($next !== $t) {
                    $t = $next;
                    $changed = true;
                    break;
                }
            }
        }

        $t = trim((string) preg_replace(
            '/\s+(?:ya|dong|donk|deh|lah|aja|saja|ga\??|gak\??|ngga\??|tidak|nggak)\s*$/iu',
            '',
            $t
        ));
        return trim($t, " \t\n\r,.;:!?()[]-");
    }

    /**
     * Pick the first clean, single declarative sentence from a save request —
     * verbatim user wording, so the fallback cannot hallucinate. Returns null
     * for questions, commands, negations, URLs, filler and multi-sentence text.
     */
    protected function declarativeFallback(string $text): ?string
    {
        $text = trim($text);
        if ($text === '' || mb_strlen($text) > 400) {
            return null;
        }

        $lines = preg_split('/\n+/u', $text) ?: [trim($text)];
        $sentence = trim((string)($lines[0] ?? ''));
        $sentence = trim((string) preg_replace('/\s+/u', ' ', $sentence));
        $len = mb_strlen($sentence);

        if ($len < 6 || $len > 240) {
            return null;
        }

        // Filler / acknowledgment only — nothing worth a node.
        if (preg_match('/^(?:ok+ay?|ok|ya|yup|yap|baik|siap|tentu|paham|nyimak|wkwk|hehe|haha|done|setuju|iy[ae]?)[.,!?\s]*$/iu', $sentence)) {
            return null;
        }

        // A sentence made up solely of discourse filler ("nanti saja dulu ya")
        // still carries nothing to remember.
        $fillerWords = ['nanti', 'dulu', 'saja', 'aja', 'tolong', 'mohon', 'dong', 'donk', 'deh', 'lah', 'ya', 'yay', 'ok', 'oke', 'baik', 'siap', 'tentu', 'paham', 'gak', 'nggak', 'tidak', 'yup', 'setuju', 'iya', 'kalau', 'saya', 'aku', 'gue', 'gua', 'cek', 'coba', 'mau'];
        $words = preg_split('/\s+/u', strtolower(trim((string) preg_replace('/[^a-z0-9\s]+/iu', ' ', $sentence)))) ?: [];
        $meaningful = array_filter($words, fn($w) => mb_strlen($w) > 2 && !in_array($w, $fillerWords, true));
        if (count($meaningful) < 2) {
            return null;
        }

        // Not a fact: questions, commands, negations, URLs or multi-sentence.
        if (str_contains($sentence, '?')
            || preg_match('/https?:\/\//iu', $sentence)
            || preg_match('/\b(?:apakah|kenapa|mengapa|bagaimana|kapan|di\s+mana|yang\s+mana|tolong|mohon|bis[ae]kah|bolehkah|jangan)\b/iu', $sentence)
            || preg_match('/\b(?:belum|tidak|nggak|enggak|bukan|kurang)\b/iu', $sentence)
            || preg_match('/[.!]\s+\S/iu', $sentence)) {
            return null;
        }

        $content = trim((string) preg_replace('/[*_`#>]+/u', '', $sentence));
        $content = rtrim($content, " \t\n\r,.;:!?");
        if ($content === '' || mb_strlen($content) < 4) {
            return null;
        }

        // Must carry at least two meaningful words — "oke", "nanti" alone
        // shouldn't become a node even under an explicit save request.
        $words = preg_split('/\s+/u', $content) ?: [];
        $significant = array_filter($words, fn($w) => mb_strlen($w) > 2);
        if (count($significant) < 2) {
            return null;
        }

        return $content;
    }

    /**
     * Deterministically extract ONE clearly memory-worthy fact from the user's
     * message, if any. No LLM cost and no invented facts — the user's own wording
     * is the source material. Returns a seed for persistMemo() ({kind, title,
     * related, content}) or null when the message carries nothing worth a node.
     *
     * Priority rules, ordered so the stronger signal wins first:
     *  - family-relation facts (kin + bernama/punya/...) become 'identity'
     *    nodes, mirroring claimKind().
     *  - first-person/named-person likes ("dewi suka badminton") become
     *    'preference' nodes.
     * Questions, commands, negations, URLs, attachment-only messages and
     * multi-sentence rambles are never extracted.
     */
    protected function extractUserFact(string $userText): ?array
    {
        $text = trim($userText);
        if ($text === '' || mb_strlen($text) > 1000
            || preg_match('/https?:\/\//iu', $text)
            || preg_match('/^📎\s/u', $text)) {
            return null;
        }

        $sentences = preg_split('/(?<=[.!?])\s+|\n+/u', $text) ?: [trim($text)];

        foreach ($sentences as $sentence) {
            $s = trim((string)$sentence);
            $len = mb_strlen($s);
            if ($s === '' || $len < 6 || $len > 240) {
                continue;
            }

            // Not a fact: questions, commands or negated / hypothetical phrasing.
            if (str_contains($s, '?')
                || preg_match('/\b(?:apakah|kenapa|mengapa|bagaimana|kapan|di\s+mana|yang\s+mana)\b/iu', $s)
                || preg_match('/\b(?:tolong|mohon|bis[ae]kah|bolehkah|jangan)\b/iu', $s)
                || preg_match('/\b(?:belum|tidak|nggak|enggak|kurang|bukan)\b/iu', $s)) {
                continue;
            }

            $content = trim((string) preg_replace('/[*_`#>]+/u', '', $s));
            $content = trim((string) preg_replace('/^\s*>\s*/m', '', $content));
            $content = trim((string) preg_replace('/\s+/u', ' ', $content));
            $content = rtrim($content, " \t\n\r,.;:!?");
            if ($content === '' || mb_strlen($content) < 4) {
                continue;
            }

            if (preg_match('/\b(?:(?:adikku|kakakku|saudaraku|ibuku|ayahku|bapakku|mamaku|papaku|istriku|suamiku|anakku|kakekku|nenekku|pamanku|bibiku|tenteku|keponakanku|sepupuku)|(?:adik|kakak|saudara|ibu|ayah|bapak|mama|papa|istri|suami|anak|kakek|nenek|paman|bibi|tante|keponakan|sepupu))\b/iu', $s)
                && (preg_match('/\b(?:bernama|namanya|punya|mempunyai)\b/iu', $s)
                    // Copula form: "Eka Rahayu adalah ibu saya" / "Bapak
                    // merupakan ayahku" — requires the speaker marker so a
                    // generic "ibu adalah orang yang..." is never captured.
                    || (preg_match('/\b(?:adalah|merupakan)\b/iu', $s) && preg_match('/\b(?:saya|aku|gue|gua)\b/iu', $s)))) {
                // Family relation → 'identity' node (same taxonomy as claimKind).
                return [
                    'kind' => 'identity',
                    'title' => $this->shortClaimTitle($content),
                    'related' => $this->relatedForClaim($s, $s),
                    'content' => $content,
                ];
            }

            // "(aku|dewi|…) suka/senang/gemar <object>" → 'preference' node.
            if (preg_match('/^(?:(?:aku|saya|gue|gua|dewi|dia|kamu|beliau)\s+)?(?:paling\s+suka|suka|gemar|senang)(?:\s+(?:banget|sekali|sangat))?\s+(.+)$/iu', $s, $m)) {
                $object = trim($m[1], " \t\n\r,.;:!?");
                if ($object !== '' && mb_strlen($object) <= 120) {
                    return [
                        'kind' => 'preference',
                        'title' => $this->shortClaimTitle($content),
                        'related' => $this->relatedForClaim($s, $s),
                        'content' => $content,
                    ];
                }
            }
        }

        return null;
    }

    /**
     * Neutralise the storage-claim phrases in a reply so the user is told the
     * truth when the memory could not be saved.
     */
    protected function correctFalseClaim(string $visible): string
    {
        $replacements = [
            // Ordered so earlier insertions never get re-matched later: the
            // broad "tersimpan/tercatat" rewrite runs last.
            '/📝\s*node\s+baru\s*[:：\-]?[^\n]*/iu' => 'gagal menyimpan catatan ke node memori',
            '/\b(?:kucatat|kusimpan|kuingat|kurekam|kutambah|kubuat|kubikin)\b/iu' => 'tidak sempat menyimpan',
            // Invented counts: "4 node berhasil ditambahkan" → neutralize the
            // whole number the model could not possibly know.
            '/\b[0-9]+\s*(?:node|neuron|memori|memory|catatan)\b/iu' => 'jumlah node tidak dapat dipastikan',
            '/\b(?:node|neuron|memori|memory)\s*(?:berhasil|sudah|telah|sebanyak|ditambahkan|tersimpan|tercatat|dibuat|bertambah|ditambah|disimpan)\s*(?:sebanyak\s*)?[0-9]+/iu' => 'node tidak dapat dipastikan jumlahnya',
            '/\b(?:berhasil|sudah|telah|sukses)\s+(?:di|ter|ku|saya\s+)?(?:me|men|meng|mem)?(?:catat|catet|simp[ae]n|ingat|rekam|tambah|buat|bikin|simpan|simpen|store|save|create|belajar|pelajari|learn)\w*\b/iu' => 'gagal disimpan',
            '/\bnode\s+(?:baru|dibuat|ditambahkan|diproses|tersimpan|tercatat)\b/iu' => 'node gagal dibuat',
            '/\b(?:tersimp[ae]n|tercatat|disimp[ae]n|terekam)\b/iu' => 'belum tersimpan',
        ];

        $corrected = trim((string) preg_replace(array_keys($replacements), array_values($replacements), $visible));
        $corrected = preg_replace('/\n{3,}/', "\n\n", $corrected) ?: $corrected;

        if (!preg_match('/\b(?:gagal|tidak berhasil|belum tersimpan|tidak sempat|tidak dapat dipastikan)\b/i', $corrected)) {
            $corrected = trim($corrected) . "\n\n> Sistem tidak berhasil menyimpan memori tersebut ke jaringan neuron. Mohon ulangi permintaan bila masih ingin mencatatnya.";
        }

        return trim((string) $corrected);
    }

    /**
     * Resolve the episode date from a memo payload ("occurred_at" / "when").
     * Accepts ISO dates ("2026-09-18"), full datetimes and "now"; anything
     * unparseable quietly becomes null so a sloppy model tag never breaks a
     * save. Relative words ("kemarin", "lusa") are NOT resolved here on
     * purpose — the model is told today's date and is expected to convert
     * them itself while writing the memo.
     */
    protected function episodeDate(array $decoded): ?\Illuminate\Support\Carbon
    {
        $raw = trim((string)($decoded['occurred_at'] ?? $decoded['when'] ?? ''));
        if ($raw === '') {
            return null;
        }

        if (strtolower($raw) === 'now' || strtolower($raw) === 'sekarang') {
            return now();
        }

        try {
            return \Illuminate\Support\Carbon::parse($raw);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Normalize one episode label (place or person) to a bounded string, or
     * null when it carries nothing (or is a sloppy punctuation fragment).
     */
    protected function episodeLabel($value): ?string
    {
        $label = trim((string)$value);
        $label = trim($label, " \t\n\r.,;:!?\"'—-");
        $label = (string)preg_replace('/\s+/u', ' ', $label);

        if ($label === '' || mb_strlen($label) < 2 || mb_strlen($label) > 120) {
            return null;
        }

        return mb_substr($label, 0, 120);
    }

    /**
     * Extract and persist AI-written training memos from a reply.
     * Kind 'rule' is preserved only when the author is superadmin;
     * everyone else's notes are stored as 'knowledge'.
     */
    protected function persistTrainingMemos(string $reply, $user): int
    {
        preg_match_all('/```ai_memo\s*([\s\S]*?)```/', $reply, $matches);

        if (empty($matches[1])) {
            return 0;
        }

        $saved = 0;
        foreach ($matches[1] as $raw) {
            $decoded = json_decode(trim($raw), true);
            if ($this->persistMemo(is_array($decoded) ? $decoded : [], $user)) {
                $saved++;
            }
        }

        return $saved;
    }

    /**
     * Persist one decoded ```ai_memo payload as a new neuron node.
     * Returns true only when a brand-new node was actually created
     * (invalid, empty, privileged-kind or duplicate payloads return false).
     *
     * The AI picks the node kind from its own brain taxonomy (rule,
     * validation, condition, emotions, memory, preference, ...). Anything
     * outside the known kinds is safely normalized to the generic 'note',
     * and behavioral 'rule' nodes are reserved for superadmin authors.
     */
    protected function persistMemo(array $decoded, $user): bool
    {
        $content = trim((string)($decoded['content'] ?? ''));
        if (!is_array($decoded) || $content === '') {
            return false;
        }

        $graph = app(\App\Services\AiMemoryGraphService::class);
        $kind = $graph->normalizeKind($decoded['kind'] ?? null);
        if ($kind === 'rule' && $user->role !== 'superadmin') {
            $kind = 'note';
        }

        // The AI may also propose a short node label and the related
        // keywords that define where this memory plugs into the neuron map.
        $title = trim((string)($decoded['title'] ?? ''));
        $title = $title === '' ? null : mb_substr($title, 0, 200);
        $related = array_values(array_unique(array_filter(array_map(function ($r) {
            return strtolower(trim((string)$r));
        }, (array)($decoded['related'] ?? [])), fn($r) => $r !== '')));
        $related = array_slice($related, 0, 8);

        // Episode frame (item: situational memory): the AI can tag a memory with
        // when / where / with-whom, turning text into an episodic record that
        // retrieval can later seed from context ("lusa", "di Juanda", a name).
        $occurredAt = $this->episodeDate($decoded);
        $occurredPlace = $this->episodeLabel($decoded['occurred_place'] ?? $decoded['where'] ?? null);
        $involvedWith = $this->episodeLabel($decoded['involved_with'] ?? $decoded['who'] ?? null);

        // Real experience memories without an explicit date happened "in the
        // telling" — pin them to now so they are retrievable by time context.
        if ($occurredAt === null && $kind === 'memory') {
            $occurredAt = now();
        }

        $hash = md5($content);
        if (\App\Models\AiTrainingNote::where('content_hash', $hash)->exists()
            || $graph->isDuplicateContent($content)) {
            return false;
        }

        try {
            \App\Models\AiTrainingNote::create([
                'user_id' => $user->id,
                'author_name' => $user->name,
                'author_role' => $user->role,
                'content' => $content,
                'title' => $title,
                'related_keywords' => $related === [] ? null : $related,
                'content_hash' => $hash,
                'kind' => $kind,
                'is_active' => true,
                'occurred_at' => $occurredAt,
                'occurred_place' => $occurredPlace,
                'involved_with' => $involvedWith,
            ]);
            $this->nodesSavedThisRun++;
            return true;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Failed to persist AI training memo: ' . $e->getMessage());
            return false;
        }
    }

    }
