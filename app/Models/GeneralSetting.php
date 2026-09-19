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
        'ai_api_keys',
        'ai_model',
        'ai_system_instruction',
    ];

    protected $casts = [
        'geofence_lock_enabled' => 'boolean',
        'ai_enabled' => 'boolean',
        'ai_api_keys' => 'array',
    ];

    /**
     * Ordered, de-duplicated list of all configured Gemini API keys.
     * The legacy single `ai_api_key` column is always treated as primary
     * (slot 1); the `ai_api_keys` JSON holds the remaining failover keys.
     * Empty slots are simply skipped, so only filled keys are ever used.
     */
    public function apiKeyList(): array
    {
        $keys = [];

        $primary = trim((string)$this->ai_api_key);
        if ($primary !== '') {
            $keys[] = $primary;
        }

        foreach ((array)$this->ai_api_keys as $key) {
            $key = trim((string)$key);
            if ($key !== '' && !in_array($key, $keys, true)) {
                $keys[] = $key;
            }
        }

        return $keys;
    }
}
