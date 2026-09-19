<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Sale extends Model
{
    protected $fillable = [
        'invoice_number',
        'store_id',
        'user_id',
        'buyer_id',
        'shift_id',
        'payment_method',
        'payment_detail',
        'total_amount',
        'dp_amount',
        'status',
        'affiliate_user_id',
        'affiliate_fee',
        'void_reason'
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'dp_amount' => 'decimal:2',
        'affiliate_fee' => 'decimal:2',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(Buyer::class);
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    public function affiliateUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'affiliate_user_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    public function extras(): HasMany
    {
        return $this->hasMany(SaleExtra::class);
    }

    public function returns(): HasMany
    {
        return $this->hasMany(ReturnLog::class);
    }

    public function repairs(): HasMany
    {
        return $this->hasMany(WarrantyRepair::class);
    }
}
