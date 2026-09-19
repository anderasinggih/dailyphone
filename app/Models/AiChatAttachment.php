<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiChatAttachment extends Model
{
    protected $fillable = [
        'user_id',
        'session_id',
        'ai_chat_id',
        'original_name',
        'mime_type',
        'size_bytes',
        'kind',
        'storage_path',
        'extracted_text',
        'content_hash',
    ];

    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AiSession::class, 'session_id');
    }
}