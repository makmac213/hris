# Organization and scheduling

How Halden groups people (departments, branches, clients) and how operations plans shifts around leave. Written for a BPO: client accounts, rotating rest days, night shifts, and leave that lands on a shift someone else now has to cover.

## What Mark asked for

1. Departments and branches, with people assigned to them.
2. Clients (BPO accounts), with people assigned to them.
3. A schedule calendar for operations: everyone's shifts, filtered by department, branch and client.
4. Show when a scheduled person becomes unavailable because of leave, including sudden leave (sick, emergency, any company leave type).
5. Operations assigns shifts on the calendar, up to a set number of days ahead.
6. No shift on a day the person has approved leave.
7. A shift on a day with pending leave is allowed, but the pending leave is visible, and if it's approved, people are notified.

## Organization

| Unit | What it is | Rules |
| --- | --- | --- |
| Department | A team in the org chart (Client Operations, Engineering) | Everyone is in one. Moving someone is logged as a transfer on their timeline. A department with anyone in it, current or former, can't be deleted. |
| Branch | An office or site (Manila, Cebu, Remote). Stored in the existing `locations` table. | Everyone is in one. A Philippine branch needs a region, because the regional minimum wage follows the branch ([payroll rules](payroll-rules.md)). Same delete rule as departments. |
| Client | A BPO client account (Northwind Mobile, Kestrel Bank) with a short code for the schedule | Optional: people not on an account have none. One client per person. Archiving a client takes everyone off it and keeps the name on old records. |

Admin and HR manage all three on **Organization**, and each person's profile shows their department, branch and client. The directory filters by all three.

One client per person matches how most BPO agents work: one account at a time. If people need to split time across accounts, the next step is a `client_assignments` table with dates and shares; nothing else would change.

## The schedule

### What a day shows

Each person has a default shift code (from timekeeping). Operations can set any day to a specific shift or a rest day. So each day is one of:

| Day | Comes from | Shown as |
| --- | --- | --- |
| Scheduled shift | A `shift_assignments` row | Solid cell, shift hours and code |
| Scheduled rest day | A row with no shift | Grey "Rest" |
| Default | No row: the default shift on weekdays, rest on weekends | Dashed cell, so it's clear operations hasn't planned it |
| On leave | Approved leave on a day nobody scheduled | Striped, leave type |
| Needs cover | Approved leave on a day operations scheduled a shift | Red, "Needs cover", until someone covers it |
| Covered | As above, with a cover scheduled | Green, the cover's name |
| Leave pending | Pending leave on any day | An amber bar and "VL pending" on the cell |
| Short notice | Leave filed less than the short-notice threshold (48 hours by default) before the shift started | A "!" mark on the cell, and "short notice" in the list |

Above the calendar, two lists: shifts that need cover (with a **Find cover** button) and scheduled days with leave pending.

### Who sees what

| Role | Sees | Can change |
| --- | --- | --- |
| Operations (new role) | Everyone | Any schedulable day |
| Admin, HR | Everyone | Any schedulable day |
| Manager or team lead | Their direct reports | Nothing. Operations owns the schedule. |
| Employee | Their own next 7 days, on My time | Nothing |

Operations is a new role for workforce management. It can see the schedule and the directory, not pay or HR records. The operations user's view opens on their own department.

### Assigning shifts

Click days to select them, or click a person's name (all their days in view) or a date (that day for everyone shown). Then pick a shift and **Assign shift**, **Make rest day**, or **Use default**. A batch is all or nothing: if one day can't be scheduled, nothing is saved and the message says which day and why.

A day can be scheduled when all of these hold:

| Rule | Why |
| --- | --- |
| Today or later | The past is what happened. Attendance and payroll already used it. |
| No later than today + the scheduling window (60 days by default, settable from 7 to 180) | Mark's "up to a certain period of time" |
| Within the person's employment (start date to last day) | |
| Not in a finalized payroll period | Same lock as time corrections |
| No approved leave that day | Mark's rule. An approved **half-day** leave still allows a half-day shift. Approved leave also can't be turned into a rest day, so a leave credit is never silently undone. |
| The shift code isn't archived | |

Pending leave doesn't block. The day is scheduled, the scheduler sees a warning, and the cell shows the pending leave. If the leave is later approved, the shift becomes a coverage gap and people are notified (below).

