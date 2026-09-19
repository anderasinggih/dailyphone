import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm } from '@inertiajs/react';
import { useState } from 'react';
import {
    User as UserIcon,
    Plus,
    Edit,
    Trash2,
    Shield,
    Mail,
    Store as StoreIcon,
    Calendar,
    Key
} from 'lucide-react';

interface Store {
    id: number;
    name: string;
}

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
    store_id: number | null;
    created_at: string;
    store?: Store;
}

interface IndexProps {
    users: User[];
    stores: Store[];
}

export default function Index({ users, stores }: IndexProps) {
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);

    const addForm = useForm({
        name: '',
        email: '',
        password: '',
        role: 'karyawan',
        store_id: '' as string | number
    });

    const editForm = useForm({
        name: '',
        email: '',
        password: '',
        role: 'karyawan',
        store_id: '' as string | number
    });

    const submitAdd = (e: React.FormEvent) => {
        e.preventDefault();
        addForm.post(route('users.store'), {
            onSuccess: () => {
                setIsAddOpen(false);
                addForm.reset();
            }
        });
    };

    const submitEdit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingUser) return;
        editForm.patch(route('users.update', editingUser.id), {
            onSuccess: () => {
                setEditingUser(null);
            }
        });
    };

    const deleteUser = (user: User) => {
        if (confirm(`Are you sure you want to delete user ${user.name}?`)) {
            useForm().delete(route('users.destroy', user.id), {
                onError: (errors: any) => {
                    if (errors.error) {
                        alert(errors.error);
                    }
                }
            });
        }
    };

    const openEdit = (user: User) => {
        setEditingUser(user);
        editForm.setData({
            name: user.name,
            email: user.email,
            password: '',
            role: user.role,
            store_id: user.store_id || ''
        });
    };

    return (
        <AuthenticatedLayout
            header={
                <div className="flex flex-col justify-end gap-4 sm:flex-row sm:items-center w-full">
                    <button
                        onClick={() => setIsAddOpen(true)}
                        className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] transition shadow-sm"
                    >
                        <Plus className="h-4 w-4" /> Add User
                    </button>
                </div>
            }
        >
            <Head title="Staff & User Management" />

            <div className="py-8">
                <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 space-y-8">

                    {}
                    <div className="apple-card p-5 text-card-foreground">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] text-left border-collapse text-sm">
                                <thead>
                                    <tr className="border-b border-border/60 text-[11px] font-semibold tracking-wider text-muted-foreground">
                                        <th className="pb-3 font-semibold">User Name</th>
                                        <th className="pb-3 font-semibold">Email</th>
                                        <th className="pb-3 font-semibold">Role</th>
                                        <th className="pb-3 font-semibold">Store Branch</th>
                                        <th className="pb-3 font-semibold">Created Date</th>
                                        <th className="pb-3 font-semibold text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40 text-sm font-medium text-foreground">
                                    {users.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-8 text-center text-muted-foreground">No users registered yet.</td>
                                        </tr>
                                    ) : (
                                        users.map((user) => (
                                            <tr key={user.id} className="hover:bg-muted/50 dark:hover:bg-gray-900/50">
                                                <td className="py-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="rounded-full bg-muted p-2">
                                                            <UserIcon className="h-4 w-4 text-muted-foreground" />
                                                        </div>
                                                        <span className="font-semibold text-foreground">{user.name}</span>
                                                    </div>
                                                </td>
                                                <td className="py-4">
                                                    <span className="flex items-center gap-1">
                                                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                                        {user.email}
                                                    </span>
                                                </td>
                                                <td className="py-4">
                                                    <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-bold ${
                                                        user.role === 'superadmin'
                                                            ? 'bg-destructive/10 text-destructive border border-destructive/20'
                                                            : user.role === 'karyawan'
                                                                ? 'bg-primary/10 text-primary border border-primary/20'
                                                                : 'bg-muted text-muted-foreground border border-border'
                                                    }`}>
                                                        <Shield className="h-3 w-3" />
                                                        {user.role === 'karyawan' ? 'Staff' : user.role === 'superadmin' ? 'Superadmin' : 'Viewer'}
                                                    </span>
                                                </td>
                                                <td className="py-4">
                                                    <span className="flex items-center gap-1 font-semibold">
                                                        <StoreIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                                        {user.store?.name || 'All Branches (Global)'}
                                                    </span>
                                                </td>
                                                <td className="py-4 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-3.5 w-3.5" />
                                                        {new Date(user.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                    </span>
                                                </td>
                                                <td className="py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => openEdit(user)}
                                                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-primary transition"
                                                            title="Edit User"
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => deleteUser(user)}
                                                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                                                            title="Delete User"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </div>

            {}
            {isAddOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
                        <h4 className="text-lg font-bold text-foreground">Add New User</h4>
                        <p className="text-xs text-muted-foreground mt-1 mb-4">Create access credentials for staff or viewer.</p>

                        <form onSubmit={submitAdd} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Full Name</label>
                                <input
                                    type="text"
                                    required
                                    value={addForm.data.name}
                                    onChange={e => addForm.setData('name', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                    placeholder="Full Name"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Email</label>
                                <input
                                    type="email"
                                    required
                                    value={addForm.data.email}
                                    onChange={e => addForm.setData('email', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                    placeholder="user@dailyphone.com"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Password</label>
                                <input
                                    type="password"
                                    required
                                    value={addForm.data.password}
                                    onChange={e => addForm.setData('password', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                    placeholder="••••••••"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Role</label>
                                    <select
                                        value={addForm.data.role}
                                        onChange={e => addForm.setData('role', e.target.value)}
                                        className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                    >
                                        <option value="karyawan">Staff (Cashier)</option>
                                        <option value="viewer">Viewer (Owner)</option>
                                        <option value="superadmin">Superadmin</option>
                                    </select>
                                </div>

                                {addForm.data.role !== 'superadmin' && (
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground mb-1">Branch</label>
                                        <select
                                            required
                                            value={addForm.data.store_id}
                                            onChange={e => addForm.setData('store_id', e.target.value)}
                                            className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                        >
                                            <option value="">-- Select Branch --</option>
                                            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-border">
                                <button
                                    type="button"
                                    onClick={() => setIsAddOpen(false)}
                                    className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={addForm.processing}
                                    className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm"
                                >
                                    Save User
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {}
            {editingUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl border border-border">
                        <h4 className="text-lg font-bold text-foreground">Edit User</h4>
                        <p className="text-xs text-muted-foreground mt-1 mb-4">Update role or branch association.</p>

                        <form onSubmit={submitEdit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Full Name</label>
                                <input
                                    type="text"
                                    required
                                    value={editForm.data.name}
                                    onChange={e => editForm.setData('name', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">Email</label>
                                <input
                                    type="email"
                                    required
                                    value={editForm.data.email}
                                    onChange={e => editForm.setData('email', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-muted-foreground mb-1">New Password (Leave blank to keep current)</label>
                                <input
                                    type="password"
                                    value={editForm.data.password}
                                    onChange={e => editForm.setData('password', e.target.value)}
                                    className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                    placeholder="••••••••"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground mb-1">Role</label>
                                    <select
                                        value={editForm.data.role}
                                        onChange={e => editForm.setData('role', e.target.value)}
                                        className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                    >
                                        <option value="karyawan">Staff (Cashier)</option>
                                        <option value="viewer">Viewer (Owner)</option>
                                        <option value="superadmin">Superadmin</option>
                                    </select>
                                </div>

                                {editForm.data.role !== 'superadmin' && (
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground mb-1">Branch</label>
                                        <select
                                            required
                                            value={editForm.data.store_id}
                                            onChange={e => editForm.setData('store_id', e.target.value)}
                                            className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm font-semibold dark:bg-background"
                                        >
                                            <option value="">-- Select Branch --</option>
                                            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-border">
                                <button
                                    type="button"
                                    onClick={() => setEditingUser(null)}
                                    className="flex-1 rounded-xl border border-input py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={editForm.processing}
                                    className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition shadow-sm"
                                >
                                    Update User
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}

