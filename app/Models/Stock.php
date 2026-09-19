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

    public function parameterValues(): HasMany
    {
        return $this->hasMany(StockParameterValue::class, 'stock_id');
    }

    /**
     * Persist dynamic parameter selections for this stock unit (EAV).
     *
     * Accepts a map of dynamic_parameter_id => dynamic_parameter_value_id.
     * Keeps legacy spec columns (brand_id, color_id, memory_id, license_id)
     * and the 'type' column in sync so existing sales/display/AI flows
     * continue to work without changes.
     */
    public function syncDynamicParameters(array $paramValueIds = []): void
    {
        $columnAliases = [
            'brand_id' => ['brand', 'merek'],
            'color_id' => ['color', 'warna'],
            'memory_id' => ['memory', 'storage', 'capacity', 'memori'],
            'license_id' => ['license', 'licence', 'lisensi'],
        ];

        $legacyColumns = [];
        $keptParamIds = [];

        foreach ($paramValueIds as $paramId => $valueId) {
            $paramId = (int) $paramId;
            $valueId = (int) $valueId;
            if ($paramId <= 0 || $valueId <= 0) {
                continue;
            }

            $param = DynamicParameter::find($paramId);
            if (! $param) {
                continue;
            }

            // Track the row in the EAV table
            StockParameterValue::updateOrCreate(
                ['stock_id' => $this->id, 'parameter_id' => $paramId],
                ['value_id' => $valueId]
            );
            $keptParamIds[] = $paramId;

            $name = strtolower($param->name);

            // Item Condition maps to the legacy 'type' column
            if (str_contains($name, 'condition')) {
                $value = DynamicParameterValue::find($valueId);
                if ($value) {
                    $legacyColumns['type'] = str_contains(strtolower($value->value), 'new')
                        ? 'new'
                        : 'second';
                }
                continue;
            }

            foreach ($columnAliases as $column => $aliases) {
                foreach ($aliases as $alias) {
                    if (str_contains($name, $alias)) {
                        $legacyColumns[$column] = $valueId;
                        break 2;
                    }
                }
            }
        }

        // Remove EAV rows whose parameter is no longer selected
        $this->parameterValues()
            ->whereNotIn('parameter_id', $keptParamIds)
            ->delete();

        if (! empty($legacyColumns)) {
            $this->update($legacyColumns);
        }
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
