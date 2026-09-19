import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps } from '@/types';
import { Head, useForm, usePage, Link } from '@inertiajs/react';
import { Transition } from '@headlessui/react';
import { User, Mail, Lock, ShieldAlert, CheckCircle, Eye, EyeOff, Trash2 } from 'lucide-react';
import { FormEventHandler, useState } from 'react';

export default function Edit({
    mustVerifyEmail,
    status,
}: PageProps<{ mustVerifyEmail: boolean; status?: string }>) {
    const authUser = usePage().props.auth.user as any;
    const isKaryawan = authUser.role === 'karyawan';

    const profileForm = useForm({
        name: authUser.name,
        email: authUser.email,
    });

    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const passwordForm = useForm({
        current_password: '',
        password: '',
        password_confirmation: '',
    });

    const deleteForm = useForm({ password: '' });
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const submitProfile: FormEventHandler = (e) => {
        e.preventDefault();
        profileForm.patch(route('profile.update'));
    };

    const submitPassword: FormEventHandler = (e) => {
        e.preventDefault();
        passwordForm.put(route('password.update'), {
            onSuccess: () => passwordForm.reset(),
        });
    };

    const submitDelete: FormEventHandler = (e) => {
        e.preventDefault();
        deleteForm.delete(route('profile.destroy'));
    };

    return (
        <AuthenticatedLayout>
            <Head title="Profile" />

            <div className="py-8">
                <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 space-y-6">

                    {}
                    {isKaryawan && (
                        <div className="flex items-start gap-3 rounded-2xl border border-border/80 bg-muted/50 p-4">
                            <ShieldAlert className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-foreground">Restricted Access</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    As a team member, profile information and password changes are managed by administrators. Please contact your store manager.
                                </p>
                            </div>
                        </div>
                    )}

                    {}
                    <div className="apple-card p-6 text-card-foreground space-y-5">
                        <div className="flex items-center gap-3 border-b border-border/60 pb-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
                                <User className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Profile Information</h3>
                                <p className="text-xs text-muted-foreground">Account name and registered email address.</p>
                            </div>
                        </div>

                        {}
                        {isKaryawan ? (
                            <div className="space-y-4">
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold tracking-wider text-muted-foreground">Full Name</p>
                                    <p className="text-sm font-bold text-foreground">{authUser.name}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold tracking-wider text-muted-foreground">Email</p>
                                    <p className="text-sm font-bold text-foreground">{authUser.email}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold tracking-wider text-muted-foreground">Role</p>
                                    <span className="inline-flex rounded-full px-3 py-0.5 text-xs font-semibold bg-primary/10 text-primary border border-primary/20 capitalize">
                                        {authUser.role}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={submitProfile} className="space-y-4">
                                <div>
                                    <label htmlFor="name" className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">
                                        Full Name
                                    </label>
                                    <input
                                        id="name"
                                        type="text"
                                        required
                                        value={profileForm.data.name}
                                        onChange={(e) => profileForm.setData('name', e.target.value)}
                                        className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
                                    />
                                    {profileForm.errors.name && (
                                        <p className="mt-1 text-xs text-destructive">{profileForm.errors.name}</p>
                                    )}
                                </div>

                                <div>
                                    <label htmlFor="email" className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">
                                        Email Address
                                    </label>
                                    <input
                                        id="email"
                                        type="email"
                                        required
                                        value={profileForm.data.email}
                                        onChange={(e) => profileForm.setData('email', e.target.value)}
                                        className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
                                    />
                                    {profileForm.errors.email && (
                                        <p className="mt-1 text-xs text-destructive">{profileForm.errors.email}</p>
                                    )}
                                </div>

                                {mustVerifyEmail && authUser.email_verified_at === null && (
                                    <div className="rounded-xl bg-muted/40 border border-border/60 p-3">
                                        <p className="text-xs text-muted-foreground">
                                            Your email address is unverified.{' '}
                                            <Link
                                                href={route('verification.send')}
                                                method="post"
                                                as="button"
                                                className="underline font-semibold text-primary"
                                            >
                                                Click here to re-send verification email.
                                            </Link>
                                        </p>
                                        {status === 'verification-link-sent' && (
                                            <p className="text-xs font-semibold text-emerald-600 mt-1">A new verification link has been sent.</p>
                                        )}
                                    </div>
                                )}

                                <div className="flex items-center gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={profileForm.processing}
                                        className="rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                                    >
                                        {profileForm.processing ? 'Saving...' : 'Save Changes'}
                                    </button>
                                    <Transition
                                        show={profileForm.recentlySuccessful}
                                        enter="transition ease-in-out"
                                        enterFrom="opacity-0"
                                        leave="transition ease-in-out"
                                        leaveTo="opacity-0"
                                    >
                                        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                                            <CheckCircle className="h-4 w-4" /> Saved
                                        </span>
                                    </Transition>
                                </div>
                            </form>
                        )}
                    </div>

                    {}
                    {!isKaryawan && (
                        <div className="apple-card p-6 text-card-foreground space-y-5">
                            <div className="flex items-center gap-3 border-b border-border/60 pb-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
                                    <Lock className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Update Password</h3>
                                    <p className="text-xs text-muted-foreground">Ensure your account is using a long, secure password.</p>
                                </div>
                            </div>

                            <form onSubmit={submitPassword} className="space-y-4">
                                {}
                                <div>
                                    <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Current Password</label>
                                    <div className="relative">
                                        <input
                                            type={showCurrent ? 'text' : 'password'}
                                            required
                                            value={passwordForm.data.current_password}
                                            onChange={(e) => passwordForm.setData('current_password', e.target.value)}
                                            className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 pr-10 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
                                        />
                                        <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
                                            {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {passwordForm.errors.current_password && (
                                        <p className="mt-1 text-xs text-destructive">{passwordForm.errors.current_password}</p>
                                    )}
                                </div>

                                {}
                                <div>
                                    <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">New Password</label>
                                    <div className="relative">
                                        <input
                                            type={showNew ? 'text' : 'password'}
                                            required
                                            value={passwordForm.data.password}
                                            onChange={(e) => passwordForm.setData('password', e.target.value)}
                                            className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 pr-10 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
                                        />
                                        <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
                                            {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {passwordForm.errors.password && (
                                        <p className="mt-1 text-xs text-destructive">{passwordForm.errors.password}</p>
                                    )}
                                </div>

                                {}
                                <div>
                                    <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Confirm New Password</label>
                                    <div className="relative">
                                        <input
                                            type={showConfirm ? 'text' : 'password'}
                                            required
                                            value={passwordForm.data.password_confirmation}
                                            onChange={(e) => passwordForm.setData('password_confirmation', e.target.value)}
                                            className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 pr-10 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
                                        />
                                        <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground">
                                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {passwordForm.errors.password_confirmation && (
                                        <p className="mt-1 text-xs text-destructive">{passwordForm.errors.password_confirmation}</p>
                                    )}
                                </div>

                                <div className="flex items-center gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={passwordForm.processing}
                                        className="rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                                    >
                                        {passwordForm.processing ? 'Updating...' : 'Update Password'}
                                    </button>
                                    <Transition
                                        show={passwordForm.recentlySuccessful}
                                        enter="transition ease-in-out"
                                        enterFrom="opacity-0"
                                        leave="transition ease-in-out"
                                        leaveTo="opacity-0"
                                    >
                                        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                                            <CheckCircle className="h-4 w-4" /> Password Updated
                                        </span>
                                    </Transition>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </AuthenticatedLayout>
    );
}

