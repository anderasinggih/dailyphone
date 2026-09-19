<?php

namespace App\Services;

use App\Models\Buyer;
use App\Models\Sale;
use App\Models\Stock;
use Illuminate\Support\Facades\Log;

/**
 * Gemini function-calling tools for the Assistant (item 2).
 *
 * Instead of dumping the whole store snapshot into every prompt, the model now
 * declares the read-only tools below and calls them only when a live answer is
 * actually needed — precise, cheaper, and far less prone to hallucinating
 * numbers. Every tool respects the karyawan (staff) store scope so a staff
 * user can never reach another branch's data.
 *
 * Each tool is a pure, deterministic query — no staff/superadmin-exclusive
 * mutations happen here (mutations stay behind action_proposal + execution).
 */
class AiToolService
{
    /** Max rows any read tool returns so a request never blows the context. */
    protected const MAX_ROWS = 50;

    /**
     * Gemini function declarations. Shape matches the generateContent `tools`
     * contract: [{ functionDeclarations: [{ name, description, parameters }] }].
     */
    public function declarations(): array
    {
        return [
            [
                'functionDeclarations' => [
                    [
                        'name' => 'get_stock',
                        'description' => 'Search available phone units in stock. Optionally filter by a product keyword (name, model, brand, color, storage) and/or a store id. Returns unit id, name, brand, color, storage, license, condition, sell price in Rupiah and which store it sits at.',
                        'parameters' => [
                            'type' => 'object',
                            'properties' => [
                                'keyword' => [
                                    'type' => 'string',
                                    'description' => 'Optional product keyword, e.g. "iPhone 13", "Samsung S23", color or capacity.',
                                ],
                                'store_id' => [
                                    'type' => 'integer',
                                    'description' => 'Optional store id to limit the search to one branch.',
                                ],
                                'limit' => [
                                    'type' => 'integer',
                                    'description' => 'Max rows to return (default 10).',
                                ],
                            ],
                        ],
                    ],
                    [
                        'name' => 'get_sales_today',
                        'description' => 'Today\'s completed sales summary: unit count, total sales volume, and a payment-method breakdown. Optionally filtered by store id.',
                        'parameters' => [
                            'type' => 'object',
                            'properties' => [
                                'store_id' => [
                                    'type' => 'integer',
                                    'description' => 'Optional store id to limit the report to one branch.',
                                ],
                            ],
                        ],
                    ],
                    [
                        'name' => 'get_aging_stock',
                        'description' => 'Find aging / slow-moving stock: available units that have been in inventory longer than a threshold (default 45 days). Helps audit dead stock and suggest promo campaigns.',
                        'parameters' => [
                            'type' => 'object',
                            'properties' => [
                                'min_days' => [
                                    'type' => 'integer',
                                    'description' => 'Age threshold in days (default 45).',
                                ],
                                'store_id' => [
                                    'type' => 'integer',
                                    'description' => 'Optional store id to limit the audit to one branch.',
                                ],
                            ],
                        ],
                    ],
                    [
                        'name' => 'get_customer',
                        'description' => 'Look up a registered customer by name or phone number. Returns their id, name, phone, address, total completed transactions and last purchase, useful for repeat-buyer recognition and CRM.',
                        'parameters' => [
                            'type' => 'object',
                            'properties' => [
                                'keyword' => [
                                    'type' => 'string',
                                    'description' => 'Name fragment or phone number to search by.',
                                ],
                            ],
                            'required' => ['keyword'],
                        ],
                    ],
                    [
                        'name' => 'submit_action_proposal',
                        'description' => 'Propose a concrete store data mutation (add/edit stock, adjust prices, delete a unit, etc.) for the Superadmin to review and execute. Pass the exact proposed change as structured JSON — the system renders it as a review card. Only call this when the user explicitly requests a change to store data AND the current role is superadmin. For any other role, answer that data mutations require Superadmin privileges instead.',
                        'parameters' => [
                            'type' => 'object',
                            'properties' => [
                                'action' => [
                                    'type' => 'string',
                                    'enum' => ['create_stock', 'edit_stock', 'delete_stock', 'adjust_price', 'add_bulk_stock', 'edit_customer', 'create_customer', 'void_transaction', 'create_transfer', 'update_inventory_setting'],
                                ],
                                'title' => [
                                    'type' => 'string',
                                    'description' => 'Short human-readable title for the proposal card.',
                                ],
                                'summary' => [
                                    'type' => 'string',
                                    'description' => 'One-sentence summary of what changes and why (in Indonesian unless asked otherwise).',
                                ],
                                'target' => [
                                    'type' => 'string',
                                    'description' => 'Target row id or name the change applies to.',
                                ],
                                'changes' => [
                                    'type' => 'array',
                                    'description' => 'Field-level before/after diffs shown on the review card.',
                                    'items' => [
                                        'type' => 'object',
                                        'properties' => [
                                            'field' => ['type' => 'string'],
                                            'old' => ['type' => 'string'],
                                            'new' => ['type' => 'string'],
                                        ],
                                    ],
                                ],
                                'payload' => [
                                    'type' => 'object',
                                    'additionalProperties' => true,
                                    'description' => 'Full payload the executor needs to apply the action (stock fields, IMEI/serial, prices, buyer info, etc.).',
                                ],
                            ],
                            'required' => ['action'],
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * Declarations only (no preserving of extra fields) — plain names map for
     * the model to glance at, used to keep system prompts honest.
     */
    public function names(): array
    {
        return ['get_stock', 'get_sales_today', 'get_aging_stock', 'get_customer', 'submit_action_proposal'];
    }

    /**
     * Execute one function call and turn the result into a Gemini function
     * response part. Failing fast is preferred: the tool returns an error
     * message string so the model can tell the user honestly.
     *
     * @return array{name: string, parts: non-empty-array}
     */
    public function call(string $name, array $args, $user): array
    {
        $storeFilter = null;
        if ($user && $user->role === 'karyawan' && $user->store_id) {
            $storeFilter = (int)$user->store_id;
        }

        try {
            $result = match ($name) {
                'get_stock' => $this->getStock($args, $storeFilter),
                'get_sales_today' => $this->getSalesToday($args, $storeFilter),
                'get_aging_stock' => $this->getAgingStock($args, $storeFilter),
                'get_customer' => $this->getCustomer($args),
                'submit_action_proposal' => ['accepted' => true, 'message' => 'Proposal captured for Superadmin review.'],
                default => ['error' => "Unknown tool '$name'."],
            };
        } catch (\Throwable $e) {
            Log::warning("AiToolService '$name' threw: " . $e->getMessage());
            $result = ['error' => 'Tool failed: ' . $e->getMessage()];
        }

        return [
            'name' => $name,
            'parts' => [[
                'functionResponse' => [
                    'name' => $name,
                    'response' => ['payload' => $result],
                ],
            ]],
        ];
    }

    protected function getStock(array $args, ?int $storeFilter): array
    {
        $limit = min((int)($args['limit'] ?? 10), self::MAX_ROWS);
        $limit = max(1, $limit);

        $query = Stock::with(['store', 'brand', 'color', 'memory', 'license'])
            ->where('status', 'available');

        if ($storeFilter) {
            $query->where('store_id', $storeFilter);
        } elseif (($args['store_id'] ?? null) !== null) {
            $query->where('store_id', (int)$args['store_id']);
        }

        $keyword = trim((string)($args['keyword'] ?? ''));
        if ($keyword !== '') {
            $q = mb_strtolower($keyword);
            $query->where(function ($w) use ($q) {
                $w->whereRaw('LOWER(name) LIKE ?', ["%{$q}%"])
                    ->orWhereRaw('LOWER(serial_number) LIKE ?', ["%{$q}%"])
                    ->orWhereRaw('LOWER(imei_1) LIKE ?', ["%{$q}%"])
                    ->orWhereHas('brand', fn ($b) => $b->whereRaw('LOWER(value) LIKE ?', ["%{$q}%"]))
                    ->orWhereHas('color', fn ($c) => $c->whereRaw('LOWER(value) LIKE ?', ["%{$q}%"]))
                    ->orWhereHas('memory', fn ($m) => $m->whereRaw('LOWER(value) LIKE ?', ["%{$q}%"]))
                    ->orWhereHas('license', fn ($l) => $l->whereRaw('LOWER(value) LIKE ?', ["%{$q}%"]));
            });
        }

        $rows = $query->orderBy('updated_at', 'desc')->limit($limit)->get();

        if ($rows->isEmpty()) {
            return ['count' => 0, 'message' => 'No available units match the criteria.', 'items' => []];
        }

        $items = $rows->map(fn ($s) => [
            'id' => (int)$s->id,
            'name' => $s->name,
            'brand' => $s->brand->value ?? null,
            'color' => $s->color->value ?? null,
            'memory' => $s->memory->value ?? null,
            'license' => $s->license->value ?? null,
            'type' => $s->type,
            'sell_price' => (int)$s->sell_price,
            'sell_price_label' => 'Rp ' . number_format((int)$s->sell_price, 0, ',', '.'),
            'store' => $s->store->name ?? 'Unknown Store',
            'store_id' => $s->store_id,
            'serial_number' => $s->serial_number,
            'imei_1' => $s->imei_1,
        ])->all();

        return ['count' => count($items), 'items' => $items];
    }

    protected function getSalesToday(array $args, ?int $storeFilter): array
    {
        $query = Sale::where('status', 'completed')
            ->whereDate('created_at', now()->toDateString());

        if ($storeFilter) {
            $query->where('store_id', $storeFilter);
        } elseif (($args['store_id'] ?? null) !== null) {
            $query->where('store_id', (int)$args['store_id']);
        }

        $count = $query->count();
        $total = $query->sum('total_amount');

        $byMethod = (clone $query)
            ->selectRaw('payment_method, COUNT(*) as count, SUM(total_amount) as total')
            ->groupBy('payment_method')
            ->get()
            ->mapWithKeys(fn ($r) => [
                $r->payment_method ?: 'unknown' => [
                    'count' => (int)$r->count,
                    'total' => (int)$r->total,
                ],
            ])
            ->all();

        return [
            'date' => now()->toDateString(),
            'completed_sales' => $count,
            'total_volume' => (int)$total,
            'total_volume_label' => 'Rp ' . number_format((int)$total, 0, ',', '.'),
            'by_payment_method' => $byMethod,
        ];
    }

    protected function getAgingStock(array $args, ?int $storeFilter): array
    {
        $minDays = max(0, (int)($args['min_days'] ?? 45));

        $query = Stock::with(['store', 'brand', 'color', 'memory', 'license'])
            ->where('status', 'available')
            ->where('created_at', '<=', now()->subDays($minDays));

        if ($storeFilter) {
            $query->where('store_id', $storeFilter);
        } elseif (($args['store_id'] ?? null) !== null) {
            $query->where('store_id', (int)$args['store_id']);
        }

        $total = $query->count();
        $rows = $query->orderBy('created_at', 'asc')->limit(self::MAX_ROWS)->get();

        $items = $rows->map(function ($s) use ($minDays) {
            $days = $s->created_at ? (int)$s->created_at->diffInDays(now()) : $minDays;
            return [
                'id' => (int)$s->id,
                'name' => $s->name,
                'aging_days' => $days,
                'store' => $s->store->name ?? 'Unknown Store',
                'sell_price' => (int)$s->sell_price,
                'sell_price_label' => 'Rp ' . number_format((int)$s->sell_price, 0, ',', '.'),
            ];
        })->all();

        return [
            'min_days' => $minDays,
            'aging_units' => $total,
            'sample' => $items,
        ];
    }

    protected function getCustomer(array $args): array
    {
        $keyword = trim((string)($args['keyword'] ?? ''));
        if ($keyword === '') {
            return ['error' => 'Customer search needs a keyword (name or phone).'];
        }

        $q = mb_strtolower($keyword);
        $customers = Buyer::where(fn ($w) => $w->whereRaw('LOWER(name) LIKE ?', ["%{$q}%"])
            ->orWhereRaw('REPLACE(LOWER(phone), "-", "") LIKE ?', ["%{$q}%"]))
            ->limit(self::MAX_ROWS)
            ->get();

        $results = $customers->map(function ($c) {
            $purchases = Sale::where('status', 'completed')
                ->where('buyer_id', $c->id)
                ->count();
            $last = Sale::where('status', 'completed')
                ->where('buyer_id', $c->id)
                ->orderBy('created_at', 'desc')
                ->first();

            return [
                'id' => (int)$c->id,
                'name' => $c->name,
                'phone' => $c->phone,
                'address' => $c->address,
                'completed_transactions' => $purchases,
                'last_purchase_at' => $last?->created_at?->toDateString(),
            ];
        })->all();

        if ($results === []) {
            return ['count' => 0, 'message' => 'No registered customer matches the keyword.', 'customers' => []];
        }

        return ['count' => count($results), 'customers' => $results];
    }
}