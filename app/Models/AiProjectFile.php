<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiProjectFile extends Model
{
    protected $fillable = [
        'user_id',
        'project_id',
        'parent_id',
        'name',
        'is_folder',
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
            'is_folder' => 'boolean',
            'size_bytes' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(AiProject::class, 'project_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(AiProjectFile::class, 'parent_id');
    }

    public function children(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(AiProjectFile::class, 'parent_id')->orderBy('is_folder', 'desc')->orderBy('name', 'asc');
    }
}