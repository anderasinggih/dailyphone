<?php

namespace App\Http\Controllers;

use App\Models\GeneralSetting;
use App\Models\EmployeeSchedule;
use App\Models\User;
use App\Models\Store;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Illuminate\Http\RedirectResponse;

class GeneralSettingsController extends Controller
{
    public function index(Request $request): Response
    {
        // Enforce superadmin access
        if ($request->user()->role !== 'superadmin') {
            abort(403, 'Unauthorized action.');
        }

        $settings = GeneralSetting::first() ?? GeneralSetting::create([
            'company_name' => 'Daily Phone',
            'work_start_time' => '09:00:00',
            'work_end_time' => '18:00:00',
            'grace_period_minutes' => 15,
            'geofence_lock_enabled' => true,
            'notification_emails' => null,
        ]);

        $schedules = EmployeeSchedule::with(['user', 'store'])->get();
        $employees = User::where('role', 'karyawan')->get();
        $stores = Store::all();

        return Inertia::render('Settings/General', [
            'settings' => $settings,
            'schedules' => $schedules,
            'employees' => $employees,
            'stores' => $stores,
        ]);
    }

    public function update(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403);
        }

        $section = $request->input('section');
        $settings = GeneralSetting::first() ?? new GeneralSetting();

        if ($section === 'company') {
            $validated = $request->validate([
                'company_name' => 'required|string|max:255',
                'notification_emails' => 'nullable|string',
            ]);
            $settings->fill($validated);
            $settings->save();
            return redirect()->back()->with('success', 'Company identity and notification settings saved.');
        }

        if ($section === 'work_policy') {
            $validated = $request->validate([
                'work_start_time' => 'required|string',
                'work_end_time' => 'required|string',
                'grace_period_minutes' => 'required|integer|min:0',
            ]);
            $settings->fill($validated);
            $settings->save();
            return redirect()->back()->with('success', 'Working hours and late grace policy saved.');
        }

        if ($section === 'geofence') {
            $validated = $request->validate([
                'geofence_lock_enabled' => 'required|boolean',
            ]);
            $settings->fill($validated);
            $settings->save();
            return redirect()->back()->with('success', 'Geofence security lock preference saved.');
        }

        if ($section === 'ai') {
            $validated = $request->validate([
                'ai_enabled' => 'nullable|boolean',
                'ai_provider' => 'nullable|string',
                'ai_api_key' => 'nullable|string',
                'ai_model' => 'nullable|string',
                'ai_system_instruction' => 'nullable|string',
            ]);

            $data = $request->only([
                'ai_enabled',
                'ai_provider',
                'ai_model',
                'ai_system_instruction',
            ]);

            if ($request->filled('ai_api_key')) {
                $data['ai_api_key'] = $request->input('ai_api_key');
            } elseif ($request->has('clear_ai_api_key') && $request->boolean('clear_ai_api_key')) {
                $data['ai_api_key'] = null;
            }

            $settings->fill($data);
            $settings->save();
            return redirect()->back()->with('success', 'AI Intelligence configuration saved.');
        }

        // Fallback for full update
        $request->validate([
            'company_name' => 'required|string|max:255',
            'work_start_time' => 'required|string',
            'work_end_time' => 'required|string',
            'grace_period_minutes' => 'required|integer|min:0',
            'geofence_lock_enabled' => 'required|boolean',
            'notification_emails' => 'nullable|string',
            'ai_enabled' => 'nullable|boolean',
            'ai_provider' => 'nullable|string',
            'ai_api_key' => 'nullable|string',
            'ai_model' => 'nullable|string',
            'ai_system_instruction' => 'nullable|string',
        ]);

        $data = $request->only([
            'company_name',
            'work_start_time',
            'work_end_time',
            'grace_period_minutes',
            'geofence_lock_enabled',
            'notification_emails',
            'ai_enabled',
            'ai_provider',
            'ai_model',
            'ai_system_instruction',
        ]);

        if ($request->filled('ai_api_key')) {
            $data['ai_api_key'] = $request->input('ai_api_key');
        } elseif ($request->has('clear_ai_api_key') && $request->boolean('clear_ai_api_key')) {
            $data['ai_api_key'] = null;
        }

        $settings->fill($data);
        $settings->save();

        return redirect()->back()->with('success', 'Settings updated successfully.');
    }

    public function storeSchedule(Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403);
        }

        $request->validate([
            'user_id' => 'required|exists:users,id',
            'store_id' => 'required|exists:stores,id',
            'work_start_time' => 'nullable|string',
            'work_end_time' => 'nullable|string',
            'grace_period_minutes' => 'nullable|integer|min:0',
        ]);

        $workStart = $request->work_start_time;
        if ($workStart && strlen($workStart) === 5) {
            $workStart .= ':00';
        }

        $workEnd = $request->work_end_time;
        if ($workEnd && strlen($workEnd) === 5) {
            $workEnd .= ':00';
        }

        EmployeeSchedule::updateOrCreate(
            [
                'user_id' => $request->user_id,
                'store_id' => $request->store_id,
            ],
            [
                'work_start_time' => $workStart,
                'work_end_time' => $workEnd,
                'grace_period_minutes' => $request->grace_period_minutes,
            ]
        );

        return redirect()->back()->with('success', 'Jadwal shift karyawan berhasil disimpan.');
    }

    public function destroySchedule(EmployeeSchedule $schedule, Request $request): RedirectResponse
    {
        if ($request->user()->role !== 'superadmin') {
            abort(403);
        }

        $schedule->delete();

        return redirect()->back()->with('success', 'Jadwal shift karyawan berhasil dihapus.');
    }
}
