# Employee management

Status: built, on `main`.

| Area | Route | What you can do |
| --- | --- | --- |
| Directory | `/employees` | Search by name, title, email or ID. Filter by department, location and status (former employees are hidden by default). Sort any column. Add an employee. |
| Profile | `/employees/[id]` | Job and contact details, the reporting line, direct reports, employment history and documents. Edit details: the manager picker leaves out the person's own reports, so you can't create a reporting loop. Admin and HR assign the shift code here. |
| Org chart | `/org-chart` | Collapsible tree, find a person, highlight a department, expand or collapse everything, zoom and fit to width. `?focus=<id>` opens the chart on one person. |
| Onboarding | `/onboarding`, `/onboarding/[id]` | New hires grouped by "starting soon" and "first 90 days", with progress and overdue counts. A 14-task checklist in four phases, a filter by owner (People team, IT, manager, new hire, buddy) and buddy assignment. |

Adding an employee creates their profile and an onboarding checklist from the standard template, with due dates set from the start date, and then opens that checklist.

Schema: `supabase/migrations/0001_employee_management.sql` (organizations, departments, locations, employees, employment_events, documents, onboarding templates and tasks).
