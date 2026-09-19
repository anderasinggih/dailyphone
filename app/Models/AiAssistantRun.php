<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAssistantRun extends Model
{
    protected $table = 'ai_assistant_runs';

    protected $fillable = [
        'user_id',
        'session_id',
        'ai_chat_id',
        'query',
        'model',
        'status',
        'latency_ms',
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
        'neurons_retrieved',
        'tools_called',
        'citations',
        'retrieval_confidence',
        'error',
    ];

    protected $casts = [
        'latency_ms' => 'integer',
        'prompt_tokens' => 'integer',
        'completion_tokens' => 'integer',
        'total_tokens' => 'integer',
        'neurons_retrieved' => 'array',
        'tools_called' => 'array',
        'citations' => 'array',
        'retrieval_confidence' => 'float',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AiSession::class, 'session_id');
    }
}