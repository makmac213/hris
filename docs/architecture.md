# Architecture

A Next.js 15 (App Router, React 19, TypeScript) prototype on in-memory mock data. Every row is shaped like the planned Supabase schema, so moving to a real database replaces the data layer and leaves the screens alone.

## Structure

```
app/                    Next.js routes (thin: each one renders a view)
features/               One folder per module
  directory/ profile/ org/ onboarding/   Employee management
  time/                 My time, Record Time dialog, Attendance, Shift codes
  requests/             Overtime and correction dialogs, My requests, Approvals
  payroll/              Payroll register, Payslip, My pay
components/ui/          Design-system primitives
components/AppShell.tsx Sidebar navigation, role-aware, responsive
lib/types.ts            Row types that mirror the SQL schema
lib/mock-data.ts        Sample company: 48 fictional people, three clients, shifts, a published schedule, requests, pay
lib/store.ts            The data layer: every read and write goes through here
lib/time.ts             Shift maths, Philippine default shifts, attendance rules, CSV parsing
lib/payroll.ts          Payroll engine: rates, day calculation, payslip, contributions, tax
lib/schedule.ts         Scheduling rules: each person's day, leave gaps, cover, notifications
app/api/v1/              REST API entry point (see api.md)
lib/server/             Server-only: services, auth, repositories (memory, Supabase), API pipeline
supabase/migrations/    0001 employees, 0002 timekeeping, 0003 payroll, 0004 leave and separation, 0005 API
preview/, scripts/      Single-file preview build (same views, hash routing)
tests/                  Engine tests (npm test: esbuild + node --test)
docs/                   Planning and documentation
```

## Data layer

`lib/store.ts` keeps the database in memory and exposes it through `useSyncExternalStore`. Views call `useDb()` to read and named functions to write: `createEmployee`, `updateEmployee`, `assignShift`, `recordTime`, `fileOvertime`, `fileCorrection`, `decideRequest`, `finalizePayroll` and so on. Permissions live there too. `canApprove` comes from `lib/approvals.ts`: the direct supervisor, or an approver role (admin always, HR and operations if turned on), never one's own ([approvals.md](approvals.md)).

The payroll engine in `lib/payroll.ts` is pure: `computePayslip(db, employee, period, now)` reads rows and returns a payslip. In production it runs on the server (an Edge Function or server action) and its result is frozen into `payroll_items` when a period is finalized.

## Roles

| Role | Sees |
| --- | --- |
| Admin, HR | Everything: people, attendance, approvals, payroll, shift codes, reports, plus their own time and pay. Only admin sees the audit trail. |
| Executive | Their own time and pay, and the executive dashboard, headcount and turnover reports ([reports.md](reports.md)) |
| Manager (anyone with reports) | Their own time and pay, approvals for their direct reports, and attendance, tardiness and leave reports for their team |
| Approver roles | HR by default, operations if turned on: approvals for everyone ([approvals.md](approvals.md)) |
| Employee | My time, My pay, the directory and the org chart |

In the prototype, the "view as" switcher stands in for sign-in.

## API

The REST API at `/api/v1` runs the same rules on the server through `lib/server/services`, over a repository that is either in memory or Supabase. The web screens still use the in-browser store; moving them to server actions over the same services is the next step. See [api.md](api.md).

## Moving to Supabase

1. Apply the migrations in order and seed from `lib/mock-data.ts`. The column names match.
2. Swap `lib/types.ts` for `supabase gen types typescript` output.
3. Re-implement the `lib/store.ts` functions with supabase-js: server actions for writes, React Query or server components for reads. Views don't change.
4. `recordTime` becomes a server action. The server sets `recorded_at`, uploads the photo to a private `time-photos` bucket, and rejects the insert without photo and GPS. The table enforces it too (`time_records_proof`).
5. `decideRequest` runs in one transaction: update the request, and for an approved correction insert the `source = 'correction'` time record.
6. `finalizePayroll` computes every payslip on the server and writes `payroll_items`, then locks the period. Requests for dates in a finalized period are refused.
7. Write RLS policies scoped to `organization_id`. RLS is already on for every table, so nothing is readable until the policies exist. Policy sketches are at the end of each migration.

## Preview build

`npm run preview:build` bundles the same views into `dist/preview/index.html` with esbuild. `next/link` and `next/navigation` are swapped for hash-routing shims, and `NEXT_PUBLIC_DEMO_FALLBACKS` turns on the preview-only sample photo and office location, because the preview runs where the camera and GPS are blocked. Those fallbacks never ship in the Next.js app.
