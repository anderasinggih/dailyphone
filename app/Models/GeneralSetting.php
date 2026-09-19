<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GeneralSetting extends Model
{
    protected $fillable = [
        'company_name',
        'work_start_time',
        'work_end_time',
        'grace_period_minutes',
        'geofence_lock_enabled',
        'notification_emails',
        'ai_enabled',
        'ai_provider',
        'ai_api_key',
        'ai_model',
        'ai_system_instruction',
    ];

    protected $casts = [
        'geofence_lock_enabled' => 'boolean',
        'ai_enabled' => 'boolean',
    ];
}
