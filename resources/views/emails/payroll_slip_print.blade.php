<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payslip - {{ $payroll->user->name }} ({{ $payroll->month }}/{{ $payroll->year }})</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        body {
            background-color: #f1f5f9;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
            color: #0f172a;
        }
        .ticket {
            background: #ffffff;
            width: 100%;
            max-width: 440px;
            border-radius: 20px;
            padding: 28px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
        }
        .header {
            text-align: center;
            padding-bottom: 20px;
            border-bottom: 2px dashed #e2e8f0;
        }
        .header h1 {
            font-size: 20px;
            font-weight: 900;
            color: #4f46e5;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .header p {
            font-size: 13px;
            font-weight: 700;
            color: #64748b;
            margin-top: 4px;
        }
        .header .badge {
            display: inline-block;
            margin-top: 10px;
            background: #eef2ff;
            color: #4f46e5;
            padding: 4px 14px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
        }
        .details {
            padding: 20px 0;
        }
        .row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 13px;
            padding: 8px 0;
        }
        .row .label {
            color: #64748b;
            font-weight: 600;
        }
        .row .val {
            font-weight: 700;
            color: #0f172a;
        }
        .row.bonus .val {
            color: #059669;
        }
        .row.deduct .val {
            color: #dc2626;
        }
        .notes-box {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 12px;
            font-size: 12px;
            color: #475569;
            margin-top: 12px;
        }
        .total-box {
            background: #4f46e5;
            color: #ffffff;
            border-radius: 16px;
            padding: 16px;
            text-align: center;
            margin-top: 20px;
        }
        .total-box span {
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.9;
            display: block;
        }
        .total-box h2 {
            font-size: 24px;
            font-weight: 900;
            margin-top: 4px;
        }
        .action-bar {
            margin-top: 20px;
            display: flex;
            gap: 10px;
        }
        .btn {
            flex: 1;
            padding: 12px;
            border-radius: 12px;
            border: none;
            font-size: 13px;
            font-weight: 800;
            cursor: pointer;
            text-align: center;
            text-decoration: none;
            transition: all 0.2s;
        }
        .btn-print {
            background: #4f46e5;
            color: #ffffff;
        }
        .btn-print:hover {
            background: #4338ca;
        }
        .btn-back {
            background: #e2e8f0;
            color: #475569;
        }
        .btn-back:hover {
            background: #cbd5e1;
        }

        @media print {
            body {
                background: #ffffff;
                padding: 0;
            }
            .ticket {
                box-shadow: none;
                border: none;
                max-width: 100%;
                width: 100%;
            }
            .action-bar {
                display: none;
            }
        }
    </style>
</head>
<body>

    <div class="ticket">
        <div class="header">
            <h1>PAYSLIP KARYAWAN</h1>
            <p>{{ $payroll->user->store->name ?? config('app.name', 'DAILY PHONE') }}</p>
            <span class="badge">Period: Month {{ $payroll->month }} / {{ $payroll->year }}</span>
        </div>

        <div class="details">
            <div class="row">
                <span class="label">Employee Name</span>
                <span class="val">{{ $payroll->user->name }}</span>
            </div>
            <div class="row">
                <span class="label">Basic Salary</span>
                <span class="val">Rp {{ number_format($payroll->basic_salary, 0, ',', '.') }}</span>
            </div>
            @if($payroll->commission > 0)
            <div class="row bonus">
                <span class="label">Commission / Bonus</span>
                <span class="val">+Rp {{ number_format($payroll->commission, 0, ',', '.') }}</span>
            </div>
            @endif
            @if($payroll->allowance > 0)
            <div class="row bonus">
                <span class="label">Allowance</span>
                <span class="val">+Rp {{ number_format($payroll->allowance, 0, ',', '.') }}</span>
            </div>
            @endif
            @if($payroll->deductions > 0)
            <div class="row deduct">
                <span class="label">Deduction / Denda</span>
                <span class="val">-Rp {{ number_format($payroll->deductions, 0, ',', '.') }}</span>
            </div>
            @endif

            @if($payroll->notes)
            <div class="notes-box">
                <strong style="display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 2px;">Notes:</strong>
                {{ $payroll->notes }}
            </div>
            @endif
        </div>

        <div class="total-box">
            <span>Total Gaji Bersih (Take Home Pay)</span>
            <h2>Rp {{ number_format($payroll->net_salary, 0, ',', '.') }}</h2>
        </div>

        <div class="action-bar">
            <button onclick="window.history.back()" class="btn btn-back">Kembali</button>
            <button onclick="window.print()" class="btn btn-print">🖨️ Print Slip / Download PDF</button>
        </div>
    </div>

    <script>
        // Auto trigger print dialog on page load
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 500);
        };
    </script>
</body>
</html>
