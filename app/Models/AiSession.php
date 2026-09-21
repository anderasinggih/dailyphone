<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Log;

class AiSession extends Model
{
    protected $fillable = [
        'user_id',
        'project_id',
        'title',
        'custom_rules',
        'ai_summary',
        'ai_model',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(AiProject::class, 'project_id');
    }

    public function chats(): HasMany
    {
        return $this->hasMany(AiChat::class, 'session_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(AiChatAttachment::class, 'session_id');
    }

    protected static function booted(): void
    {
        // ai_chat_attachments shares no FK with sessions (and blobs live on
        // disk), so a deleted session would leak both rows and files under
        // ai-uploads/. Drop them explicitly before the DB cascade removes the
        // chats.
        static::deleting(function (AiSession $session) {
            try {
                AiChatAttachment::deleteBatchWithBlobs($session->attachments()->get());
            } catch (\Throwable $e) {
                Log::warning('Failed to clean up chat attachments: '.$e->getMessage());
            }
        });
    }
}
