<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiTrainingNoteLink extends Model
{
    protected $fillable = [
        'note_id',
        'linked_note_id',
        'label',
    ];

    public function note(): BelongsTo
    {
        return $this->belongsTo(AiTrainingNote::class, 'note_id');
    }

    public function linkedNote(): BelongsTo
    {
        return $this->belongsTo(AiTrainingNote::class, 'linked_note_id');
    }

    public function getOtherId(int $selfId): int
    {
        return $this->note_id === $selfId ? $this->linked_note_id : $this->note_id;
    }
}