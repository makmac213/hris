# Who approves requests

Employees file leave, overtime and time correction requests from My leave and My time (or `POST /leave-requests`, `/overtime-requests`, `/correction-requests`). One rule decides who can approve all three, in the web app and the API alike (`lib/approvals.ts`).

## The rule

A request can be approved or rejected by:

1. **The person's direct supervisor**, meaning the employee set as their manager on their profile. A supervisor who has been offboarded no longer approves.
2. **Anyone in an approver role.** Admin is always an approver, so a request is never left with nobody to decide it. HR is on by default. HR and Operations can each be turned on or off.

Nobody approves their own request, whatever their role. API keys can file and read but never decide, because a decision needs a person.

If someone has no active supervisor, their requests go to the approver roles only.

## Changing the approver roles

- **Web app:** Approvals, then **Who approves** (admin and HR only).
- **API:** `PATCH /approval-settings` with `{ "approver_roles": ["hr", "operations"] }` (admin and HR). `GET /approval-settings` reads it.

Supervisors are changed on each person's profile (Manager), not here.

## Where people see it

- The leave form says who the request goes to, for example "Goes to your supervisor, Jasmine Villanueva, or HR and admin." The confirmation after filing overtime or a correction says the same.
- `GET /approvers?employee_id=` returns the supervisor, the roles and every person who can decide. Filing responses include `approver_ids`.
- Approvals lists only requests the viewer can decide. Supervisors see their direct reports. People in an approver role see everyone except themselves.

## Data

- `approval_settings` (one row per organization): `approver_roles app_role[]`, limited to `hr` and `operations`. Migration `0007_approval_settings.sql`.
- `can_approve(approver, employee)` in the same migration is the SQL copy of the rule, for row level security policies and the `decide_*` functions.

## Not yet

- Approval by someone further up the chain (skip-level) when the supervisor is away, and delegation while on leave.
- Approver roles per request type, for example HR for leave but supervisors only for overtime.
- Multi-step approval (supervisor, then HR).
- Telling approvers when a request is filed. Today they see it in Approvals and its count in the sidebar.
