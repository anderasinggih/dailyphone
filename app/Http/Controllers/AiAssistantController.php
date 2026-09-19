<?php

namespace App\Http\Controllers;

use App\Services\GeminiAssistantService;
use App\Services\AiActionService;
use App\Models\GeneralSetting;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

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
            ->get(['id', 'title', 'custom_rules', 'ai_model', 'created_at', 'updated_at']);

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
     * Streams newline-delimited JSON progress events so the Assistant UI can
     * render "accessing neurons" live while the model is thinking.
     */
    public function chat(Request $request): JsonResponse|StreamedResponse
    {
        $request->validate([
            'message' => 'required_without:attachments|string',
            'session_id' => 'nullable|exists:ai_sessions,id',
            'attachments' => 'nullable|array',
            'attachments.*' => 'integer',
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

        $attachments = \App\Models\AiChatAttachment::where('user_id', $user->id)
            ->whereIn('id', $attachmentIds)
            ->get();

        if ($userText === '' && $attachments->isNotEmpty()) {
            $userText = '📎 ' . $attachments->pluck('original_name')->join(', ');
        }

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

        $stream = function () use ($userText, $user, $session, $sessionId, $messagesForModel, $attachments, $requestedModel) {
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

                $network = $this->geminiService->resolveNeuronNetwork($userText);
                $neurons = $network['nodes'];
                $emit(['type' => 'neurons', 'nodes' => $network['nodes'], 'edges' => $network['edges']]);

                // 3. Send to Gemini with full session memory & custom session rules/training
                $result = $this->geminiService->chat($messagesForModel, $user, $session->custom_rules, $userText, $attachments,
                    function (string $delta) use ($emit) {
                        $emit(['type' => 'chunk', 'text' => $delta]);
                    },
                    $ingestNotice,
                    $requestedModel
                );

                // 4. Save AI reply to database in this session
                if (!empty($result['reply'])) {
                    // Persist any training memos the AI wrote. The visible reply
                    // is already stripped client-side; the RAW text (which still
                    // contains the ```ai_memo blocks) is what we inspect here.
                    $rawReply = $result['raw_reply'] ?? $result['reply'];
                    $this->persistTrainingMemos($rawReply, $user);

                    // The AI cites which neuron nodes it actually consulted in a
                    // trailing metadata line (see the system prompt). Record that
                    // usage signal, then strip the line from the text the user
                    // sees / the session stores so it never leaks to the UI.
                    $usedNodeIds = $this->extractCitedNodeIds($result['reply']);
                    if ($usedNodeIds !== []) {
                        app(\App\Services\AiMemoryGraphService::class)->registerUsage($usedNodeIds);
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
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::error('AI Chat Error: ' . $e->getMessage(), [
                    'exception' => $e
                ]);

                $emit([
                    'type' => 'error',
                    'success' => false,
                    'reply' => 'Maaf, sistem mengalami kendala: ' . $e->getMessage()
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
     * Remove the citation footer line from the reply before it is persisted /
     * shown, so telemetry metadata never leaks into the visible conversation.
     */
    protected function stripCitedNodeFooter(string $text): string
    {
        return trim((string) preg_replace('/(?:^|\n)\s*(?:Memori node yang dikonsultasi|Memory node[^\n]*consulted)[^\n]*/mi', '', $text));
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
            ]);
            return true;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Failed to persist AI training memo: ' . $e->getMessage());
            return false;
        }
    }

    }
