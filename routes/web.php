<?php

use App\Http\Controllers\ActivityLogController;
use App\Http\Controllers\AiAssistantController;
use App\Http\Controllers\AiTestController;
use App\Http\Controllers\AiTrainingNoteController;
use App\Http\Controllers\CustomerController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GeneralSettingsController;
use App\Http\Controllers\MoneyNoteController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\SaleController;
use App\Http\Controllers\ShiftController;
use App\Http\Controllers\StockController;
use App\Http\Controllers\StoreManagementController;
use App\Http\Controllers\UserController;
use App\Models\GeneralSetting;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    if (auth()->check()) {
        return redirect()->route('dashboard');
    }

    $settings = GeneralSetting::first() ?? GeneralSetting::create([
        'company_name' => 'Daily Phone',
        'landing_enabled' => true,
        'landing_tagline' => 'iPhone Berkualitas. Harga Bersahabat.',
        'landing_description' => 'iPhone baru & terawat, bergaransi resmi, bisa tukar tambah.',
        'instagram_handle' => 'dailyphone.store',
        'instagram_url' => 'https://www.instagram.com/dailyphone.store/',
        'whatsapp_number' => '0881010229772',
        'store_address' => 'Pekojan, Jakarta Barat',
        'instagram_embeds' => [],
    ]);

    // Landing page can be hidden from Settings → Company & Identity.
    if ($settings->landing_enabled === false) {
        return redirect()->route('login');
    }

    return Inertia::render('Landing', [
        'settings' => $settings,
    ]);
})->name('landing');

Route::get('/invoice/{invoice_number}', [SaleController::class, 'publicInvoice'])->name('public.invoice');

