# Halden HRIS prototype

A clickable prototype of the HRIS. It covers employee management (the directory, profiles, the org chart and onboarding) and timekeeping (shift codes, recording time and attendance). It is built in Next.js (App Router) and runs on in-memory mock data, with the rows shaped like the Supabase schema planned for later.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
npm run build          # production build and type check
npm run preview:build  # builds dist/preview/index.html, a single-file version you can share
```

## What's in it

| Area | Route | What you can do |
| --- | --- | --- |
| Directory | `/employees` | Search by name, title, email or ID. Filter by department, location and status (former employees are hidden by default). Sort any column. Add an employee. |
| Profile | `/employees/[id]` | Job and contact details, the reporting line, direct reports, employment history and documents. Edit details: the manager picker leaves out the person's own reports, so you can't create a reporting loop. |
| Org chart | `/org-chart` | Collapsible tree, find a person, highlight a department, expand or collapse everything, zoom and fit to width. `?focus=<id>` opens the chart on one person. |
| Onboarding | `/onboarding`, `/onboarding/[id]` | New hires grouped by "starting soon" and "first 90 days", with progress and overdue counts. A 14-task checklist in four phases, a filter by owner (People team, IT, manager, new hire, buddy) and buddy assignment. |

| My time | `/my-time` | Employees record time in and time out. Each record requires the server time, a photo from the device camera and a GPS location; the button stays disabled until all three are ready. A warning appears before timing out early. Shows today's records and recent days. |
| Attendance | `/time` | Admin and HR only. Shows who timed in on each of the last five workdays, against their shift. Filters for late, not timed in and no time out. Select a row to see the photos, coordinates, GPS accuracy and device for that day. |
| Shift codes | `/time/shift-codes` | Admin and HR only. There are nine Philippine default codes: whole-day shifts are 9 hours (8 paid plus a 1-hour meal break) and half-day shifts are 4 hours. You can upload codes from a CSV (with row-by-row validation before import), add one at a time, assign people in bulk, make a code the default for new hires, or archive it. |

Use the **Prototype: view as** switcher at the bottom of the sidebar to change roles. Marisol is an admin, Leah is HR, and Miguel and Paolo are employees (Paolo works a half-day shift). Admin and HR can assign a shift code on any profile through Edit details. Employees can't edit profiles and only see My time, the directory and the org chart.

Adding an employee creates their profile and an onboarding checklist from the standard template, with due dates set from the start date, and then opens that checklist.

## Structure

```
app/                    Next.js routes (thin: each one renders a view)
features/               One folder per module: directory, profile, org, onboarding
components/ui/          Design-system primitives: Button, Field, Dialog, Badge, Avatar, Progress…
components/AppShell.tsx Sidebar navigation and responsive shell
lib/types.ts            Row types that mirror the SQL schema
lib/mock-data.ts        Sample company (38 fictional people, 9 departments, 5 locations)
lib/store.ts            The data layer: every read and write goes through here
styles/globals.css      Design tokens and component styles
lib/time.ts             Shift maths, Philippine defaults, daily attendance rules, CSV parsing
features/time/          My time, Record Time dialog, Attendance and Shift codes
supabase/migrations/    0001_employee_management.sql, 0002_timekeeping.sql
preview/, scripts/      The single-file preview build (the same views, with hash routing)
```

### Moving to Supabase

1. Apply `supabase/migrations/0001_employee_management.sql` and seed it from `lib/mock-data.ts`. The column names match.
2. Swap `lib/types.ts` for `supabase gen types typescript` output.
3. Re-implement the functions in `lib/store.ts` (`useDb`, `createEmployee`, `updateEmployee`, `setTaskDone`, `setBuddy`) with supabase-js. Use server actions for writes and React Query, or server components, for reads. The views don't need to change.
4. Make `recordTime` a server action. The server sets `recorded_at` (never the client), uploads the photo to a private `time-photos` Storage bucket, and rejects the insert if the photo or GPS fields are missing. The columns are `not null` too.
5. Add RLS policies scoped to `organization_id`. RLS is already enabled on every table, so nothing is readable until the policies exist.

## Design system

- **Type:** IBM Plex Sans. Sizes are 13 (meta), 14 (body), 16 (section), 20 (dialog title) and 28 (page title), with tabular figures for dates and IDs.
- **Colour:** OKLCH tokens, with cool neutrals and one cobalt accent for actions and selection. Status colours appear only in badges and warnings. Dark mode comes from the same tokens through `light-dark()`.
- **Shape:** one 6px radius everywhere. Avatars are the only circles.
- **Spacing:** a 4px scale (4, 8, 12, 16, 24, 32, 48). Borders separate sections; shadows are only used on floating layers like dialogs, menus and the zoom control.
- **Motion:** 150ms ease-out for hover and press and 160ms for dialogs. All motion turns off under `prefers-reduced-motion`.

## Design critique (impeccable.style method)

The prototype was reviewed screen by screen against impeccable.style's slop list and its hierarchy, clarity and craft criteria, then fixed.

| Severity | Finding | Fix |
| --- | --- | --- |
| P1 | Every directory row had a green "Active" badge, so the rows that needed attention didn't stand out. | Active is now plain muted text. Badges appear only for Onboarding, On leave and Former. |
| P1 | The org chart cut off the sixth executive at desktop width. | Narrower nodes, a fit-to-width zoom that runs on load, and zoom controls. |
| P1 | Focusing a person in the org chart scrolled the whole page and moved the sidebar. | The chart now scrolls only inside its own canvas. |
| P1 | The "Overdue" due date on a checklist task was grey because the base style overrode the danger colour. | The overdue date is now red, and overdue next tasks are flagged on the onboarding list too. |
| P1 | In the add-employee form, an old email error stayed visible after the email was filled in automatically. | Editing the name now clears the email error. |
| P2 | The closed mobile sidebar could still take keyboard focus. | It is hidden from focus and screen readers when closed. |
| P2 | Picking a buddy didn't tick the "Choose an onboarding buddy" task. | The two are linked. |
| P2 | Long emails overflowed the profile panel on phones. | They now wrap. |
| P2 | Each org chart node had four lines of text, which made the chart noisy. | The department line was removed. Use "Highlight a department" instead. |

Things that were checked and pass: every input has a visible label (no placeholder-only labels), there is one primary action per screen, heading levels are in order, targets are at least 32px (40px for main controls), focus rings are visible, there are empty and not-found states, long names are handled (`Max von Hohenberg-Castellanos`), there are no nested cards, no gradient accents, no eyebrow labels and no metric-tile grids.

### Timekeeping review

| Severity | Finding | Fix |
| --- | --- | --- |
| P1 | An employee could time out hours before the end of their shift without any warning. | The dialog now says when the shift ends and how much will count as undertime. The day then shows "timed out early". |
| P1 | Every shift-code row had three text buttons (Assign, Make default, Archive), so the table was a wall of equal-weight actions. | One "Assign people" button per row. The other actions moved into a "more" menu. |
| P1 | The labels mixed "clocked in" and "timed in". | Everything now says "time in" and "time out", matching "Record Time". |
| P2 | Number headers were right-aligned over left-aligned values. | Headers and values now line up. |
| P2 | Shift codes like OPS-D0730 wrapped onto two lines in the upload preview. | Codes no longer wrap. |
| P2 | The Attendance and Shift codes pages gave different counts of people without a shift code. | Both pages now use the same rule. |

The Record Time flow has a state for every step: starting the camera, camera blocked, retake, waiting for GPS, location blocked with a retry, and a server error. The single-file preview runs where browsers block the camera and GPS, so only there it also offers "choose a photo" and "use office location". Those fallbacks come from a build flag and are never in the Next.js app.

Known gaps, deferred to the Supabase phase: there is no persistence (a reload resets the data), real authentication (roles are simulated with the switcher), geofencing (records store coordinates but don't check them against an office radius yet), shift rotations and rest days other than weekends, overtime and payroll export, document upload and download, an audit log, or import from CSV.
