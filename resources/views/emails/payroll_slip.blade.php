<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Employee Payslip</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
    <div style="max-width: 550px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
        
        <!-- Header -->
        <div style="background-color: #4f46e5; padding: 32px 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 22px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase;">
                EMPLOYEE PAYSLIP
            </h1>
            <p style="margin: 6px 0 0 0; font-size: 13px; font-weight: 600; opacity: 0.9;">
                {{ $payroll->user->store->name ?? config('app.name', 'DAILY PHONE') }}
            </p>
            <span style="display: inline-block; margin-top: 10px; background-color: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
                Period: Month {{ $payroll->month }} / {{ $payroll->year }}
            </span>
        </div>

        <!-- Body Content -->
        <div style="padding: 28px 24px;">
            <p style="font-size: 14px; margin-top: 0; color: #475569;">
                Hello <strong>{{ $payroll->user->name }}</strong>, here are the details of your payslip for period {{ $payroll->month }}/{{ $payroll->year }}:
            </p>

            <div style="background-color: #f8fafc; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #f1f5f9;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Employee Name</td>
                        <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #0f172a;">{{ $payroll->user->name }}</td>
                    </tr>
                    <tr style="border-bottom: 1px dashed #e2e8f0;">
                        <td style="padding: 10px 0; color: #64748b;">Basic Salary</td>
                        <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #0f172a;">Rp {{ number_format($payroll->basic_salary, 0, ',', '.') }}</td>
                    </tr>
                    @if($payroll->commission > 0)
                    <tr style="border-bottom: 1px dashed #e2e8f0;">
                        <td style="padding: 10px 0; color: #059669; font-weight: 600;">Commission / Bonus</td>
                        <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #059669;">+Rp {{ number_format($payroll->commission, 0, ',', '.') }}</td>
                    </tr>
                    @endif
                    @if($payroll->allowance > 0)
                    <tr style="border-bottom: 1px dashed #e2e8f0;">
                        <td style="padding: 10px 0; color: #059669; font-weight: 600;">Allowance</td>
                        <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #059669;">+Rp {{ number_format($payroll->allowance, 0, ',', '.') }}</td>
                    </tr>
                    @endif
                    @if($payroll->deductions > 0)
                    <tr style="border-bottom: 1px dashed #e2e8f0;">
                        <td style="padding: 10px 0; color: #dc2626; font-weight: 600;">Deductions / Penalty</td>
                        <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #dc2626;">-Rp {{ number_format($payroll->deductions, 0, ',', '.') }}</td>
                    </tr>
                    @endif
                </table>

                @if($payroll->notes)
                <div style="margin-top: 16px; background-color: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 12px; color: #475569;">
                    <strong style="color: #1e293b; display: block; margin-bottom: 4px; text-transform: uppercase; font-size: 10px;">Notes:</strong>
                    {{ $payroll->notes }}
                </div>
                @endif
            </div>

            <!-- Total Box -->
            <div style="background-color: #eef2ff; border-radius: 12px; padding: 16px; text-align: center; border: 1px solid #c7d2fe;">
                <span style="font-size: 11px; font-weight: 800; color: #4338ca; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px;">
                    TAKE HOME PAY (NET SALARY)
                </span>
                <span style="font-size: 22px; font-weight: 900; color: #4f46e5;">
                    Rp {{ number_format($payroll->net_salary, 0, ',', '.') }}
                </span>
            </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
            This document is automatically generated by {{ config('app.name', 'House Phone') }}.
        </div>
    </div>
</body>
</html>
