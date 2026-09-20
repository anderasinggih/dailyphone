<?php

use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| The AI is a superadmin-only tool, so the live brain map only ever needs to
| reach the superadmin. Every tab they have open (assistant + memory map)
| shares this private channel; a chat running in one tab pulses the map in
| the others in real time.
|
*/

Broadcast::channel('superadmin.live', function ($user) {
    return $user && $user->role === 'superadmin';
});