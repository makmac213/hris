# Halden HRIS: employee management prototype

A clickable prototype of the first HRIS module: the employee directory, employee profiles, the org chart and onboarding. It is built in Next.js (App Router) and runs on in-memory mock data, with the rows shaped like the Supabase schema planned for later.

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
supabase/migrations/    0001_employee_management.sql, the draft schema
preview/, scripts/      The single-file preview build (the same views, with hash routing)
```

### Moving to Supabase

1. Apply `supabase/migrations/0001_employee_management.sql` and seed it from `lib/mock-data.ts`. The column names match.
2. Swap `lib/types.ts` for `supabase gen types typescript` output.
3. Re-implement the functions in `lib/store.ts` (`useDb`, `createEmployee`, `updateEmployee`, `setTaskDone`, `setBuddy`) with supabase-js. Use server actions for writes and React Query, or server components, for reads. The views don't need to change.
4. Add RLS policies scoped to `organization_id`. RLS is already enabled on every table, so nothing is readable until the policies exist.

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

Known gaps, deferred to the Supabase phase: there is no persistence (a reload resets the data), no authentication or roles, document upload and download, an audit log, or import from CSV.
