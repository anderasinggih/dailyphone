<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\StockController;
use App\Http\Controllers\SaleController;
use App\Http\Controllers\ShiftController;
use App\Http\Controllers\CustomerController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\StoreManagementController;
use App\Http\Controllers\ActivityLogController;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    if (auth()->check()) {
        return redirect()->route('dashboard');
    }
    return Inertia::render('Landing');
})->name('landing');

Route::get('/invoice/{invoice_number}', [SaleController::class, 'publicInvoice'])->name('public.invoice');

Route::prefix('application/dp')->group(function () {
    Route::middleware(['auth', 'verified'])->group(function () {
        // Dashboard
        Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');
        Route::post('/dashboard/ai-insight', [DashboardController::class, 'aiInsight'])->name('dashboard.ai-insight');

        // Timeline
        Route::get('/timeline', [ActivityLogController::class, 'index'])->name('timeline.index');
        Route::post('/timeline/{activityLog}/toggle-save', [ActivityLogController::class, 'toggleSave'])->name('timeline.toggle-save');

        // Stocks
        Route::get('/selling', [StockController::class, 'readyStock'])->name('selling.index');
        Route::get('/sale-data', [StockController::class, 'manageStock'])->name('sale-data.index');
        Route::post('/stocks', [StockController::class, 'store'])->name('stocks.store');
        Route::post('/stocks/batch', [StockController::class, 'storeBatch'])->name('stocks.store-batch');
        Route::post('/stocks/transfer', [StockController::class, 'transfer'])->name('stocks.transfer');
        Route::post('/stocks/transfer/{transfer}/approve', [StockController::class, 'approveTransfer'])->name('stocks.transfer.approve');
        Route::put('/stocks/{stock}', [StockController::class, 'update'])->name('stocks.update');
        Route::post('/stocks/{stock}/restore', [StockController::class, 'restore'])->name('stocks.restore');
        Route::delete('/stocks/{stock}', [StockController::class, 'destroy'])->name('stocks.destroy');
        Route::post('/parameters', [StockController::class, 'storeParameter'])->name('parameters.store');
        Route::post('/parameters/value', [StockController::class, 'storeParameterValue'])->name('parameters.value.store');
        Route::put('/parameters/value/{value}', [StockController::class, 'updateParameterValue'])->name('parameters.value.update');
        Route::post('/parameters/value/{value}/toggle', [StockController::class, 'toggleParameterValue'])->name('parameters.value.toggle');

        Route::delete('/parameters/{parameter}', [StockController::class, 'destroyParameter'])->name('parameters.destroy');
        Route::delete('/parameters/value/{value}', [StockController::class, 'deleteParameterValue'])->name('parameters.value.destroy');
        Route::get('/settings/parameters', [StockController::class, 'parameters'])->name('settings.parameters');

        // Sales
        Route::get('/sales-history', [SaleController::class, 'history'])->name('sales-history.index');
        Route::post('/sales/checkout', [SaleController::class, 'checkout'])->name('sales.checkout');
        Route::post('/sales/{sale}/void', [SaleController::class, 'void'])->name('sales.void');
        Route::post('/sales/{sale}/void/approve', [SaleController::class, 'approveVoid'])->name('sales.void.approve');
        Route::post('/sales/return', [SaleController::class, 'returnItem'])->name('sales.return');
        Route::post('/sales/warranty', [SaleController::class, 'warrantyClaim'])->name('sales.warranty');
        Route::post('/sales/warranty/{repair}/update', [SaleController::class, 'updateWarranty'])->name('sales.warranty.update');
        Route::patch('/sales/{sale}/buyer', [SaleController::class, 'updateBuyer'])->name('sales.update-buyer');

        // Customers
        Route::get('/customers', [CustomerController::class, 'index'])->name('customers.index');
        Route::patch('/customers/{buyer}/flag', [CustomerController::class, 'updateFlagAndNotes'])->name('customers.update-flag');

        // Shifts & Attendance
        Route::get('/shifts', [ShiftController::class, 'index'])->name('shifts.index');
        Route::post('/shifts/clock-in', [ShiftController::class, 'clockIn'])->name('shifts.clock-in');
        Route::post('/shifts/clock-out', [ShiftController::class, 'clockOut'])->name('shifts.clock-out');
        Route::post('/shifts/cash-drop', [ShiftController::class, 'cashDrop'])->name('shifts.cash-drop');
        Route::post('/shifts/petty-cash', [ShiftController::class, 'pettyCash'])->name('shifts.petty-cash');
        Route::put('/shifts/{shift}', [ShiftController::class, 'update'])->name('shifts.update');
        Route::delete('/shifts/{shift}', [ShiftController::class, 'destroy'])->name('shifts.destroy');
        Route::post('/shifts/payroll', [ShiftController::class, 'storePayroll'])->name('shifts.payroll.store');
        Route::post('/shifts/payroll/{payroll}/send-email', [ShiftController::class, 'sendPayrollEmail'])->name('shifts.payroll.send-email');
        Route::get('/shifts/payroll/{payroll}/print', [ShiftController::class, 'printPayroll'])->name('shifts.payroll.print');

        // User Management
        Route::get('/users', [UserController::class, 'index'])->name('users.index');
        Route::post('/users', [UserController::class, 'store'])->name('users.store');
        Route::patch('/users/{user}', [UserController::class, 'update'])->name('users.update');
        Route::delete('/users/{user}', [UserController::class, 'destroy'])->name('users.destroy');

        // Store Management
        Route::get('/stores', [StoreManagementController::class, 'index'])->name('stores.index');
        Route::post('/stores', [StoreManagementController::class, 'store'])->name('stores.store');
        Route::patch('/stores/{store}', [StoreManagementController::class, 'update'])->name('stores.update');
        Route::delete('/stores/{store}', [StoreManagementController::class, 'destroy'])->name('stores.destroy');

        // General Settings & Schedules
        Route::get('/settings/general', [\App\Http\Controllers\GeneralSettingsController::class, 'index'])->name('settings.general');
        Route::post('/settings/general', [\App\Http\Controllers\GeneralSettingsController::class, 'update'])->name('settings.general.update');
        Route::post('/settings/schedule', [\App\Http\Controllers\GeneralSettingsController::class, 'storeSchedule'])->name('settings.schedule.store');
        Route::delete('/settings/schedule/{schedule}', [\App\Http\Controllers\GeneralSettingsController::class, 'destroySchedule'])->name('settings.schedule.destroy');

        // Money Notes
        Route::get('/money-notes', [\App\Http\Controllers\MoneyNoteController::class, 'index'])->name('money-notes.index');
        Route::post('/money-notes', [\App\Http\Controllers\MoneyNoteController::class, 'store'])->name('money-notes.store');
        Route::delete('/money-notes/{moneyNote}', [\App\Http\Controllers\MoneyNoteController::class, 'destroy'])->name('money-notes.destroy');
        Route::post('/money-notes/category', [\App\Http\Controllers\MoneyNoteController::class, 'storeCategory'])->name('money-notes.category.store');

        // Profile
        Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
        Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
        Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

        // AI Assistant
        Route::get('/assistant', [\App\Http\Controllers\AiAssistantController::class, 'index'])->name('assistant.index');
        Route::post('/assistant/session', [\App\Http\Controllers\AiAssistantController::class, 'createSession'])->name('assistant.session.create');
        Route::patch('/assistant/session/{id}', [\App\Http\Controllers\AiAssistantController::class, 'updateSession'])->name('assistant.session.update');
        Route::delete('/assistant/session/{id}', [\App\Http\Controllers\AiAssistantController::class, 'deleteSession'])->name('assistant.session.destroy');
        Route::post('/assistant/chat', [\App\Http\Controllers\AiAssistantController::class, 'chat'])->name('assistant.chat');
        Route::post('/assistant/checkout-summary', [\App\Http\Controllers\AiAssistantController::class, 'checkoutSummary'])->name('assistant.checkout-summary');
        Route::post('/assistant/execute', [\App\Http\Controllers\AiAssistantController::class, 'executeAction'])->name('assistant.execute');
        Route::post('/assistant/undo', [\App\Http\Controllers\AiAssistantController::class, 'undoAction'])->name('assistant.undo');
        Route::post('/assistant/proposal-status', [\App\Http\Controllers\AiAssistantController::class, 'updateProposalStatus'])->name('assistant.proposal-status');
        Route::post('/settings/ai/test', [\App\Http\Controllers\AiAssistantController::class, 'testConnection'])->name('settings.ai.test');

        // AI Training Notes / Persistent Memory (superadmin)
        Route::get('/settings/ai/training-notes', [\App\Http\Controllers\AiTrainingNoteController::class, 'index'])->name('settings.ai.training-notes');
        Route::post('/settings/ai/training-notes', [\App\Http\Controllers\AiTrainingNoteController::class, 'store'])->name('settings.ai.training-notes.store');
        Route::post('/settings/ai/training-notes/{id}/toggle', [\App\Http\Controllers\AiTrainingNoteController::class, 'toggle'])->name('settings.ai.training-notes.toggle');
        Route::delete('/settings/ai/training-notes/{id}', [\App\Http\Controllers\AiTrainingNoteController::class, 'destroy'])->name('settings.ai.training-notes.destroy');
    });

    require __DIR__.'/auth.php';
});
