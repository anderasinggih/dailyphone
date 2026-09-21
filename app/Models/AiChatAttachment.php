<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

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

    /**
     * Delete a batch of attachments together with their stored blobs.
     * Used whenever the owning session, chat or project disappears, since
     * ai_chat_attachments has no FK that could cascade the rows (let alone
     * the files on disk).
     */
    public static function deleteBatchWithBlobs(iterable $attachments): int
    {
        $count = 0;
        foreach ($attachments as $attachment) {
            if ($attachment->storage_path) {
                Storage::disk('local')->delete($attachment->storage_path);
            }
            $attachment->delete();
            $count++;
        }

        return $count;
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AiSession::class, 'session_id');
    }

    public function chat(): BelongsTo
    {
        return $this->belongsTo(AiChat::class, 'ai_chat_id');
    }
}
