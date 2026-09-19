<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One golden-dataset evaluation run (item 6). A weekly `ai:evaluate` command
 * scores the assistant against a set of known Q&A pairs and stores the result
 * here so accuracy can be tracked across model & retrieval changes instead of
 * being guessed at.
 */
class AiEvaluation extends Model
{
    protected $table = 'ai_evaluations';

    protected $fillable = [
        'run_key',
        'model',
        'total_items',
        'passed_items',
        'score',
        'latency_ms',
        'total_tokens',
        'items',
    ];

    protected $casts = [
        'total_items' => 'integer',
        'passed_items' => 'integer',
        'score' => 'float',
        'latency_ms' => 'integer',
        'total_tokens' => 'integer',
        'items' => 'array',
    ];
}