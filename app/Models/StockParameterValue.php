<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockParameterValue extends Model
{
    protected $fillable = [
        'stock_id',
        'parameter_id',
        'value_id',
    ];

    public function stock(): BelongsTo
    {
        return $this->belongsTo(Stock::class);
    }

    public function parameter(): BelongsTo
    {
        return $this->belongsTo(DynamicParameter::class, 'parameter_id');
    }

    public function value(): BelongsTo
    {
        return $this->belongsTo(DynamicParameterValue::class, 'value_id');
    }
}