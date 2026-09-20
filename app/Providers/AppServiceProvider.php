<?php

namespace App\Providers;

use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Reverb is excluded from package auto-discovery (Laravel 13 forbids
        // vendor packages from self-registering dev commands), so it must be
        // registered from application code — the backtrace is then userland and
        // the guard allows Reverb's internal `reverb:start` dev-command hook.
        // Both providers listed in reverb's composer discover manifest need to
        // be re-created here, since `dont-discover` skips the whole package.
        foreach ([
            \Laravel\Reverb\ApplicationManagerServiceProvider::class,
            \Laravel\Reverb\ReverbServiceProvider::class,
        ] as $provider) {
            if (! $this->app->getProvider($provider)) {
                $this->app->register($provider);
            }
        }
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Vite::prefetch(concurrency: 3);
    }
}
