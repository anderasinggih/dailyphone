<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Stock extends Model
{
    use SoftDeletes;
    protected $fillable = [
        'store_id',
        'category',
        'type',
        'name',
        'brand_id',
        'color_id',
        'memory_id',
        'license_id',
        'serial_number',
        'imei_1',
        'supplier',
        'warranty_duration_days',
        'buy_price',
        'sell_price',
        'sell_price_reseller',
        'qty',
        'status',
        'created_by',
        'default_charge_to'
    ];

    protected $casts = [
        'warranty_duration_days' => 'integer',
        'buy_price' => 'decimal:2',
        'sell_price' => 'decimal:2',
        'sell_price_reseller' => 'decimal:2',
        'qty' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(DynamicParameterValue::class, 'brand_id');
    }

    public function color(): BelongsTo
    {
        return $this->belongsTo(DynamicParameterValue::class, 'color_id');
    }

    public function memory(): BelongsTo
    {
        return $this->belongsTo(DynamicParameterValue::class, 'memory_id');
    }

    public function license(): BelongsTo
    {
        return $this->belongsTo(DynamicParameterValue::class, 'license_id');
    }

    public function saleItems(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    public function returns(): HasMany
    {
        return $this->hasMany(ReturnLog::class);
    }

    public function transfers(): HasMany
    {
        return $this->hasMany(StockTransfer::class);
    }
}
