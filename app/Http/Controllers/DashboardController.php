<?php

namespace App\Http\Controllers;

use App\Models\Sale;
use App\Models\ReturnLog;
use App\Models\WarrantyRepair;
use App\Models\Store;
use App\Models\Stock;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Support\Facades\DB;
use App\Services\GeminiAssistantService;

class DashboardController extends Controller
{
    protected GeminiAssistantService $geminiService;

    public function __construct(GeminiAssistantService $geminiService)
    {
        $this->geminiService = $geminiService;
    }

    public function index(Request $request): Response
    {
        $user = $request->user();
        $data = $this->resolveDashboardData($request, $user);

        return Inertia::render('Dashboard', array_merge($data, [
            'aiConfig' => [
                'is_configured' => $this->geminiService->isConfigured(),
                'is_enabled' => $this->geminiService->isEnabled(),
                'model' => $this->geminiService->getModel(),
            ],
        ]));
    }

    /**
     * Generate a one-shot AI Business Overview for the current dashboard filters.
     * Returns the AI markdown reply (or null / error info if unavailable).
     */
    public function aiInsight(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $request->user();
        $data = $this->resolveDashboardData($request, $user);

        if (!$this->geminiService->isConfigured()) {
            return response()->json([
                'success' => false,
                'message' => 'Gemini API Key is not configured yet. Please ask the Superadmin to configure it in Settings > General.',
            ]);
        }

        if (!$this->geminiService->isEnabled()) {
            return response()->json([
                'success' => false,
                'message' => 'AI Assistant is currently disabled in system settings.',
            ]);
        }

        $context = array_merge($data, [
            'periodLabel' => $data['activeStoreName'] . ' — ' . $data['filters']['month'] . '/' . $data['filters']['year'],
            'scopeLabel' => $data['activeStoreName'],
        ]);

        try {
            $insight = $this->geminiService->generateDashboardInsight($context);

            if (!$insight) {
                return response()->json([
                    'success' => false,
                    'message' => 'AI did not return any insight. Please try again in a moment.',
                ]);
            }

            return response()->json([
                'success' => true,
                'insight' => $insight,
                'period' => [
                    'label' => $context['periodLabel'],
                    'month' => $data['filters']['month'],
                    'year' => $data['filters']['year'],
                    'store_id' => $data['filters']['store_id'],
                ],
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Dashboard AI insight error: ' . $e->getMessage());

            return response()->json([
                'success' => false,
                'message' => 'An error occurred while generating the AI summary: ' . $e->getMessage(),
            ]);
        }
    }

    /**
     * Compute the full dashboard dataset scoped to the current user, filters
     * and selected period. Shared by the page renderer and the AI insight endpoint.
     */
    protected function resolveDashboardData(Request $request, $user): array
    {
        // Viewers and Superadmins can see all stores and filter. Employees are scoped to their store.
        $storeId = $user->store_id;
        if (in_array($user->role, ['superadmin', 'viewer'])) {
            $requestedStore = $request->input('store_id');
            if ($requestedStore !== null && $requestedStore !== '') {
                $storeId = $requestedStore;
            }
        }

        // Custom time period (month & year)
        $latestSale = Sale::where('status', 'completed')->latest('created_at')->first();
        $defaultMonth = $latestSale ? $latestSale->created_at->month : now()->month;
        $defaultYear = $latestSale ? $latestSale->created_at->year : now()->year;

        $month = (int)$request->input('month', $defaultMonth);
        $year = (int)$request->input('year', $defaultYear);

        // Get periodic statistics (filtered by month, year, and store)
        $salesQuery = Sale::where('status', 'completed')
            ->whereMonth('created_at', $month)
            ->whereYear('created_at', $year);

        $returnsQuery = ReturnLog::whereMonth('created_at', $month)
            ->whereYear('created_at', $year);

        $repairsQuery = WarrantyRepair::where('status', 'repaired')
            ->whereMonth('created_at', $month)
            ->whereYear('created_at', $year);

        if ($storeId) {
            $salesQuery->where('store_id', $storeId);
            $returnsQuery->whereHas('sale', function ($q) use ($storeId) {
                $q->where('store_id', $storeId);
            });
            $repairsQuery->whereHas('sale', function ($q) use ($storeId) {
                $q->where('store_id', $storeId);
            });
        }

        $sales = $salesQuery->with(['items.stock', 'extras', 'returns'])->get();
        $returns = $returnsQuery->get();
        $repairs = $repairsQuery->get();

        // Financial Math for the active period
        $totalRevenue = 0;
        $totalHpp = 0;
        $soldItemsCount = 0;

        foreach ($sales as $sale) {
            $returnedStockIds = $sale->returns->pluck('stock_id')->toArray();
            $saleRevenue = 0;
            $saleHpp = 0;

            foreach ($sale->items as $item) {
                if (in_array($item->stock_id, $returnedStockIds)) {
                    continue;
                }
                if (!$item->is_trade_in_item) {
                    $saleRevenue += $item->actual_sell_price * $item->qty;
                    $saleHpp += $item->buy_price_snap * $item->qty;
                    $soldItemsCount += $item->qty;
                }
            }

            foreach ($sale->extras as $extra) {
                if ($extra->charge_to === 'buyer') {
                    $saleRevenue += $extra->sell_price;
                    $saleHpp += $extra->buy_price;
                } else {
                    // seller or free_promotion
                    $saleHpp += $extra->buy_price;
                }
            }

            $totalRevenue += $saleRevenue;
            $totalHpp += $saleHpp;
        }

        $totalRepairs = $repairs->sum('repair_cost');
        $totalReturnPenalty = $returns->sum('restocking_fee');
        $totalAffiliatorFee = $sales->sum('affiliate_fee');
        $netProfit = $totalRevenue - $totalHpp - $totalRepairs + $totalReturnPenalty - $totalAffiliatorFee;

        // Calculate Pending Profits (from booking sales) for current period
        $bookingSales = Sale::where('status', 'booking')
            ->whereMonth('created_at', $month)
            ->whereYear('created_at', $year)
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->with(['items.stock', 'extras'])
            ->get();

        $pendingProfit = 0;
        foreach ($bookingSales as $sale) {
            $rev = $sale->total_amount;
            $hpp = 0;
            foreach ($sale->items as $item) {
                $hpp += ($item->buy_price_snap ?? 0) * $item->qty;
            }
            $pendingProfit += ($rev - $hpp);
        }

        // --- All Time (Global) Statistics ---
        $allTimeSales = Sale::where('status', 'completed')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->with(['items.stock', 'extras', 'returns'])
            ->get();

        $allTimeRevenue = 0;
        $allTimeHpp = 0;
        $allTimeSoldItems = 0;

        foreach ($allTimeSales as $sale) {
            $returnedStockIds = $sale->returns->pluck('stock_id')->toArray();
            $saleRevenue = 0;
            $saleHpp = 0;

            foreach ($sale->items as $item) {
                if (in_array($item->stock_id, $returnedStockIds)) {
                    continue;
                }
                if (!$item->is_trade_in_item) {
                    $saleRevenue += $item->actual_sell_price * $item->qty;
                    $saleHpp += $item->buy_price_snap * $item->qty;
                    $allTimeSoldItems += $item->qty;
                }
            }

            foreach ($sale->extras as $extra) {
                if ($extra->charge_to === 'buyer') {
                    $saleRevenue += $extra->sell_price;
                    $saleHpp += $extra->buy_price;
                } else {
                    // seller or free_promotion
                    $saleHpp += $extra->buy_price;
                }
            }

            $allTimeRevenue += $saleRevenue;
            $allTimeHpp += $saleHpp;
        }

        $allTimeRepairsQuery = WarrantyRepair::where('status', 'repaired');
        $allTimeReturnsQuery = ReturnLog::query();
        if ($storeId) {
            $allTimeRepairsQuery->whereHas('sale', fn($q) => $q->where('store_id', $storeId));
            $allTimeReturnsQuery->whereHas('sale', fn($q) => $q->where('store_id', $storeId));
        }

        $allTimeRepairs = $allTimeRepairsQuery->sum('repair_cost');
        $allTimeReturnPenalty = $allTimeReturnsQuery->sum('restocking_fee');
        $allTimeAffiliatorFee = $allTimeSales->sum('affiliate_fee');
        $allTimeNetProfit = $allTimeRevenue - $allTimeHpp - $allTimeRepairs + $allTimeReturnPenalty - $allTimeAffiliatorFee;

        // --- Type / Phone model distribution (filtered by active period) ---
        $typeData = Sale::where('status', 'completed')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->whereMonth('created_at', $month)
            ->whereYear('created_at', $year)
            ->with(['items.stock', 'returns'])
            ->get()
            ->flatMap(function ($sale) {
                $returnedStockIds = $sale->returns->pluck('stock_id')->toArray();
                return $sale->items->filter(function ($item) use ($returnedStockIds) {
                    return !in_array($item->stock_id, $returnedStockIds) && !$item->is_trade_in_item;
                });
            })
            ->groupBy(function ($item) {
                return $item->stock->name ?? 'Unknown';
            })
            ->map(function ($group, $name) {
                return [
                    'type' => $name,
                    'total' => $group->sum('qty'),
                    'revenue' => (float)$group->sum(function ($item) {
                        return $item->actual_sell_price * $item->qty;
                    }),
                ];
            })
            ->sortByDesc('total')
            ->values()
            ->take(5);

        // --- Affiliator distribution (filtered by active period) ---
        $affiliatorData = Sale::where('status', 'completed')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->whereMonth('created_at', $month)
            ->whereYear('created_at', $year)
            ->whereNotNull('affiliate_user_id')
            ->with('affiliateUser')
            ->get()
            ->groupBy('affiliate_user_id')
            ->map(function ($group) {
                return [
                    'affiliator' => $group->first()->affiliateUser->name ?? 'Unknown',
                    'total_sales' => $group->count(),
                    'total_fee' => (float)$group->sum('affiliate_fee'),
                ];
            })
            ->sortByDesc('total_sales')
            ->values()
            ->take(5);

        // --- Monthly trends (last 8 months, scoped by store) ---
        $monthlyRevenue = Sale::where('status', 'completed')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('created_at', 'asc')
            ->get()
            ->groupBy(function ($sale) {
                return $sale->created_at->format('M Y');
            })
            ->map(function ($group) {
                return [
                    'month' => $group->first()->created_at->format('M Y'),
                    'revenue' => (float)$group->sum('total_amount'),
                ];
            })
            ->values();

        // --- Payment method distribution (filtered by active period and store) ---
        $paymentData = Sale::where('status', 'completed')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->whereMonth('created_at', $month)
            ->whereYear('created_at', $year)
            ->get()
            ->groupBy('payment_method')
            ->map(function ($group, $method) {
                return [
                    'method' => $method ?: 'Cash',
                    'count' => $group->count(),
                    'revenue' => (float)$group->sum('total_amount'),
                ];
            })
            ->values();

        // Fetch stores list for superadmin and viewer filter
        $stores = in_array($user->role, ['superadmin', 'viewer']) ? Store::all() : [];

        // Fetch recent sales (scoped by store, latest 5)
        $recentSales = Sale::with(['buyer', 'user'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('created_at', 'desc')
            ->limit(5)
            ->get();

        // Top Selling Products count (filtered by active period)
        $topProducts = DB::table('sale_items')
            ->join('stocks', 'sale_items.stock_id', '=', 'stocks.id')
            ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
            ->leftJoin('returns', function ($join) {
                $join->on('sale_items.sale_id', '=', 'returns.sale_id')
                     ->on('sale_items.stock_id', '=', 'returns.stock_id');
            })
            ->whereNull('returns.id')
            ->select('stocks.name', DB::raw('SUM(sale_items.qty) as total_sold'))
            ->where('sales.status', 'completed')
            ->whereMonth('sales.created_at', $month)
            ->whereYear('sales.created_at', $year)
            ->when($storeId, fn($q) => $q->where('stocks.store_id', $storeId))
            ->groupBy('stocks.name')
            ->orderBy('total_sold', 'desc')
            ->limit(5)
            ->get()
            ->map(function ($row) {
                return [
                    'name' => $row->name,
                    'total_sold' => (int)$row->total_sold,
                ];
            })
            ->values()
            ->all();

        $activeStoreName = 'All Branches';
        if ($storeId) {
            $activeStore = Store::find($storeId);
            $activeStoreName = $activeStore ? $activeStore->name : 'Branch';
        }

        $activeAffiliatorsCount = $sales->whereNotNull('affiliate_user_id')->pluck('affiliate_user_id')->unique()->count();

        // --- Today's (Hari Ini) Statistics ---
        $todayDate = now()->toDateString();
        $todaySales = Sale::where('status', 'completed')
            ->whereDate('created_at', $todayDate)
            ->with(['items.stock', 'extras', 'returns'])
            ->get();

        $todayReturns = ReturnLog::whereDate('created_at', $todayDate)
            ->with('sale')
            ->get();

        $todayRepairs = WarrantyRepair::where('status', 'repaired')
            ->whereDate('created_at', $todayDate)
            ->with('sale')
            ->get();

        $calculateMetrics = function ($sales, $returns, $repairs, $role) {
            $revenue = 0;
            $hpp = 0;
            $soldItems = 0;

            foreach ($sales as $sale) {
                $returnedStockIds = $sale->returns->pluck('stock_id')->toArray();
                $saleRevenue = 0;
                $saleHpp = 0;

                foreach ($sale->items as $item) {
                    if (in_array($item->stock_id, $returnedStockIds)) {
                        continue;
                    }
                    if (!$item->is_trade_in_item) {
                        $saleRevenue += $item->actual_sell_price * $item->qty;
                        $saleHpp += $item->buy_price_snap * $item->qty;
                        $soldItems += $item->qty;
                    }
                }

                foreach ($sale->extras as $extra) {
                    if ($extra->charge_to === 'buyer') {
                        $saleRevenue += $extra->sell_price;
                        $saleHpp += $extra->buy_price;
                    } else {
                        // seller or free_promotion
                        $saleHpp += $extra->buy_price;
                    }
                }

                $revenue += $saleRevenue;
                $hpp += $saleHpp;
            }

            $repairsCost = $repairs->sum('repair_cost');
            $returnPenalty = $returns->sum('restocking_fee');
            $affiliateFee = $sales->sum('affiliate_fee');
            $netProfit = $revenue - $hpp - $repairsCost + $returnPenalty - $affiliateFee;

            return [
                'revenue' => (float)$revenue,
                'netProfit' => $role === 'karyawan' ? 0 : (float)$netProfit,
                'soldItems' => (int)$soldItems,
                'transactions' => $sales->count(),
            ];
        };

        $todayStats = [
            'gabungan' => null,
            'stores' => [],
            'store' => null,
        ];

        if (in_array($user->role, ['superadmin', 'viewer'])) {
            // Combined/All Branches
            $todayStats['gabungan'] = array_merge(
                $calculateMetrics($todaySales, $todayReturns, $todayRepairs, $user->role),
                ['store_name' => 'All Branches']
            );

            // Per Store
            $allStoresList = Store::all();
            foreach ($allStoresList as $store) {
                $storeSales = $todaySales->where('store_id', $store->id);
                $storeReturns = $todayReturns->filter(fn($r) => $r->sale && $r->sale->store_id == $store->id);
                $storeRepairs = $todayRepairs->filter(fn($r) => $r->sale && $r->sale->store_id == $store->id);

                $todayStats['stores'][] = array_merge(
                    $calculateMetrics($storeSales, $storeReturns, $storeRepairs, $user->role),
                    ['store_name' => $store->name]
                );
            }
        } else {
            // Non-superadmin/viewer: only show their own store's today statistics
            $storeId = $user->store_id;
            if ($storeId) {
                $store = Store::find($storeId);
                if ($store) {
                    $storeSales = $todaySales->where('store_id', $storeId);
                    $storeReturns = $todayReturns->filter(fn($r) => $r->sale && $r->sale->store_id == $storeId);
                    $storeRepairs = $todayRepairs->filter(fn($r) => $r->sale && $r->sale->store_id == $storeId);

                    $todayStats['store'] = array_merge(
                        $calculateMetrics($storeSales, $storeReturns, $storeRepairs, $user->role),
                        ['store_name' => $store->name]
                    );
                }
            }
        }

        return [
            'stats' => [
                'totalRevenue' => (float)$totalRevenue,
                'totalHpp' => $user->role === 'karyawan' ? 0 : (float)$totalHpp,
                'totalRepairs' => $user->role === 'karyawan' ? 0 : (float)$totalRepairs,
                'totalReturnPenalty' => $user->role === 'karyawan' ? 0 : (float)$totalReturnPenalty,
                'netProfit' => $user->role === 'karyawan' ? 0 : (float)$netProfit,
                'totalAffiliatorFee' => $user->role === 'karyawan' ? 0 : (float)$sales->sum('affiliate_fee'),
                'soldItemsCount' => (int)$soldItemsCount,
                'pendingProfit' => $user->role === 'karyawan' ? 0 : (float)$pendingProfit,
                'activeAffiliatorsCount' => $user->role === 'karyawan' ? 0 : (int)$activeAffiliatorsCount,
            ],
            'allTimeStats' => [
                'revenue' => (float)$allTimeRevenue,
                'actualProfit' => $user->role === 'karyawan' ? 0 : (float)($allTimeRevenue - $allTimeHpp),
                'affiliatorFee' => $user->role === 'karyawan' ? 0 : (float)$allTimeAffiliatorFee,
                'netProfit' => $user->role === 'karyawan' ? 0 : (float)$allTimeNetProfit,
                'soldItems' => (int)$allTimeSoldItems,
            ],
            'typeData' => $typeData,
            'affiliatorData' => $user->role === 'karyawan' ? [] : $affiliatorData,
            'monthlyRevenue' => $monthlyRevenue,
            'paymentData' => $paymentData,
            'stores' => $stores,
            'recentSales' => $recentSales,
            'topProducts' => $topProducts,
            'activeStoreName' => $activeStoreName,
            'filters' => [
                'store_id' => $storeId,
                'month' => $month,
                'year' => $year,
            ],
            'todayStats' => $todayStats,
        ];
    }
}