<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class AiProject extends Model
{
    protected $fillable = [
        'user_id',
        'title',
        'description',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(AiSession::class, 'project_id')->orderBy('updated_at', 'desc');
    }

    public function files(): HasMany
    {
        return $this->hasMany(AiProjectFile::class, 'project_id');
    }

    protected static function booted(): void
    {
        // DB cascades the project's session/chat/file ROWS, but the project
        // file blobs live on disk and chat attachments share no FK. Remove the
        // on-disk copies here so deleting a project never leaks files under
        // ai-projects/ or ai-uploads/.
        static::deleting(function (AiProject $project) {
            try {
                $paths = $project->files()
                    ->where('is_folder', false)
                    ->whereNotNull('storage_path')
                    ->pluck('storage_path')
                    ->all();

                if ($paths) {
                    Storage::disk('local')->delete($paths);
                }

                foreach ($project->sessions as $session) {
                    AiChatAttachment::deleteBatchWithBlobs($session->attachments()->get());
                }
            } catch (\Throwable $e) {
                Log::warning('Failed to clean up project files: '.$e->getMessage());
            }
        });
    }
}
