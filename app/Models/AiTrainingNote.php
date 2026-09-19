<?php

namespace App\Models;

use App\Services\AiMemoryGraphService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AiTrainingNote extends Model
{
    protected $fillable = [
        'user_id',
        'author_name',
        'author_role',
        'content',
        'title',
        'related_keywords',
        'content_hash',
        'kind',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'related_keywords' => 'array',
    ];

    protected static function booted(): void
    {
        // Every freshly saved memory automatically becomes a node in the neural
        // graph and connects itself to the most related existing notes. This
        // keeps the memory unlimited and fully relational, no matter which
        // code path created the note (chat memo, manual entry, auto-learn).
        static::created(function (AiTrainingNote $note) {
            try {
                app(AiMemoryGraphService::class)->linkNewNote($note, $note->related_keywords ?? []);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Failed to auto-link training note: ' . $e->getMessage());
            }
        });

        // Removing a node severs every relation that points to it, keeping the
        // neuron map free of dangling edges.
        static::deleted(function (AiTrainingNote $note) {
            try {
                app(AiMemoryGraphService::class)->pruneLinksFor((int)$note->id);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Failed to prune training note links: ' . $e->getMessage());
            }
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function links(): HasMany
    {
        return $this->hasMany(AiTrainingNoteLink::class, 'note_id');
    }
}