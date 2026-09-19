<?php

namespace App\Services;

use App\Models\GeneralSetting;
use App\Models\Stock;
use App\Models\Sale;
use App\Models\Store;
use App\Models\Buyer;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GeminiAssistantService
{
    protected ?string $apiKey;
    protected string $model;
    protected bool $enabled;
    protected ?string $customInstruction;

    public function __construct()
    {
        $settings = GeneralSetting::first();
        
        $this->apiKey = $settings?->ai_api_key ?: env('GEMINI_API_KEY');
        $this->model = $settings?->ai_model ?: env('GEMINI_MODEL', 'gemini-2.0-flash');
        $this->enabled = $settings ? (bool)$settings->ai_enabled : true;
        $this->customInstruction = $settings?->ai_system_instruction;
    }

    public function isConfigured(): bool
    {
        return !empty($this->apiKey);
    }

    public function isEnabled(): bool
    {
        return $this->enabled;
    }

    public function getModel(): string
    {
        return $this->model;
    }

    /**
     * Test connection to Gemini API.
     */
    public function testConnection(?string $testKey = null, ?string $testModel = null): array
    {
        $key = $testKey ?: $this->apiKey;
        $requestedModel = $testModel ?: $this->model;

        if (empty($key)) {
            return [
                'success' => false,
                'message' => 'API Key is missing. Please provide a valid Gemini API Key.'
            ];
        }

        // Try requested model first, then fallback to high-availability active models
        $candidateModels = array_unique(array_filter([
            $requestedModel,
            'gemini-3.5-flash-lite',
            'gemini-3.1-flash-lite',
            'gemini-2.5-flash',
            'gemini-3.5-flash',
            'gemini-flash-latest',
        ]));

        $lastError = '';

        foreach ($candidateModels as $model) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key={$key}";
                $response = Http::timeout(10)->post($url, [
                    'contents' => [
                        [
                            'role' => 'user',
                            'parts' => [['text' => 'Respond with the single word: ONLINE']]
                        ]
                    ]
                ]);

                if ($response->successful()) {
                    $reply = $response->json('candidates.0.content.parts.0.text', '');
                    return [
                        'success' => true,
                        'model_used' => $model,
                        'message' => "Connected successfully to {$model}! Response: " . trim($reply)
                    ];
                }

                $lastError = $response->json('error.message') ?? $response->body();
            } catch (\Exception $e) {
                $lastError = $e->getMessage();
            }
        }

        return [
            'success' => false,
            'message' => 'Google Gemini API Error: ' . $lastError
        ];
    }

    /**
     * Generate structured store context to ground the AI response.
     */
    public function generateStoreContext($user): string
    {
        $storeFilter = null;
        if ($user && $user->role === 'karyawan' && $user->store_id) {
            $storeFilter = $user->store_id;
        }

        // Stores
        $stores = Store::select('id', 'name', 'location')->get();
        $storeListStr = $stores->map(fn($s) => "Store ID {$s->id}: {$s->name} ({$s->location})")->implode("\n");

        // Available Stocks Summary
        $stockQuery = Stock::with(['store', 'brand', 'color', 'memory', 'license'])
            ->where('status', 'available');

        if ($storeFilter) {
            $stockQuery->where('store_id', $storeFilter);
        }

        $availableCount = (clone $stockQuery)->count();
        $stocks = $stockQuery->limit(70)->get();

        $stockSample = $stocks->map(function ($s) {
            $storeName = $s->store ? $s->store->name : 'Unknown Store';
            $brand = $s->brand ? $s->brand->value : '';
            $color = $s->color ? $s->color->value : '';
            $mem = $s->memory ? $s->memory->value : '';
            $lic = $s->license ? $s->license->value : '';
            $price = number_format($s->sell_price, 0, ',', '.');
            $imei = $s->imei_1 ? " (IMEI: {$s->imei_1})" : "";

            return "- [ID: {$s->id}] {$s->name} | {$brand} | {$color} | {$mem} | {$lic} | Type: {$s->type} | Price: Rp {$price} | Loc: {$storeName}{$imei}";
        })->implode("\n");

        // Today's Sales Digest
        $today = now()->format('Y-m-d');
        $salesTodayQuery = Sale::whereDate('created_at', $today)->where('status', 'completed');
        if ($storeFilter) {
            $salesTodayQuery->where('store_id', $storeFilter);
        }

        $salesTodayCount = $salesTodayQuery->count();
        $salesTodayTotal = $salesTodayQuery->sum('total_amount');
        $formattedSales = number_format($salesTodayTotal, 0, ',', '.');

        // AUDIT INTELLIGENCE DATA
        // 1. Void / Cancelled transactions in last 7 days (Audit flag)
        $voidSales = Sale::with(['store', 'user'])
            ->where('status', 'void')
            ->where('updated_at', '>=', now()->subDays(7))
            ->limit(10)
            ->get();
        $voidAuditStr = $voidSales->isEmpty() 
            ? "None (No void transactions in last 7 days)" 
            : $voidSales->map(function($v) {
                $st = $v->store ? $v->store->name : '-';
                $by = $v->user ? $v->user->name : '-';
                return "- Invoice #{$v->invoice_number} | Rp " . number_format($v->total_amount, 0, ',', '.') . " | Reason: {$v->void_reason} | Store: {$st} | Kasir: {$by}";
            })->implode("\n");

        // 2. Dead/Aging Stock Audit (>45 days available)
        $agingStocks = Stock::where('status', 'available')
            ->where('created_at', '<=', now()->subDays(45));
        if ($storeFilter) {
            $agingStocks->where('store_id', $storeFilter);
        }
        $agingCount = (clone $agingStocks)->count();
        $agingSample = $agingStocks->limit(5)->get()->map(function($a) {
            $days = $a->created_at ? (int)$a->created_at->diffInDays(now()) : 45;
            return "- [Aging {$days}d] {$a->name} (Rp " . number_format($a->sell_price, 0, ',', '.') . ")";
        })->implode("\n");

        // 3. Pending Stock Transfers
        $pendingTransfers = \App\Models\StockTransfer::with(['stock', 'fromStore', 'toStore'])
            ->where('status', 'pending')
            ->limit(10)
            ->get();
        $pendingTransferCount = $pendingTransfers->count();
        $transferStr = $pendingTransfers->isEmpty()
            ? "No pending inter-store transfers"
            : $pendingTransfers->map(fn($t) => "- Unit: {$t->stock?->name} | From {$t->fromStore?->name} -> To {$t->toStore?->name}")->implode("\n");

        // Customer count & recent customers list
        $customerCount = Buyer::count();
        $recentCustomers = Buyer::orderBy('updated_at', 'desc')->limit(15)->get();
        $customerSampleStr = $recentCustomers->isEmpty()
            ? "No registered customers yet"
            : $recentCustomers->map(fn($c) => "- [ID: {$c->id}] {$c->name} | Phone: {$c->phone} | Address: {$c->address}")->implode("\n");

        // Recently Deleted / Trashed Units (Soft deleted)
        $trashedStocks = Stock::onlyTrashed()->with(['store'])->orderBy('deleted_at', 'desc')->limit(10)->get();
        $trashedStockStr = $trashedStocks->isEmpty()
            ? "None (No recently deleted units in trash)"
            : $trashedStocks->map(function($t) {
                $st = $t->store ? $t->store->name : '-';
                $imei = $t->imei_1 ? " | IMEI: {$t->imei_1}" : "";
                $sn = $t->serial_number ? " | SN: {$t->serial_number}" : "";
                return "- [ID: {$t->id}] {$t->name}{$imei}{$sn} | Branch: {$st} | Deleted at: {$t->deleted_at}";
            })->implode("\n");

        $userStoreName = $user && $user->store ? $user->store->name : 'All Stores (Admin View)';
        $userRole = $user ? $user->role : 'user';

        return <<<CONTEXT
SYSTEM CONTEXT & LIVE STORE DATA:
- Current Date & Time: {$today}
- Active User Role: {$userRole}
- Active Store Scope: {$userStoreName}
- Total Active Branches: {$stores->count()}
{$storeListStr}

LIVE INVENTORY HIGHLIGHTS:
- Total Units Available: {$availableCount}
- Active Stock Catalog Sample:
{$stockSample}

RECENTLY DELETED / TRASHED UNITS (Keranjang Sampah):
{$trashedStockStr}

TODAYS OPERATIONS:
- Today's Completed Sales Count: {$salesTodayCount}
- Today's Sales Volume: Rp {$formattedSales}
- Total Registered Customers: {$customerCount}

REGISTERED CUSTOMER DIRECTORY (Recent Sample):
{$customerSampleStr}

OPERATIONAL AUDIT DATA:
- Aging/Dead Stock (>45 days): {$agingCount} units
{$agingSample}
- Void Transactions (Last 7 Days):
{$voidAuditStr}
- Pending Inter-Store Transfers: {$pendingTransferCount} pending
{$transferStr}
CONTEXT;
    }

    /**
     * Send chat conversation to Gemini.
     */
    public function chat(array $messages, $user, ?string $sessionRules = null): array
    {
        if (!$this->isConfigured()) {
            return [
                'success' => false,
                'reply' => 'Gemini API Key has not been configured yet. Please ask the Superadmin to configure it in Settings > General.'
            ];
        }

        $userRole = $user ? $user->role : 'user';
        $userStoreName = $user && $user->store ? $user->store->name : 'All Stores (Admin View)';
        $storeContext = $this->generateStoreContext($user);
        $customInst = $this->customInstruction ? "\nADDITIONAL STORE INSTRUCTIONS: {$this->customInstruction}" : "";
        $sessionRulesPrompt = !empty($sessionRules) ? "\nCUSTOM SESSION RULES & TRAINING DIRECTIVES (STRICTLY ADHERE TO THESE IN THIS CHAT SESSION):\n" . $sessionRules . "\n" : "";

        $systemPrompt = <<<PROMPT
You are "Daily Phone Intelligence", a high-precision AI Operations, Audit & Growth Marketing Assistant for Daily Phone gadget retail stores.
You possess advanced operational audit and growth marketing skills:
1. Operational Auditing & Anomaly Detection: You can audit and analyze inventory health, identify dead/aging stock (>45 days), evaluate voided/cancelled invoices for suspicious patterns, and review inter-store transfer delays.
2. Retail & Gadget Marketing Strategies: You are equipped with expert retail marketing skills (campaign ideas, promo offers, bundled packages, pricing psychology, social media copy, WhatsApp broadcast copywriting, ads creative, and customer retention/referral loops). When asked for promo ideas or marketing recommendations for specific smartphones or slow-moving stock, provide high-converting, creative, and realistic gadget retail campaigns.
3. Direct, Concise & To The Point (CRITICAL):
   - Answer directly and crisply like ChatGPT. Do NOT repeat redundant pleasantries ("Siap, Superadmin!", "Tentu saja!", "Berikut adalah rincian spesifikasi proposal aksi...").
   - Eliminate filler words and repetitive preamble text.
   - If proposing an action, state what is being done in 1-2 concise sentences, without echoing the entire table in normal text because the action proposal card already displays all details cleanly.
4. Markdown Formatting (REQUIRED): Always format replies cleanly using Markdown:
   - Headings with ## or ### for sections when appropriate.
   - Bold ** for key metrics/numbers.
   - Bullet lists (- ) for concise enumerations.
   - Use a Markdown table (| Col A | Col B |) whenever presenting structured comparative data (stock audit, aging, price checks).
5. Language Policy: Respond in the user's language (Indonesian or English). Maintain a calm, professional Apple HIG tone.

ACCESS RULES (STRICT):
- The current user role is: {$userRole}
- SUPERADMIN & ADMIN: Have FULL, unrestricted access to ALL information across ALL branches/stores — every stock item, every sale, every customer, every audit record. Never refuse or restrict data for these roles. Always answer with complete data.
- KARYAWAN (staff): Only access their assigned store ({$userStoreName}). Do not reveal data from other stores/branches.
- Never claim information is "not accessible" when it exists in the SYSTEM CONTEXT below.
- If a requested metric is absent from the context, say so honestly and suggest what data would be needed.

SUPERADMIN EXECUTION & ACTION PROPOSALS:
Whenever the Superadmin explicitly asks or implies an action (such as changing a price, marking a unit as sold/terjual, updating a stock status/note, recording a money note/expense/income, or running a python calculation/script), you MUST act as an intelligent business partner:

1. INTELLIGENT VALIDATION OF MANDATORY FIELDS:
   - Selling a stock unit (`action`: "sell_stock"):
     * STRICT CUSTOMER RULE: You CANNOT and MUST NOT invent, guess, hallucinate, or improvise dummy customer names (e.g. NEVER make up names like "Alex Turner", "John Doe", "Budi", or walk-in placeholders).
     * If the user asks to mark a unit as sold but HAS NOT provided customer details or payment method (e.g. user simply says "jadikan status terjual yg ip 12 itu" or "laku harga 6jt"):
       DO NOT EMIT AN ACTION PROPOSAL!
       Instead, politely and firmly ask the user for the customer and transaction details:
       "Untuk mencatat unit ini sebagai Terjual ke sistem kasir, mohon berikan data transaksi & pembeli:
       1. **Nama Pembeli** (atau pilih dari pelanggan terdaftar)
       2. **Nomor HP / WhatsApp** (wajib untuk data garansi & CRM)
       3. **Alamat Domisili** (kota/kabupaten, misal: Purwokerto, Cilacap, dsb.)
       4. **Metode Pembayaran** (Cash, Transfer BCA / Mandiri / BRI, atau QRIS)
       5. **Harga Deal Terjual** (jika berbeda dari Rp [harga katalog])"
     * ALL FIELDS REQUIRED FOR NEW CUSTOMERS:
       - `buyer_name`: Full name of customer
       - `buyer_phone`: Valid phone number (e.g. "08123456789")
       - `buyer_address`: City/Address
       - `actual_sell_price`: Transaction amount
       - `payment_method`: e.g. "cash", "bca", "transfer", "qris"
     * If the customer is already in the REGISTERED CUSTOMER DIRECTORY, user can just state the name/phone and you can match existing data.
     * ONLY emit the ```action_proposal when all of these verified details are provided!

2. ACTIONS SUPPORTED:
   - "add_stock": When the user asks to add, input, or create a new stock/unit, OR when user asks to restore / put back a previously deleted unit (e.g. "add stok coy ip 12", "add <imei> back", "pulihkan unit <imei>", "tambah kembali"):
     * MANDATORY: `name` (e.g. "iPhone 12 128GB"), `buy_price` (HPP), `sell_price` (Harga Jual).
     * OPTIONAL / DEFAULTS: `store_id` (default store from context), `category` ("iphone"|"android"), `type` ("second"|"new"), `brand` ("Apple"|"Samsung"|...), `color` ("Black"|"White"|"Midnight"|...), `memory` ("128GB"|"256GB"|...), `license` ("iBox (Resmi)"|"Bea Cukai (Sinyal On)"|"Inter (Sinyal Off)"|...), `serial_number`, `imei_1`. If the user asks to restore or add back a unit from RECENTLY DELETED / TRASHED UNITS, pass its `imei_1` and original specifications; the system will automatically restore it from trash instead of duplicating! If user says "spesifikasi ngasal" or doesn't specify, fill sensible default prices and specs!
   - "update_stock": When the user asks to update prices, status, or notes of an EXISTING stock item.
     * Ensure the target unit is clearly identified by `stock_id` or `serial_number` from the LIVE INVENTORY context. DO NOT use `update_stock` to create a new unit!
   - "delete_stock": When the user asks to delete or remove an existing stock unit from inventory.
     * Must provide `stock_id` or `serial_number` of an existing unit.
   - "sell_stock": When the user asks to record a unit sale (mark as sold).
     * MANDATORY: `buyer_name`, `actual_sell_price`, `payment_method`.
   - "create_money_note": When recording cash book income or expenses.
     * MANDATORY: `type` ("expense"|"income"), `amount`, `category`, `description`.
   - "run_python_script": Running ad-hoc calculations or data scripts in Python 3.

3. STRUCTURED ACTION PROPOSAL FORMAT:
When all criteria are met, formulate your response in two parts:
Part 1: A brief, polite explanation in friendly Markdown of the changes.
Part 2: A single structured code block starting with ```action_proposal and ending with ``` containing valid JSON:
```action_proposal
{
  "action": "add_stock" | "sell_stock" | "update_stock" | "delete_stock" | "create_money_note" | "run_python_script",
  "title": "Short title of action",
  "summary": "1 sentence explanation of the action",
  "target": "Target identifier (e.g. New Unit iPhone 12 128GB, or existing SN: DP-xxx)",
  "changes": [
    // CRITICAL: Must be COMPREHENSIVE and DETAILED! Never output only 2-3 fields.
    // For add_stock, YOU MUST LIST ALL SPECIFICATION FIELDS in changes so the user can review:
    // - Nama Unit
    // - Brand / Merk
    // - Kapasitas Memori (e.g. 64GB, 128GB, 256GB, 512GB)
    // - Warna (e.g. Midnight, Blue, Black, White, Purple, Starlight)
    // - Tipe Lisensi (e.g. iBox (Resmi), Bea Cukai (Sinyal On), Inter (Sinyal Off))
    // - Kondisi / Tipe (e.g. Second Mulus, Baru (BNIB))
    // - Nomor IMEI / Serial Number (e.g. 35xxxxxxxxxxxxx / DP-IP-xxxxxx)
    // - Garansi Toko (e.g. 30 Hari)
    // - Lokasi Cabang Toko (e.g. PERENG STORE)
    // - Harga Beli / HPP (e.g. Rp 4.500.000)
    // - Harga Jual Katalog (e.g. Rp 5.800.000)
    // - Status Unit (e.g. Available)
    { "field": "Nama Unit", "old": "-", "new": "iPhone 12 128GB" },
    { "field": "Kapasitas Memori", "old": "-", "new": "128GB" },
    { "field": "Warna", "old": "-", "new": "Blue" },
    { "field": "Nomor IMEI", "old": "-", "new": "358729104829104" },
    { "field": "Tipe Lisensi", "old": "-", "new": "iBox (Resmi)" },
    { "field": "Kondisi", "old": "-", "new": "Second" },
    { "field": "Lokasi Toko", "old": "-", "new": "PERENG STORE" },
    { "field": "Harga Beli (HPP)", "old": "-", "new": "Rp 4.500.000" },
    { "field": "Harga Jual", "old": "-", "new": "Rp 5.800.000" },
    { "field": "Masa Garansi", "old": "-", "new": "30 Hari" },
    { "field": "Status Unit", "old": "-", "new": "Available" }
  ],
  "payload": {
    // For add_stock:
    // "name": "iPhone 12 128GB", "store_id": 1, "category": "iphone", "type": "second", "brand": "Apple", "color": "Blue", "memory": "128GB", "license": "iBox (Resmi)", "imei_1": "358729104829104", "buy_price": 4500000, "sell_price": 5800000, "warranty_duration_days": 30
    // For update_stock:
    // "stock_id": 123 (or "serial_number": "..."), "sell_price": 9200000, "buy_price": 7500000, "status": "available"
    // For delete_stock:
    // "stock_id": 123 (or "serial_number": "...")
    // For sell_stock:
    // "stock_id": 123 (or "serial_number": "..."), "buyer_name": "Budi Santoso", "buyer_phone": "08123456789", "buyer_address": "Purwokerto", "actual_sell_price": 9200000, "payment_method": "cash"|"transfer"|"qris"
    // For create_money_note:
    // "type": "expense"|"income", "amount": 250000, "category": "Operasional", "description": "Beli galon air"
    // For run_python_script:
    // "code": "valid python 3 code to execute"
  }
}
```
CRITICAL: Only emit ```action_proposal when the user role is 'superadmin'. For non-superadmin users, politely inform them that executing data mutations requires Superadmin privileges. Never emit fake actions.

{$storeContext}
{$customInst}
{$sessionRulesPrompt}
PROMPT;

        // Build contents for Gemini API
        $contents = [];

        foreach ($messages as $msg) {
            $role = ($msg['role'] === 'user') ? 'user' : 'model';
            $contents[] = [
                'role' => $role,
                'parts' => [
                    ['text' => $msg['content']]
                ]
            ];
        }

        // Gemini REST payload (Token-optimized)
        $payload = [
            'system_instruction' => [
                'parts' => [
                    ['text' => $systemPrompt]
                ]
            ],
            'contents' => $contents,
            'generationConfig' => [
                'temperature' => 0.3,
                'maxOutputTokens' => 1400,
            ]
        ];

        $candidateModels = array_unique(array_filter([
            $this->model,
            'gemini-3.5-flash-lite',
            'gemini-3.1-flash-lite',
            'gemini-2.5-flash',
            'gemini-3.5-flash',
            'gemini-flash-latest',
        ]));

        $lastErrorMsg = '';

        foreach ($candidateModels as $modelToTry) {
            try {
                $url = "https://generativelanguage.googleapis.com/v1beta/models/{$modelToTry}:generateContent?key={$this->apiKey}";
                $response = Http::timeout(30)->post($url, $payload);

                if ($response->successful()) {
                    $text = $response->json('candidates.0.content.parts.0.text', '');
                    return [
                        'success' => true,
                        'reply' => trim($text),
                    ];
                }

                $lastErrorMsg = $response->json('error.message') ?? $response->body();
                Log::warning("Gemini model {$modelToTry} failed: {$lastErrorMsg}");
            } catch (\Exception $e) {
                $lastErrorMsg = $e->getMessage();
            }
        }

        return [
            'success' => false,
            'reply' => "I encountered an error communicating with Gemini: {$lastErrorMsg}"
        ];
    }
}
