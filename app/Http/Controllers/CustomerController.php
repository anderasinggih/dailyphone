<?php

namespace App\Http\Controllers;

use App\Models\Buyer;
use App\Models\DynamicParameter;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class CustomerController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();
        
        $buyers = Buyer::with(['sales' => function($q) {
            $q->where('status', 'completed')->with('items');
        }])->get();

        $customers = $buyers->map(function ($buyer) {
            $totalSales = $buyer->sales->count();
            $totalSpent = $buyer->sales->sum('total_amount');
            
            $totalItems = 0;
            foreach ($buyer->sales as $sale) {
                $totalItems += $sale->items->sum('qty');
            }

            return [
                'id' => $buyer->id,
                'name' => $buyer->name,
                'phone' => $buyer->phone,
                'address' => $buyer->address,
                'flag' => $buyer->flag ?? 'regular',
                'notes' => $buyer->notes,
                'total_purchases' => $totalSales,
                'total_spent' => (float)$totalSpent,
                'total_items_bought' => $totalItems,
                'created_at' => $buyer->created_at->format('Y-m-d H:i:s'),
            ];
        });

        // Fetch dynamic flag options configured in parameters
        $flagParam = DynamicParameter::where('name', 'Customer Flags')->with(['values' => function($q) {
            $q->where('is_active', true)->orderBy('value', 'asc');
        }])->first();

        $flagOptions = $flagParam ? $flagParam->values->map(function($v) {
            return [
                'value' => $v->value,
                'color' => $v->color ?? 'blue',
            ];
        }) : [];

        return Inertia::render('Customers', [
            'customers' => $customers,
            'flagOptions' => $flagOptions,
        ]);
    }

    public function updateFlagAndNotes(Request $request, Buyer $buyer)
    {
        $validated = $request->validate([
            'flag' => 'required|string|max:50',
            'notes' => 'nullable|string|max:2000',
        ]);

        $buyer->update($validated);

        return redirect()->back()->with('success', 'Customer flag and notes updated.');
    }
}