**Seven days in a row** is allowed with a warning. The Labor Code gives every employee a rest day of at least 24 consecutive hours after six consecutive normal workdays, scheduled by the employer ([Art. 91](https://chanrobles.com/legal4labor3.htm)). Work on a rest day is allowed in the situations Art. 92 lists, paid at least 30% more (Art. 93), so the schedule warns instead of refusing.

### Covering a gap

**Find cover** lists people who are off that day (rest day or no shift), not on leave, in the same department or on the same client: same client first, then same branch. Choosing one schedules them on the same shift and records whom they're covering for, so the gap turns green. Covering on a rest day is paid at the rest day rate in payroll, because the schedule now drives payroll (below).

## Leave and notifications

Notifications appear under the bell in the sidebar, with an unread count, and link to the week in question.

| When | Who is told | Message |
| --- | --- | --- |
| Leave is **approved** and covers one or more days operations scheduled a shift | Everyone with the operations role, the person's manager, and whoever scheduled those shifts. Never the approver or the person on leave. | "Paul Ignacio's sick leave was approved: 1 scheduled shift needs cover" |
| Leave is **filed** less than the short-notice threshold before a scheduled shift (sudden sick or emergency leave) | The same people | "Kristine Dizon asked for emergency leave on short notice". It's pending, so they can line up cover before the approval. |

Leave on days nobody scheduled (staff on the default schedule) sends nothing new; their manager already approves it in the usual queue.

Halden adds **Emergency leave** (3 days a year, everyone) as a company leave type, since BPOs commonly have one. Like every company leave type, HR can change or turn it off on Leave policies.

## How the schedule reaches time and pay

The schedule is the source of truth for the day's shift and rest day everywhere:

| Where | What changes |
| --- | --- |
| My time | Today's shift, rest day and the next 7 days come from the schedule. |
| Attendance | Each person's shift and rest day for the date come from the schedule; approved leave shows as "On leave", not "Absent". |
| Time records | The shift on the record is the scheduled one. An overnight time out goes to the day before when that day's scheduled shift was overnight. |
| Leave days | A leave request counts the person's scheduled workdays, not Monday to Friday. Leave over a rotating rest day costs nothing. |
| Payroll | Each day is paid against its scheduled shift. A scheduled weekday rest day is a rest day for premiums (Art. 93); a scheduled Saturday shift is an ordinary day. The day-before rule for unworked regular holidays (Art. 94 IRR) skips scheduled rest days. Monthly pay is still half the monthly rate each cutoff. |

People with no scheduled days behave exactly as before: default shift on weekdays, rest on weekends. All earlier payroll tests pass unchanged.

## API

| Method and path | What | Who |
| --- | --- | --- |
| `GET /departments`, `POST`, `PATCH /{id}`, `DELETE /{id}` | Departments with headcount | Read: anyone. Write: admin, HR |
| `POST /departments/{id}/members` | Move people in (logged as a transfer) | Admin, HR |
| `GET /branches`, `POST`, `PATCH /{id}`, `DELETE /{id}`, `POST /{id}/members` | Branches, same pattern | Same |
| `GET /clients`, `POST`, `PATCH /{id}` (`archived: true` to archive), `POST` and `DELETE /{id}/members` | Clients | Same |
| `GET /schedule?from&to&department_id&branch_id&client_id&employee_id` | Up to 42 days: per person per day, the shift, rest day, source, leave, gap, cover, short notice, and whether it can be changed and why not | Operations, admin, HR: everyone. Managers: their team. Others: themselves. |
| `PUT /schedule` | `{ "entries": [{ "employee_id", "date", "shift_code_id" or null, "covers_employee_id"? }] }`. All or nothing; 422 with a reason per `employee_id:date`; warnings for pending leave and a seventh day in a row | Operations, admin, HR; API keys with `schedule:write` (a WFM tool) |
| `DELETE /schedule` | `{ "entries": [{ "employee_id", "date" }] }`: back to the default shift | Same |
| `GET /schedule/gaps` | Scheduled shifts left uncovered by approved leave, from today | Same as `GET /schedule` |
| `GET`, `PATCH /schedule/settings` | Scheduling window and short-notice hours | Read: anyone. Write: operations, admin, HR |
| `GET /notifications?unread=true`, `POST /notifications/read` | Your notifications; mark some (`ids`) or all read | The person |

Leave decisions through the API send the same notifications, and the response lists who was notified. New API key scopes: `schedule:read`, `schedule:write`.

## Data

Migration `supabase/migrations/0006_org_and_scheduling.sql`:

- `app_role` gains `operations`.
- `clients`, and `employees.client_id`.
- A unique branch name per organization.
- `shift_assignments`: one row per person per day, id `employee_id:work_date` so writes are idempotent upserts. A trigger refuses a row on approved leave, as a backstop to the app's check.
- `schedule_settings`: one row per organization.
- `notifications`.
- RLS is on for the new tables; the policies are written with the rest of RLS when Supabase is connected ([api.md, Rollout](api.md#rollout)).

## Code

| File | What |
| --- | --- |
| `lib/schedule.ts` | The rules: a person's day, leave on a day, locks, checks, gaps, cover candidates, notifications, Art. 91 runs, overnight work dates |
| `features/schedule/ScheduleView.tsx` | The calendar, attention lists, bulk actions, cover and settings dialogs |
| `features/org/OrganizationView.tsx` | Departments, branches and clients, and assigning people |
| `components/AppShell.tsx` | Navigation for the operations role, and the notification bell |
| `lib/server/services/org.ts`, `schedule.ts` | The API |
| `tests/schedule.test.ts` | Rules over the sample company; payroll tests for rotating rest days are in `tests/payroll.test.ts` |

## Sample data

A Client Operations department (Rowena Garcia, head; Jerome Tolentino, workforce scheduler, both with the operations role) with eight agents and leads in Manila and Cebu, on three fictional clients:

| Client | Rest days | Shift |
| --- | --- | --- |
| Northwind Mobile (NWM) | Saturday, Sunday | 10 PM to 7 AM |
| Bluefin Health (BFH) | Friday, Saturday | Mixed: Cebu 7 AM, Manila 10 PM |
| Kestrel Bank (KSB) | Sunday, Monday | 7 AM to 4 PM |

The next three weeks are published. Scripted cases: Paul Ignacio's sick leave today, filed this morning and approved (a gap, short notice); Kristine Dizon's emergency leave for tonight, pending (short notice); Joanna Lopez's vacation leave next week, pending; Cherry Mae Uy's vacation leave approved two weeks ago, so those days can't be scheduled. Use **Prototype: view as** Jerome Tolentino (Operations) or Angelica Santiago (Team lead) to see both views.

## Not yet

- Shift bidding and swaps between agents, and shift templates ("Kestrel week") to paint a pattern in one go.
- Headcount targets per client and interval (how many agents each hour) and the coverage forecast against them.
- Email or push for notifications. They're in-app only.
- Notifying the employee when operations changes their upcoming schedule.
- Splitting a person across several clients.
