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
            'landing_enabled' => true,
            'landing_tagline' => 'iPhone Berkualitas. Harga Jujur.',
            'landing_description' => 'iPhone baru dan terawat dengan harga bersahabat — setiap unit terjamin kualitas, bergaransi resmi, dan siap tukar tambah.',
            'instagram_handle' => 'dailyphone.store',
            'instagram_url' => 'https://www.instagram.com/dailyphone.store/',
            'whatsapp_number' => '0881010229772',
            'store_address' => 'Pekojan, Jakarta Barat',
            'instagram_embeds' => [],
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
                'ai_api_keys' => 'nullable|array',
                'ai_api_keys.*' => 'nullable|string',
                'ai_model' => 'nullable|string',
                'ai_system_instruction' => 'nullable|string',
                'ai_embedding_model' => 'nullable|string',
                'ai_tools_enabled' => 'nullable|boolean',
                'ai_grounding_enabled' => 'nullable|boolean',
                'ai_tool_combo' => 'nullable|boolean',
                'ai_retrieval_top_k' => 'nullable|integer|min:3|max:80',
                'ai_retrieval_min_score' => 'nullable|numeric|min:0|max:1',
                'ai_context_token_budget' => 'nullable|integer|min:1000|max:1000000',
            ]);

            $data = $request->only([
                'ai_enabled',
                'ai_provider',
                'ai_model',
                'ai_system_instruction',
                'ai_embedding_model',
                'ai_retrieval_top_k',
                'ai_retrieval_min_score',
                'ai_context_token_budget',
            ]);

            // Toggles: unchecked checkboxes arrive absent, so default each to its
            // blessed default rather than silently flipping to false.
            $data['ai_tools_enabled'] = $request->has('ai_tools_enabled')
                ? $request->boolean('ai_tools_enabled') : true;
            $data['ai_grounding_enabled'] = $request->has('ai_grounding_enabled')
                ? $request->boolean('ai_grounding_enabled') : true;
            $data['ai_tool_combo'] = $request->has('ai_tool_combo')
                ? $request->boolean('ai_tool_combo') : true;

            if ($request->filled('ai_api_key')) {
                $data['ai_api_key'] = $request->input('ai_api_key');
            } elseif ($request->has('clear_ai_api_key') && $request->boolean('clear_ai_api_key')) {
                $data['ai_api_key'] = null;
            }

            if ($request->has('ai_api_keys')) {
                $data['ai_api_keys'] = array_values(array_map(
                    fn ($key) => trim((string)$key),
                    (array)$request->input('ai_api_keys', [])
                ));
            }

            $settings->fill($data);
            $settings->save();
            return redirect()->back()->with('success', 'AI Intelligence configuration saved.');
        }

        if ($section === 'landing') {
            $request->validate([
                'landing_tagline' => 'nullable|string|max:255',
                'landing_description' => 'nullable|string',
                'instagram_handle' => 'nullable|string|max:255',
                'instagram_url' => 'nullable|string|max:255',
                'whatsapp_number' => 'nullable|string|max:30',
                'store_address' => 'nullable|string|max:255',
                'instagram_embeds' => 'nullable|array',
                'instagram_embeds.*' => 'nullable|string',
            ]);

            $data = $request->only([
                'landing_tagline',
                'landing_description',
                'instagram_handle',
                'instagram_url',
                'whatsapp_number',
                'store_address',
            ]);

            // Toggle: unchecked checkbox arrives absent, default to keeping it enabled.
            $data['landing_enabled'] = $request->has('landing_enabled')
                ? $request->boolean('landing_enabled') : true;

            if ($request->has('instagram_embeds')) {
                $data['instagram_embeds'] = array_values(array_filter(array_map(
                    fn ($link) => trim((string)$link),
                    (array)$request->input('instagram_embeds', [])
                ), fn ($link) => $link !== ''));
            }

            $settings->fill($data);
            $settings->save();
            return redirect()->back()->with('success', 'Landing page content and Instagram embeds saved.');
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
            'ai_api_keys' => 'nullable|array',
            'ai_api_keys.*' => 'nullable|string',
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

        if ($request->has('ai_api_keys')) {
            $data['ai_api_keys'] = array_values(array_map(
                fn ($key) => trim((string)$key),
                (array)$request->input('ai_api_keys', [])
            ));
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
