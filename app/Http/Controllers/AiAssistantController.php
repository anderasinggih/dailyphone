<?php

namespace App\Http\Controllers;

use App\Services\GeminiAssistantService;
use App\Services\AiActionService;
use App\Models\GeneralSetting;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Http\JsonResponse;

class AiAssistantController extends Controller
{
    protected GeminiAssistantService $geminiService;
    protected AiActionService $aiActionService;

    public function __construct(GeminiAssistantService $geminiService, AiActionService $aiActionService)
    {
        $this->geminiService = $geminiService;
        $this->aiActionService = $aiActionService;
    }

    /**
     * Render the Assistant chat page with sessions list and active session.
     */
    public function index(Request $request): Response
    {
        $settings = GeneralSetting::first();
        $isConfigured = $this->geminiService->isConfigured();
        $isEnabled = $this->geminiService->isEnabled();
        $model = $this->geminiService->getModel();
        $user = $request->user();

        // 1. Fetch user's chat sessions
        $sessions = \App\Models\AiSession::where('user_id', $user->id)
            ->orderBy('updated_at', 'desc')
            ->get(['id', 'title', 'custom_rules', 'created_at', 'updated_at']);

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
            'sessions' => $sessions,
            'activeSessionId' => $activeSession ? $activeSession->id : null,
            'initialMessages' => $messages,
        ]);
    }

    /**
     * Create a new chat session.
     */
    public function createSession(Request $request): JsonResponse
    {
        $session = \App\Models\AiSession::create([
            'user_id' => $request->user()->id,
            'title' => 'New Chat',
        ]);

        return response()->json([
            'success' => true,
            'session' => $session,
        ]);
    }

    /**
     * Process user chat message within a session and remember context.
     */
    public function chat(Request $request): JsonResponse
    {
        $request->validate([
            'message' => 'required|string',
            'session_id' => 'nullable|exists:ai_sessions,id',
        ]);

        if (!$this->geminiService->isEnabled()) {
            return response()->json([
                'success' => false,
                'reply' => 'AI Assistant is currently disabled in system settings.'
            ], 403);
        }

        $user = $request->user();
        $userText = trim($request->input('message'));
        $sessionId = $request->input('session_id');

        // If no session provided, find or create one
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

        // 2. Fetch recent conversation memory for THIS SESSION ONLY (last 10 messages)
        $recentChats = \App\Models\AiChat::where('session_id', $sessionId)
            ->orderBy('id', 'desc')
            ->limit(10)
            ->get()
            ->reverse()
            ->values();

        $messagesForModel = $recentChats->map(function ($c) {
            return [
                'role' => $c->role,
                'content' => $c->content,
            ];
        })->toArray();

        // 3. Send to Gemini with full session memory & custom session rules/training
        $result = $this->geminiService->chat($messagesForModel, $user, $session->custom_rules);

        // 4. Save AI reply to database in this session
        if (!empty($result['reply'])) {
            $aiChat = \App\Models\AiChat::create([
                'user_id' => $user->id,
                'session_id' => $sessionId,
                'role' => 'assistant',
                'content' => $result['reply'],
            ]);

            $result['message_id'] = (string)$aiChat->id;
            $result['timestamp'] = $aiChat->created_at->format('H:i');
        }

        // Touch session updated_at to keep recent sessions on top
        $session->touch();

        $result['session_id'] = $sessionId;
        $result['session_title'] = $session->title;

        return response()->json($result);
    }

    /**
     * Rename / update chat session title or custom training rules.
     */
    public function updateSession(Request $request, $id): JsonResponse
    {
        $request->validate([
            'title' => 'nullable|string|max:100',
            'custom_rules' => 'nullable|string|max:2000',
        ]);

        $session = \App\Models\AiSession::where('user_id', $request->user()->id)->findOrFail($id);
        
        $updateData = [];
        if ($request->has('title')) {
            $updateData['title'] = trim($request->input('title'));
        }
        if ($request->has('custom_rules')) {
            $updateData['custom_rules'] = trim($request->input('custom_rules')) ?: null;
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
     * Test API connection from Settings page.
     */
    public function testConnection(Request $request): JsonResponse
    {
        if ($request->user()->role !== 'superadmin') {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $testKey = $request->input('api_key');
        $testModel = $request->input('model', 'gemini-2.0-flash');

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

        $result = $this->aiActionService->execute($action, $payload, $user);

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
}
