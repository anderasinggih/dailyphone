<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiContextCache extends Model
{
    protected $fillable = ['cache_key', 'cache_name', 'model', 'expires_at'];

    protected $casts = [
        'expires_at' => 'datetime',
    ];
}