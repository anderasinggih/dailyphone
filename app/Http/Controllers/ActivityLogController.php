<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ActivityLogController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();
        $query = ActivityLog::with(['user.store']);

        // Filter saved only
        if ($request->boolean('saved_only')) {
            $query->whereHas('savedByUsers', function ($q) use ($user) {
                $q->where('users.id', $user->id);
            });
        }

        // Apply search query
        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->where(function($q) use ($search) {
                $q->where('action', 'like', "%{$search}%")
                  ->orWhere('ip_address', 'like', "%{$search}%")
                  ->orWhereHas('user', function($uq) use ($search) {
                      $uq->where('name', 'like', "%{$search}%")
                         ->orWhere('email', 'like', "%{$search}%");
                  });
            });
        }

        // Apply action filter
        if ($request->filled('action_type')) {
            $query->where('action', $request->input('action_type'));
        }

        // Apply date filter
        if ($request->filled('date')) {
            $query->whereDate('created_at', $request->input('date'));
        }

        $activities = $query->orderBy('created_at', 'desc')
            ->paginate(50)
            ->withQueryString();

        // Attach is_saved flag
        $savedIds = $user->savedActivities()->pluck('activity_logs.id')->flip()->all();
        $activities->getCollection()->transform(function ($activity) use ($savedIds) {
            $activity->is_saved = isset($savedIds[$activity->id]);
            return $activity;
        });

        return Inertia::render('Timeline/Index', [
            'activities' => $activities,
            'filters' => array_merge(
                $request->only(['search', 'action_type', 'date']),
                ['saved_only' => $request->boolean('saved_only')]
            ),
        ]);
    }

    public function toggleSave(Request $request, ActivityLog $activityLog)
    {
        $user = $request->user();
        $alreadySaved = $user->savedActivities()->where('activity_logs.id', $activityLog->id)->exists();

        if ($alreadySaved) {
            $user->savedActivities()->detach($activityLog->id);
        } else {
            $user->savedActivities()->attach($activityLog->id);
        }

        return redirect()->back();
    }
}