Route::get('/ai-test', [AiTestController::class, 'index'])->name('ai-test.index');
Route::post('/ai-test/chat', [AiTestController::class, 'send'])->name('ai-test.chat');

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
        Route::get('/settings/general', [GeneralSettingsController::class, 'index'])->name('settings.general');
        Route::post('/settings/general', [GeneralSettingsController::class, 'update'])->name('settings.general.update');
        Route::post('/settings/schedule', [GeneralSettingsController::class, 'storeSchedule'])->name('settings.schedule.store');
        Route::delete('/settings/schedule/{schedule}', [GeneralSettingsController::class, 'destroySchedule'])->name('settings.schedule.destroy');

        // Money Notes
        Route::get('/money-notes', [MoneyNoteController::class, 'index'])->name('money-notes.index');
        Route::post('/money-notes', [MoneyNoteController::class, 'store'])->name('money-notes.store');
        Route::delete('/money-notes/{moneyNote}', [MoneyNoteController::class, 'destroy'])->name('money-notes.destroy');
        Route::post('/money-notes/category', [MoneyNoteController::class, 'storeCategory'])->name('money-notes.category.store');

        // Profile
        Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
        Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
        Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

        // AI Assistant
        Route::get('/assistant', [AiAssistantController::class, 'index'])->name('assistant.index');
        // Focused chat-only view: same auth + verified rules, no app navigation shell.
        Route::get('/chat', [AiAssistantController::class, 'chatOnly'])->name('assistant.chat-only');
        // Focused visualization mode: a big markdown/HTML viewer with a floating
        // composer, so the AI can reply with full documents (graphs, dashboards).
        Route::get('/viz', [AiAssistantController::class, 'visualization'])->name('assistant.visualization');
        Route::post('/assistant/session', [AiAssistantController::class, 'createSession'])->name('assistant.session.create');
        Route::patch('/assistant/session/{id}', [AiAssistantController::class, 'updateSession'])->name('assistant.session.update');
        Route::delete('/assistant/session/{id}', [AiAssistantController::class, 'deleteSession'])->name('assistant.session.destroy');
        Route::post('/assistant/chat', [AiAssistantController::class, 'chat'])->name('assistant.chat');

        // Projects (fold sessions + own a shared file tree)
        Route::post('/assistant/projects', [AiAssistantController::class, 'createProject'])->name('assistant.project.create');
        Route::patch('/assistant/projects/{id}', [AiAssistantController::class, 'updateProject'])->name('assistant.project.update');
        Route::delete('/assistant/projects/{id}', [AiAssistantController::class, 'deleteProject'])->name('assistant.project.destroy');
        Route::get('/assistant/projects/{project}/files', [AiAssistantController::class, 'listProjectFiles'])->name('assistant.project.files');
        Route::post('/assistant/projects/{project}/files', [AiAssistantController::class, 'uploadProjectFile'])->name('assistant.project.files.upload');
        Route::post('/assistant/projects/{project}/folders', [AiAssistantController::class, 'createProjectFolder'])->name('assistant.project.folders.store');
        Route::get('/assistant/projects/{project}/files/{file}', [AiAssistantController::class, 'getProjectFileContent'])->name('assistant.project.files.content');
        Route::patch('/assistant/projects/{project}/files/{file}', [AiAssistantController::class, 'updateProjectFileContent'])->name('assistant.project.files.update');
        Route::get('/assistant/projects/{project}/files/{file}/preview', [AiAssistantController::class, 'previewProjectFile'])->name('assistant.project.files.preview');
        Route::get('/assistant/projects/{project}/files/{file}/download', [AiAssistantController::class, 'downloadProjectFile'])->name('assistant.project.files.download');
        Route::delete('/assistant/projects/{project}/files/{file}', [AiAssistantController::class, 'deleteProjectFile'])->name('assistant.project.files.destroy');

        // Git repo-backed projects
        Route::post('/assistant/projects/from-repo', [AiAssistantController::class, 'createProjectFromRepo'])->name('assistant.project.create.repo');
        Route::post('/assistant/projects/{project}/repo', [AiAssistantController::class, 'connectRepo'])->name('assistant.project.repo.connect');
        Route::post('/assistant/projects/{project}/repo/pull', [AiAssistantController::class, 'pullRepo'])->name('assistant.project.repo.pull');
        Route::post('/assistant/projects/{project}/repo/commit', [AiAssistantController::class, 'commitRepo'])->name('assistant.project.repo.commit');
        Route::get('/assistant/projects/{project}/repo/commits', [AiAssistantController::class, 'repoCommits'])->name('assistant.project.repo.commits');
        Route::get('/assistant/projects/{project}/repo/commits/{hash}', [AiAssistantController::class, 'repoCommitDetail'])->name('assistant.project.repo.commit.detail');
        Route::delete('/assistant/projects/{project}/repo', [AiAssistantController::class, 'disconnectRepo'])->name('assistant.project.repo.disconnect');

        Route::post('/assistant/upload', [AiAssistantController::class, 'upload'])->name('assistant.upload');
        Route::post('/assistant/checkout-summary', [AiAssistantController::class, 'checkoutSummary'])->name('assistant.checkout-summary');
        Route::post('/assistant/execute', [AiAssistantController::class, 'executeAction'])->name('assistant.execute');
        Route::post('/assistant/undo', [AiAssistantController::class, 'undoAction'])->name('assistant.undo');
        Route::post('/assistant/proposal-status', [AiAssistantController::class, 'updateProposalStatus'])->name('assistant.proposal-status');
        Route::get('/assistant/file/{path}', [AiAssistantController::class, 'downloadGeneratedFile'])->name('assistant.file')->where('path', '.*');
        Route::post('/settings/ai/test', [AiAssistantController::class, 'testConnection'])->name('settings.ai.test');

        // AI Training Notes / Persistent Memory (superadmin)
        Route::get('/settings/ai/training-notes', [AiTrainingNoteController::class, 'index'])->name('settings.ai.training-notes');
        Route::post('/settings/ai/training-notes', [AiTrainingNoteController::class, 'store'])->name('settings.ai.training-notes.store');
        Route::get('/settings/ai/training-notes/search', [AiTrainingNoteController::class, 'searchApi'])->name('settings.ai.training-notes.search');
        Route::get('/settings/ai/training-notes/{id}', [AiTrainingNoteController::class, 'showApi'])->name('settings.ai.training-notes.show');
        Route::post('/settings/ai/training-notes/tidy', [AiTrainingNoteController::class, 'tidy'])->name('settings.ai.training-notes.tidy');
        Route::post('/settings/ai/training-notes/settle', [AiTrainingNoteController::class, 'settle'])->name('settings.ai.training-notes.settle');
        Route::post('/settings/ai/training-notes/{id}/restore', [AiTrainingNoteController::class, 'restore'])->name('settings.ai.training-notes.restore');
        Route::post('/settings/ai/training-notes/{id}/toggle', [AiTrainingNoteController::class, 'toggle'])->name('settings.ai.training-notes.toggle');
        Route::post('/settings/ai/training-notes/{id}/kind', [AiTrainingNoteController::class, 'reclassify'])->name('settings.ai.training-notes.kind');
        Route::delete('/settings/ai/training-notes/{id}', [AiTrainingNoteController::class, 'destroy'])->name('settings.ai.training-notes.destroy');

        // AI Skills Library (superadmin) — repo-learned files management
        Route::get('/settings/ai/skills', [AiTrainingNoteController::class, 'skillsIndex'])->name('settings.ai.skills');
        Route::post('/settings/ai/skills', [AiTrainingNoteController::class, 'storeRepo'])->name('settings.ai.skills.store');
        Route::delete('/settings/ai/skills/repo', [AiTrainingNoteController::class, 'destroyRepo'])->name('settings.ai.skills.destroy-repo');
    });

    require __DIR__.'/auth.php';
});
