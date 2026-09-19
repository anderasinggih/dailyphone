import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, useForm, router, usePage } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import {
    Clock,
    Coins,
    MapPin,
    DollarSign,
    ArrowUpRight,
    ArrowDownLeft,
    History,
    ShieldAlert,
    AlertCircle,
    CheckCircle,
    UserCheck,
    Navigation,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import StatCard from '@/Components/StatCard';

interface Store {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    geofence_radius: number;
    address: string;
}

interface Shift {
    id: number;
    store_id: number;
    user_id: number;
    start_cash: number;
    end_cash: number | null;
    expected_end_cash: number | null;
    difference: number | null;
    status: 'open' | 'closed';
    opened_at: string;
    closed_at: string | null;
    late_minutes?: number;
    total_omset?: number;
    total_profit?: number;
    store?: Store;
    user?: { name: string };
    petty_cash?: Array<{
        id: number;
        type: 'in' | 'out' | 'drop';
        amount: number | string;
        description: string;
    }>;
}

interface Attendance {
    id: number;
    store_id: number;
    user_id: number;
    clock_in: string;
    clock_out: string | null;
    status: string;
}

interface AttendanceStat {
    user_id: number;
    total_days: number;
    total_late_minutes: string | number;
    total_work_minutes: string | number;
    user?: {
        id: number;
        name: string;
        role: string;
    };
}

interface Payroll {
    id: number;
    user_id: number;
    month: number;
    year: number;
    basic_salary: number;
    commission: number;
    allowance: number;
    deductions: number;
    net_salary: number;
    notes: string | null;
    created_at: string;
    user?: { id: number; name: string };
}

interface ShiftAttendanceProps {
    activeShift: Shift | null;
    activeAttendance: Attendance | null;
    myStore: Store | null;
    shifts: Shift[];
    attendanceStats: AttendanceStat[] | AttendanceStat | null;
    payrolls?: Payroll[];
    employees?: Array<{ id: number; name: string; role: string }>;
    filters?: {
        month: number;
        year: number;
    };
}

export default function ShiftAttendance({ activeShift, activeAttendance, myStore, shifts, attendanceStats, payrolls = [], employees = [], filters }: ShiftAttendanceProps) {
    const authUser = usePage().props.auth.user as any;
    const isSuperAdmin = authUser.role === 'superadmin';
    const isViewer = authUser.role === 'viewer';
    const canManageShifts = authUser.role === 'superadmin';
    const canSeeAllShifts = ['superadmin', 'viewer'].includes(authUser.role);
    const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [gpsError, setGpsError] = useState<string | null>(null);
    const [gpsLoading, setGpsLoading] = useState(false);

    const clockInForm = useForm({
        start_cash: 0,
        latitude: '',
        longitude: ''
    });

    const clockOutForm = useForm({
        end_cash: 0,
        latitude: '',
        longitude: ''
    });

    const pettyForm = useForm({
        type: 'out' as 'in' | 'out',
        amount: 0,
        description: ''
    });

    const [editingShift, setEditingShift] = useState<Shift | null>(null);
    const editForm = useForm({
        start_cash: 0,
        end_cash: 0,
        status: 'closed' as 'open' | 'closed',
        opened_at: '',
        closed_at: '',
    });

    const [shiftPage, setShiftPage] = useState(1);
    const shiftsPerPage = 10;
    const totalShiftPages = Math.ceil(shifts.length / shiftsPerPage) || 1;
    const paginatedShifts = shifts.slice((shiftPage - 1) * shiftsPerPage, shiftPage * shiftsPerPage);

    const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
    const [printingPayroll, setPrintingPayroll] = useState<Payroll | null>(null);
    const payrollForm = useForm({
        user_id: '',
        month: filters?.month || (new Date().getMonth() + 1),
        year: filters?.year || new Date().getFullYear(),
        basic_salary: '' as string | number,
        commission: '' as string | number,
        allowance: '' as string | number,
        deductions: '' as string | number,
        notes: '',
    });

    const openPayrollModal = (userId?: number) => {
        const targetUserId = userId ? String(userId) : (employees[0]?.id ? String(employees[0].id) : '');
        const existing = payrolls.find(p => String(p.user_id) === targetUserId);

        payrollForm.setData({
            user_id: targetUserId,
            month: filters?.month || (new Date().getMonth() + 1),
            year: filters?.year || new Date().getFullYear(),
            basic_salary: existing ? existing.basic_salary : '',
            commission: existing ? existing.commission : '',
            allowance: existing ? existing.allowance : '',
            deductions: existing ? existing.deductions : '',
            notes: existing ? (existing.notes || '') : '',
        });
        setIsPayrollModalOpen(true);
    };

    const submitPayroll = (e: React.FormEvent) => {
        e.preventDefault();
        payrollForm.post(route('shifts.payroll.store'), {
            onSuccess: () => {
                setIsPayrollModalOpen(false);
                alert('Employee salary payslip saved successfully!');
            }
        });
    };

    const startEdit = (sh: Shift) => {
        setEditingShift(sh);

        const formatForInput = (dateStr: string | null) => {
            if (!dateStr) return '';
            const d = new Date(dateStr);

            const tzoffset = d.getTimezoneOffset() * 60000;
            const localISOTime = (new Date(d.getTime() - tzoffset)).toISOString().slice(0, 16);
            return localISOTime;
        };

        editForm.setData({
            start_cash: sh.start_cash,
            end_cash: sh.end_cash || 0,
            status: sh.status,
            opened_at: formatForInput(sh.opened_at),
            closed_at: formatForInput(sh.closed_at),
        });
    };

    const submitEdit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingShift) return;
        editForm.put(route('shifts.update', editingShift.id), {
            onSuccess: () => {
                setEditingShift(null);
                alert('Shift updated successfully.');
            },
            onError: (errs) => {
                alert(Object.values(errs).join('\n'));
            }
        });
    };

    const handleDelete = (id: number) => {
        if (confirm('Are you sure you want to delete this shift record and its attendance data?')) {
            router.delete(route('shifts.destroy', id), {
                onSuccess: () => {
                    alert('Shift and associated attendance record deleted successfully.');
                },
                onError: (errs) => {
                    alert(Object.values(errs).join('\n'));
                }
            });
        }
    };

    const getGpsLocation = () => {
        if (!navigator.geolocation) {
            setGpsError('Your browser does not support geolocation detection.');
            return;
        }

        setGpsLoading(true);
        setGpsError(null);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                setGpsCoords({ lat, lng });

                clockInForm.setData(prev => ({ ...prev, latitude: lat.toString(), longitude: lng.toString() }));
                clockOutForm.setData(prev => ({ ...prev, latitude: lat.toString(), longitude: lng.toString() }));

                setGpsLoading(false);
            },
            (error) => {
                console.error(error);
                setGpsError('Failed to detect GPS coordinates. Please allow location permissions in your browser.');
                setGpsLoading(false);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    };

    useEffect(() => {
        getGpsLocation();
    }, []);

    const submitClockIn = (e: React.FormEvent) => {
        e.preventDefault();
        if (!gpsCoords) {
            alert('GPS coordinates not yet acquired. Please reload the page or click "Acquire GPS".');
            return;
        }
        clockInForm.post(route('shifts.clock-in'), {
            onSuccess: () => {
                alert('Clock-in recorded and shift opened successfully.');
            },
            onError: (errs) => {
                alert(errs.error || Object.values(errs).join('\n'));
            }
        });
    };

    const submitClockOut = (e: React.FormEvent) => {
        e.preventDefault();
        if (!gpsCoords) {
            alert('GPS coordinates not yet acquired. Please reload the page or click "Acquire GPS".');
            return;
        }
        clockOutForm.post(route('shifts.clock-out'), {
            onSuccess: () => {
                alert('Shift closed and clock-out recorded successfully.');
            },
            onError: (errs) => {
                alert(errs.error || Object.values(errs).join('\n'));
            }
        });
    };

    const submitPettyOrDrop = (e: React.FormEvent) => {
        e.preventDefault();
        pettyForm.post(route('shifts.petty-cash'), {
            onSuccess: () => {
                pettyForm.reset();
                alert('Petty cash / cash drawer entry recorded successfully.');
            },
            onError: (errs) => {
                alert(errs.error || Object.values(errs).join('\n'));
            }
        });
    };

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    return (
        <AuthenticatedLayout>
            <Head title="GPS Attendance & Cashier Shifts" />

            <div className="py-8">
                <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 space-y-8">

                    {}
                    {!isViewer && (
                        <div className="apple-card p-5 text-card-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className={`rounded-2xl p-3 ${gpsCoords ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-primary/10 text-primary'}`}>
                                    <Navigation className={`h-6 w-6 ${gpsLoading ? 'animate-spin' : ''}`} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-foreground">GPS Location Detection</h4>
                                    {gpsCoords ? (
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                                            Coordinates Located: {gpsCoords.lat.toFixed(6)}, {gpsCoords.lng.toFixed(6)}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-muted-foreground font-medium">
                                            {gpsError || 'Acquiring high-accuracy satellite coordinates...'}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={getGpsLocation}
                                className="rounded-xl border border-border/60 px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition"
                            >
                                Refresh GPS
                            </button>
                        </div>
                    )}

                    {}
                    {!isViewer && (
                        myStore ? (
                            <div className="apple-card p-4 text-xs font-medium text-muted-foreground flex flex-col md:flex-row justify-between gap-4">
                                <div>
                                    <p className="text-foreground font-semibold">Assigned Branch: {myStore.name}</p>
                                    <p className="text-[11px] text-muted-foreground mt-1">Address: {myStore.address}</p>
                                </div>
                                <div>
                                    <p className="text-foreground font-semibold text-right">Geofence Radius: {myStore.geofence_radius} Meters</p>
                                    <p className="text-[11px] text-muted-foreground mt-1 text-right">Target Coordinates: {myStore.latitude}, {myStore.longitude}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-2xl bg-muted/60 border border-border/80 p-4 text-xs font-medium text-muted-foreground flex items-center gap-3">
                                <ShieldAlert className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                                <div>
                                    <p className="font-semibold text-foreground">Your account is not assigned to any store branch yet.</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Please contact your store manager or assign a branch store to your account in <a href="/users" className="underline text-primary">Manage Users</a> to enable attendance clock-in.
                                    </p>
                                </div>
                            </div>
                        )
                    )}

                    {!isViewer && (
                        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                            {}
                            <div className="lg:col-span-2 space-y-6">

                            {}
                            {!activeShift ? (
                                <div className="apple-card p-6 text-card-foreground">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                            <UserCheck className="h-5 w-5" />
                                        </div>
                                        <h3 className="text-lg font-semibold text-foreground">Open Cashier Shift & Clock In</h3>
                                    </div>
                                    <p className="text-xs text-muted-foreground mb-6">Start your work hours and open the shift register.</p>

                                    <form onSubmit={submitClockIn} className="space-y-4">
                                        <button
                                            type="submit"
                                            disabled={clockInForm.processing || gpsLoading || !myStore}
                                            className={`w-full rounded-2xl py-4 text-sm font-semibold text-primary-foreground shadow-sm transition active:scale-[0.98] flex items-center justify-center gap-2 ${!myStore ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary hover:opacity-90'}`}
                                        >
                                            <UserCheck className="h-5 w-5" />
                                            {!myStore ? 'Branch Store Not Assigned' : clockInForm.processing ? 'Recording Attendance...' : 'Clock In & Start Shift'}
                                        </button>
                                    </form>
                                </div>
                            ) : (

                                <div className="space-y-6">

                                    {}
                                    <div className="rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm relative overflow-hidden">
                                        <div className="relative z-10 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <span className="rounded-xl bg-white/20 px-2.5 py-1 text-[11px] font-semibold tracking-wider">Active Shift</span>
                                                <span className="text-xs font-semibold text-white/90">Started: {new Date(activeShift.opened_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        </div>
                                        <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-white/10" />
                                    </div>

                                     {}
                                     <div className="apple-card p-6 text-card-foreground">
                                         <div className="flex items-center gap-2 mb-4">
                                             <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                                 <Coins className="h-5 w-5" />
                                             </div>
                                             <h3 className="text-lg font-semibold text-foreground">Petty Cash & Small Expenses</h3>
                                         </div>
                                         <p className="text-xs text-muted-foreground mb-6">Log branch operational expenses (e.g. transport, supplies) or incoming petty petty cash.</p>

                                         <form onSubmit={submitPettyOrDrop} className="space-y-4">
                                             <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                 <div>
                                                     <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Expense Type</label>
                                                     <select
                                                         value={pettyForm.data.type}
                                                         onChange={e => pettyForm.setData('type', e.target.value as any)}
                                                         className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                                     >
                                                         <option value="out">Operational Expense Out (-)</option>
                                                         <option value="in">Operational Cash In (+)</option>
                                                     </select>
                                                 </div>
                                                 <div>
                                                     <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Amount (IDR)</label>
                                                     <input
                                                         type="number"
                                                         required
                                                         value={pettyForm.data.amount}
                                                         onChange={e => pettyForm.setData('amount', parseFloat(e.target.value) || 0)}
                                                         className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                                     />
                                                 </div>
                                                 <div className="sm:col-span-2">
                                                     <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Description / Notes</label>
                                                     <input
                                                         type="text"
                                                         required
                                                         value={pettyForm.data.description}
                                                         onChange={e => pettyForm.setData('description', e.target.value)}
                                                         className="w-full rounded-xl border border-border/60 bg-card px-3.5 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                                         placeholder="e.g. Fuel, shipping fees, receipt stamp"
                                                     />
                                                 </div>
                                             </div>

                                             <button
                                                 type="submit"
                                                 disabled={pettyForm.processing}
                                                 className="w-full rounded-xl bg-primary py-3 text-xs font-semibold text-primary-foreground hover:opacity-90 shadow-sm transition disabled:opacity-50"
                                             >
                                                 {pettyForm.processing ? 'Saving...' : 'Record Petty Cash'}
                                             </button>
                                         </form>
                                     </div>
                                 </div>
                             )}
                         </div>

                         {}
                         <div>
                             {activeShift && (
                                 <div className="apple-card p-6 text-card-foreground space-y-4">
                                     <div className="flex items-center gap-2 mb-2">
                                         <Clock className="h-5 w-5 text-primary" />
                                         <h3 className="text-lg font-semibold text-foreground">Close Cashier Shift</h3>
                                     </div>
                                     <p className="text-xs text-muted-foreground">Conclude your shift and register final cash audit.</p>

                                     <form onSubmit={submitClockOut} className="space-y-4">
                                         <button
                                             type="submit"
                                             disabled={clockOutForm.processing || gpsLoading}
                                             className="w-full rounded-2xl bg-destructive py-4 text-sm font-semibold text-destructive-foreground hover:opacity-90 transition active:scale-[0.98] shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                                         >
                                             <Clock className="h-5 w-5" />
                                             {clockOutForm.processing ? 'Closing Shift...' : 'Clock Out & Close Shift'}
                                         </button>
                                     </form>
                                 </div>
                             )}
                         </div>
                     </div>
                    )}

                    {}
                    <div className="apple-card p-6 text-card-foreground">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                            <div className="flex items-center gap-2">
                                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                    <Clock className="h-5 w-5" />
                                </div>
                                <h3 className="text-lg font-semibold text-foreground">
                                    {canSeeAllShifts ? 'Staff Attendance & Punctuality Summary' : 'Your Attendance Summary'}
                                </h3>
                            </div>

                            {}
                            {canSeeAllShifts && (
                                <div className="flex items-center gap-2">
                                    <select
                                        value={filters?.month || (new Date().getMonth() + 1)}
                                        onChange={(e) => {
                                            const selectedM = e.target.value;
                                            const selectedY = filters?.year || new Date().getFullYear();
                                            router.get(route('shifts.index'), { month: selectedM, year: selectedY }, { preserveState: true });
                                        }}
                                        className="rounded-xl border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                                    >
                                        <option value="1">January</option>
                                        <option value="2">February</option>
                                        <option value="3">March</option>
                                        <option value="4">April</option>
                                        <option value="5">May</option>
                                        <option value="6">June</option>
                                        <option value="7">July</option>
                                        <option value="8">August</option>
                                        <option value="9">September</option>
                                        <option value="10">October</option>
                                        <option value="11">November</option>
                                        <option value="12">December</option>
                                    </select>
                                    <select
                                        value={filters?.year || new Date().getFullYear()}
                                        onChange={(e) => {
                                            const selectedY = e.target.value;
                                            const selectedM = filters?.month || (new Date().getMonth() + 1);
                                            router.get(route('shifts.index'), { month: selectedM, year: selectedY }, { preserveState: true });
                                        }}
                                        className="rounded-xl border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                                    >
                                        {[2024, 2025, 2026, 2027].map((yr) => (
                                            <option key={yr} value={yr}>{yr}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {canSeeAllShifts ? (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[700px] text-left border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b border-border/60 text-xs font-semibold tracking-wider text-muted-foreground">
                                            <th className="pb-3 font-semibold">Employee Name</th>
                                            <th className="pb-3 font-semibold text-center">Total Shifts</th>
                                            <th className="pb-3 font-semibold text-center">Total Late Duration</th>
                                            <th className="pb-3 font-semibold text-center">Total Work Hours</th>
                                            {isSuperAdmin && <th className="pb-3 font-semibold text-right">Payslip / Payroll</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/40 text-sm font-medium text-muted-foreground">
                                        {!attendanceStats || (Array.isArray(attendanceStats) && attendanceStats.length === 0) ? (
                                            <tr>
                                                <td colSpan={isSuperAdmin ? 5 : 4} className="py-6 text-center text-muted-foreground">No attendance records for this month.</td>
                                            </tr>
                                        ) : (
                                            (Array.isArray(attendanceStats) ? attendanceStats : []).map((stat) => {
                                                const lateMins = parseInt(stat.total_late_minutes as string, 10) || 0;
                                                const workMins = parseInt(stat.total_work_minutes as string, 10) || 0;
                                                const userPayroll = payrolls.find(p => p.user_id === stat.user_id);

                                                const formatMinutes = (mins: number) => {
                                                    if (mins <= 0) return '✦ On Time';
                                                    const hrs = Math.floor(mins / 60);
                                                    const remainingMins = mins % 60;
                                                    if (hrs > 0) {
                                                        return `Late ${hrs}h ${remainingMins}m`;
                                                    }
                                                    return `Late ${remainingMins}m`;
                                                };

                                                const formatWorkTime = (mins: number) => {
                                                    const hrs = Math.floor(mins / 60);
                                                    const remainingMins = mins % 60;
                                                    return `${hrs}h ${remainingMins}m`;
                                                };

                                                return (
                                                    <tr key={stat.user_id} className="hover:bg-muted/40 transition">
                                                        <td className="py-4 font-semibold text-foreground">{stat.user?.name || 'Unknown'}</td>
                                                        <td className="py-4 text-center font-semibold text-foreground">{stat.total_days} Days</td>
                                                        <td className="py-4 text-center">
                                                            <span className={`text-xs font-semibold ${lateMins > 0 ? "text-destructive" : "text-primary"}`}>
                                                                {formatMinutes(lateMins)}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 text-center text-xs font-semibold text-foreground">{formatWorkTime(workMins)}</td>
                                                        {isSuperAdmin && (
                                                            <td className="py-4 text-right space-x-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openPayrollModal(stat.user_id)}
                                                                    className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
                                                                >
                                                                    {userPayroll ? 'Edit Salary' : '+ Input Salary'}
                                                                </button>
                                                                {userPayroll && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setPrintingPayroll(userPayroll)}
                                                                        className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition"
                                                                    >
                                                                        View Slip
                                                                    </button>
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <StatCard
                                    title="Total Work Shifts"
                                    value={`${((attendanceStats as any)?.total_days) || 0} Days`}
                                    isCurrency={false}
                                />
                                <StatCard
                                    title="Total Lateness"
                                    value={(() => {
                                        const mins = parseInt((attendanceStats as any)?.total_late_minutes as string, 10) || 0;
                                        if (mins <= 0) return '0 Minutes';
                                        const hrs = Math.floor(mins / 60);
                                        const remainingMins = mins % 60;
                                        if (hrs > 0) return `${hrs}h ${remainingMins}m`;
                                        return `${remainingMins}m`;
                                    })()}
                                    isCurrency={false}
                                />
                                <StatCard
                                    title="Total Work Duration"
                                    value={(() => {
                                        const mins = parseInt((attendanceStats as any)?.total_work_minutes as string, 10) || 0;
                                        const hrs = Math.floor(mins / 60);
                                        const remainingMins = mins % 60;
                                        return `${hrs}h ${remainingMins}m`;
                                    })()}
                                    isCurrency={false}
                                />
                            </div>

                        )}
                    </div>

                    {}
                    <div className="apple-card p-6 text-card-foreground">
                        <h3 className="text-lg font-semibold text-foreground mb-4">Cashier Shift History</h3>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[600px] text-left border-collapse text-sm">
                                <thead>
                                    <tr className="border-b border-border/60 text-xs font-semibold tracking-wider text-muted-foreground">
                                        <th className="pb-3 font-semibold">Cashier / Staff</th>
                                        {canSeeAllShifts && <th className="pb-3 font-semibold">Branch</th>}
                                        <th className="pb-3 font-semibold">Opened</th>
                                        <th className="pb-3 font-semibold">Closed</th>
                                        {canSeeAllShifts && (
                                            <>
                                                <th className="pb-3 font-semibold">Revenue (Gross)</th>
                                                <th className="pb-3 font-semibold">Shift Profit</th>
                                                <th className="pb-3 font-semibold">Petty Cash</th>
                                                <th className="pb-3 font-semibold">Status</th>
                                                {canManageShifts && <th className="pb-3 font-semibold text-right">Action</th>}
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40 text-sm font-medium text-muted-foreground">
                                    {paginatedShifts.length === 0 ? (
                                        <tr>
                                            <td colSpan={canSeeAllShifts ? (canManageShifts ? 9 : 8) : 3} className="py-6 text-center text-muted-foreground">No shift history found.</td>
                                        </tr>
                                    ) : (
                                        paginatedShifts.map((sh) => {
                                            const lateMins = sh.late_minutes || 0;
                                            return (
                                                <tr key={sh.id} className="hover:bg-muted/40 transition">
                                                    <td className="py-4 font-semibold text-foreground">{sh.user?.name}</td>
                                                    {canSeeAllShifts && <td className="py-4 text-xs">{sh.store?.name || '-'}</td>}
                                                    <td className="py-4 text-xs">
                                                        <div>
                                                            <p className="font-semibold text-foreground">{new Date(sh.opened_at).toLocaleString('en-US')}</p>
                                                            {lateMins > 0 ? (
                                                                <span className="block mt-0.5 text-[11px] font-semibold text-destructive">
                                                                    Late {Math.floor(lateMins / 60) > 0 ? `${Math.floor(lateMins / 60)}h ${lateMins % 60}m` : `${lateMins}m`}
                                                                </span>
                                                            ) : (
                                                                <span className="block mt-0.5 text-[11px] font-semibold text-primary">
                                                                    On Time
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-4 text-xs">{sh.closed_at ? new Date(sh.closed_at).toLocaleString('en-US') : '-'}</td>
                                                    {canSeeAllShifts && (
                                                        <>
                                                            <td className="py-4 text-xs font-semibold text-foreground">{formatCurrency(sh.total_omset || 0)}</td>
                                                            <td className="py-4 text-xs font-semibold text-primary">{formatCurrency(sh.total_profit || 0)}</td>
                                                            <td className="py-4 text-xs">
                                                                {(() => {
                                                                    const pettyList = sh.petty_cash || [];
                                                                    const pettyIn = pettyList.filter(p => p.type === 'in').reduce((sum, p) => sum + Number(p.amount), 0);
                                                                    const pettyOut = pettyList.filter(p => p.type === 'out').reduce((sum, p) => sum + Number(p.amount), 0);
                                                                    const cashDrop = pettyList.filter(p => p.type === 'drop').reduce((sum, p) => sum + Number(p.amount), 0);

                                                                    if (pettyIn === 0 && pettyOut === 0 && cashDrop === 0) return <span className="text-muted-foreground font-medium">—</span>;

                                                                    return (
                                                                        <div className="space-y-0.5 text-[10px] font-semibold">
                                                                            {pettyIn > 0 && <p className="text-primary">In: +{formatCurrency(pettyIn)}</p>}
                                                                            {pettyOut > 0 && <p className="text-destructive">Out: -{formatCurrency(pettyOut)}</p>}
                                                                            {cashDrop > 0 && <p className="text-primary">Drop: -{formatCurrency(cashDrop)}</p>}
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </td>
                                                            <td className="py-4 text-xs">
                                                                <span className={`text-[11px] font-semibold capitalize ${sh.status === 'open' ? 'text-primary' : 'text-muted-foreground'}`}>
                                                                    {sh.status}
                                                                </span>
                                                            </td>
                                                            {canManageShifts && (
                                                                <td className="py-4 text-right space-x-2">
                                                                    <button
                                                                        onClick={() => startEdit(sh)}
                                                                        className="text-xs font-semibold text-primary hover:opacity-80"
                                                                    >
                                                                        Edit
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDelete(sh.id)}
                                                                        className="text-xs font-semibold text-destructive hover:opacity-80"
                                                                    >
                                                                        Delete
                                                                    </button>
                                                                </td>
                                                            )}
                                                        </>
                                                    )}
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Bar for Shift History */}
                        {totalShiftPages > 1 && (
                            <div className="flex items-center justify-between px-2 pt-4 border-t border-border/60 mt-4">
                                <p className="text-xs text-muted-foreground font-medium">
                                    Showing {Math.min((shiftPage - 1) * shiftsPerPage + 1, shifts.length)} - {Math.min(shiftPage * shiftsPerPage, shifts.length)} of {shifts.length} shifts
                                </p>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => setShiftPage(p => Math.max(1, p - 1))}
                                        disabled={shiftPage === 1}
                                        className="p-1.5 rounded-lg border border-border disabled:opacity-30 hover:bg-muted text-foreground transition"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </button>
                                    <span className="text-xs font-semibold text-foreground px-2">
                                        Page {shiftPage} of {totalShiftPages}
                                    </span>
                                    <button
                                        onClick={() => setShiftPage(p => Math.min(totalShiftPages, p + 1))}
                                        disabled={shiftPage === totalShiftPages}
                                        className="p-1.5 rounded-lg border border-border disabled:opacity-30 hover:bg-muted text-foreground transition"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>
            {}
            {editingShift && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card border border-border/80 p-6 shadow-xl text-card-foreground animate-in fade-in zoom-in-95 duration-150">
                        <h3 className="text-lg font-bold text-foreground mb-4 tracking-tight">Edit Shift Data</h3>
                        <form onSubmit={submitEdit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Opening Cash (IDR)</label>
                                <input
                                    type="number"
                                    required
                                    value={editForm.data.start_cash}
                                    onChange={e => editForm.setData('start_cash', parseFloat(e.target.value) || 0)}
                                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Closing Cash (IDR)</label>
                                <input
                                    type="number"
                                    value={editForm.data.end_cash}
                                    onChange={e => editForm.setData('end_cash', parseFloat(e.target.value) || 0)}
                                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Shift Status</label>
                                <select
                                    value={editForm.data.status}
                                    onChange={e => editForm.setData('status', e.target.value as any)}
                                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                >
                                    <option value="open">Open</option>
                                    <option value="closed">Closed</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Opening Time</label>
                                <input
                                    type="datetime-local"
                                    required
                                    value={editForm.data.opened_at}
                                    onChange={e => editForm.setData('opened_at', e.target.value)}
                                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Closing Time</label>
                                <input
                                    type="datetime-local"
                                    value={editForm.data.closed_at}
                                    onChange={e => editForm.setData('closed_at', e.target.value)}
                                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setEditingShift(null)}
                                    className="rounded-xl border border-border/60 px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={editForm.processing}
                                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {}
            {isPayrollModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-card border border-border/80 p-6 shadow-xl space-y-6 text-card-foreground animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between border-b border-border/60 pb-4">
                            <h3 className="text-base font-bold text-foreground">
                                Payslip / Salary Details (Period {payrollForm.data.month}/{payrollForm.data.year})
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsPayrollModalOpen(false)}
                                className="text-muted-foreground hover:text-foreground text-sm font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={submitPayroll} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Select Employee</label>
                                <select
                                    required
                                    value={payrollForm.data.user_id}
                                    onChange={(e) => {
                                        const uid = e.target.value;
                                        const existing = payrolls.find(p => String(p.user_id) === uid);
                                        payrollForm.setData(d => ({
                                            ...d,
                                            user_id: uid,
                                            basic_salary: existing ? existing.basic_salary : '',
                                            commission: existing ? existing.commission : '',
                                            allowance: existing ? existing.allowance : '',
                                            deductions: existing ? existing.deductions : '',
                                            notes: existing ? (existing.notes || '') : '',
                                        }));
                                    }}
                                    className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                                >
                                    <option value="">-- Select Employee --</option>
                                    {employees.map(emp => (
                                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Base Salary (IDR)</label>
                                    <input
                                        type="number"
                                        required
                                        min={0}
                                        value={payrollForm.data.basic_salary}
                                        onChange={e => payrollForm.setData('basic_salary', parseFloat(e.target.value) || '')}
                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Commission / Bonus (IDR)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={payrollForm.data.commission}
                                        onChange={e => payrollForm.setData('commission', parseFloat(e.target.value) || '')}
                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Allowance (IDR)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={payrollForm.data.allowance}
                                        onChange={e => payrollForm.setData('allowance', parseFloat(e.target.value) || '')}
                                        className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold tracking-wider text-destructive mb-1">Deductions / Penalties (IDR)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={payrollForm.data.deductions}
                                        onChange={e => payrollForm.setData('deductions', parseFloat(e.target.value) || '')}
                                        className="w-full rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2 text-xs font-semibold text-destructive focus:border-destructive focus:outline-none"
                                        placeholder="0"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold tracking-wider text-muted-foreground mb-1">Deductions Note / Comments</label>
                                <textarea
                                    value={payrollForm.data.notes}
                                    onChange={e => payrollForm.setData('notes', e.target.value)}
                                    rows={2}
                                    className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                                    placeholder="e.g. Lateness penalty / loan deduction..."
                                />
                            </div>

                            {}
                            <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/20 flex justify-between items-center">
                                <span className="text-xs font-semibold text-primary tracking-wider">Estimated Net Salary</span>
                                <span className="text-base font-bold text-primary">
                                    {formatCurrency(
                                        Math.max(0,
                                            (Number(payrollForm.data.basic_salary) || 0) +
                                            (Number(payrollForm.data.commission) || 0) +
                                            (Number(payrollForm.data.allowance) || 0) -
                                            (Number(payrollForm.data.deductions) || 0)
                                        )
                                    )}
                                </span>
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsPayrollModalOpen(false)}
                                    className="rounded-xl border border-border/60 px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={payrollForm.processing}
                                    className="rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                                >
                                    {payrollForm.processing ? 'Saving...' : 'Save Payslip'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {}
            {printingPayroll && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl bg-card border border-border/80 text-card-foreground p-6 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
                        <div className="border-b border-border/60 pb-4 text-center">
                            <h2 className="text-lg font-bold text-primary tracking-wider">STAFF PAYSLIP</h2>
                            <p className="text-xs font-semibold text-muted-foreground mt-0.5">{myStore?.name || 'DAILY PHONE'}</p>
                            <p className="text-[10px] font-semibold text-muted-foreground ">Period: Month {printingPayroll.month} / {printingPayroll.year}</p>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div className="flex justify-between border-b border-border/40 pb-2">
                                <span className="text-muted-foreground">Staff Name</span>
                                <span className="font-semibold text-foreground">{printingPayroll.user?.name || '-'}</span>
                            </div>

                            <div className="space-y-1.5 pt-1">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Base Salary</span>
                                    <span className="font-semibold text-foreground">{formatCurrency(Number(printingPayroll.basic_salary))}</span>
                                </div>
                                {Number(printingPayroll.commission) > 0 && (
                                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                                        <span>Commission / Bonus</span>
                                        <span className="font-semibold">+{formatCurrency(Number(printingPayroll.commission))}</span>
                                    </div>
                                )}
                                {Number(printingPayroll.allowance) > 0 && (
                                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                                        <span>Allowance</span>
                                        <span className="font-semibold">+{formatCurrency(Number(printingPayroll.allowance))}</span>
                                    </div>
                                )}
                                {Number(printingPayroll.deductions) > 0 && (
                                    <div className="flex justify-between text-destructive">
                                        <span>Deductions</span>
                                        <span className="font-semibold">-{formatCurrency(Number(printingPayroll.deductions))}</span>
                                    </div>
                                )}
                            </div>

                            {printingPayroll.notes && (
                                <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-[11px] text-muted-foreground">
                                    <strong className="block text-foreground text-[10px] mb-0.5">Notes:</strong>
                                    {printingPayroll.notes}
                                </div>
                            )}

                            <div className="flex justify-between items-center p-3.5 rounded-xl bg-primary/10 border border-primary/20 text-primary pt-3">
                                <span className="font-bold text-xs tracking-wider">TOTAL NET SALARY (TAKE HOME)</span>
                                <span className="font-bold text-base">{formatCurrency(Number(printingPayroll.net_salary))}</span>
                            </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setPrintingPayroll(null)}
                                className="rounded-xl border border-border/60 px-3.5 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (confirm(`Send this payslip to ${printingPayroll.user?.name}'s email?`)) {
                                        router.post(route('shifts.payroll.send-email', printingPayroll.id), {}, {
                                            onSuccess: () => alert('Payslip successfully sent to employee email!'),
                                            onError: () => alert('Failed to send email. Please ensure employee email is registered.'),
                                        });
                                    }
                                }}
                                className="flex-1 rounded-xl bg-primary/15 border border-primary/30 py-2.5 text-xs font-semibold text-primary hover:bg-primary/25 transition flex items-center justify-center gap-1.5"
                            >
                                ✉️ Email Payslip
                            </button>
                            <a
                                href={route('shifts.payroll.print', printingPayroll.id)}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition text-center flex items-center justify-center gap-1"
                            >
                                🖨️ Print Slip
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}

