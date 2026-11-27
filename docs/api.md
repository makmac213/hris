# REST API plan (v1)

Halden needs an API for things the web app can't do on its own: a mobile app, biometric and time devices, and integrations with banks, accounting and other HR systems. It's served by the same Next.js app, at `/api/v1`, using the same server code as the web screens. The rules are enforced once, on the server, no matter how a request comes in.

## Shape

```
Browser (web app) ──server actions──┐
Mobile app ──────────────┐          │
Time devices ────────────┼─ /api/v1 ┼─► services (lib/server/services) ─► repository ─► Supabase Postgres (RLS)
Integrations ────────────┘          │         │                                   └► in-memory store (dev, tests)
                                    │         └─ payroll, leave, final pay and tax engines (lib/*.ts, unchanged)
```

- **Services** (`lib/server/services/`) hold every operation: who may do it, input checks, and the data it changes. Route handlers and server actions are thin wrappers around them.
- **Repository** (`lib/server/repo/`) is the only code that touches storage. There are two implementations:
  - `memory`: seeded from `lib/mock-data.ts`, used for development, tests and demos.
  - `supabase`: supabase-js, against the migrations in `supabase/migrations/`.

  `HALDEN_DATA=memory|supabase` picks one. Switching to Supabase needs no code change: set the environment variables listed under Configuration.
- **Engines** (`lib/payroll.ts`, `lib/leave.ts`, `lib/finalpay.ts`, `lib/yearend.ts`) are pure functions, so they run on the server as they are.

## Authentication

Every request sends `Authorization: Bearer <token>`. There are two kinds of token:

| Token | Who | How it's checked | Acts as |
| --- | --- | --- | --- |
| User session (Supabase JWT) | People using the mobile app or a client on their behalf | Verified by Supabase Auth, mapped to an employee by `employees.user_id` | That employee, with their role (admin, HR, manager, employee) |
| API key `hk_live_…` | Servers and devices: a payroll bank file job, a biometric terminal | SHA-256 hash looked up in `api_keys`; revoked or expired keys fail | The organization, limited to the key's scopes |

- **Scopes:** API keys carry only the scopes they need:
  - `employees:read`, `employees:write`
  - `time:write`
  - `requests:read`
  - `payroll:read`, `payroll:write`
  - `leave:read`
  - `schedule:read`, `schedule:write` (a workforce management tool)
- **Keys are shown once** when created. Only the hash is stored, along with the first 12 characters for display.
- **Development tokens:** in memory mode only, outside production, `Bearer dev:<employee_id>` signs in as that person. The app refuses to start with dev tokens when `NODE_ENV=production`.

### Permissions

These are the same rules as the web app:

- Admin and HR can see and change everything in their organization.
- A manager sees their direct reports and decides their requests.
- Operations sees and changes everyone's schedule, and nothing about pay or HR records.
- Everyone sees and files their own records.
- Nobody approves their own request.
- Pay is visible only to the person and to admin and HR, not to managers.

## Conventions

- **JSON only.** Field names are `snake_case`, the same as the database columns. Dates are `YYYY-MM-DD`; instants are ISO 8601 with an offset. Money is a number in pesos with 2 decimals.
- **Versioning:** `/api/v1` is frozen once published. New optional fields can be added; anything else needs `/api/v2`. Clients must ignore fields they don't know.
- **Lists** return `{ "data": [...], "next_cursor": "..." | null }`. Pass `?limit=` (1–200, default 50) and `?cursor=`. Filters are query parameters.
- **Errors** use one envelope and the matching HTTP status:

  ```json
  { "error": { "code": "validation_failed", "message": "The last day can't be before the first.", "details": { "end_date": "The last day can't be before the first." } } }
  ```

  The codes are:
  - `unauthenticated` (401)
  - `forbidden` (403)
  - `not_found` (404)
  - `validation_failed` (422)
  - `conflict` (409), used for things like a decided request, or a date in a finalized payroll period
  - `rate_limited` (429)
  - `internal` (500)
- **Idempotency:** `POST` requests accept an `Idempotency-Key` header. A retry with the same key returns the first response instead of doing the work twice. This matters for time devices on poor connections. Keys are kept for 24 hours.
- **Server time:** the server sets `recorded_at` on a time record from a person. Only an API key with `time:write` can send `recorded_at`, for devices that queue punches offline. Each such record is marked `source: "device"` and kept in the audit trail.
- **Request IDs:** every response has `X-Request-Id`, for support.
- **Rate limits:** 600 requests a minute per token. A 429 response carries `Retry-After`. This is enforced at the edge, through Vercel or a middleware store, once deployed.

## Resources

| Method and path | What | Who |
| --- | --- | --- |
| `GET /me` | The signed-in person, role and permissions | Anyone |
| `GET /employees` | Directory. Filters: `status`, `department_id`, `location_id`, `client_id`, `q` | Anyone (contact fields); admin and HR see everything |
| `POST /employees` | Hire: creates the employee, onboarding, and probation terms in the Philippines | Admin, HR |
| `GET /employees/{id}` | One person | Anyone; private fields for self, admin and HR |
| `PATCH /employees/{id}` | Update job, manager, shift and employment terms | Admin, HR |
| `POST /employees/{id}/regularize` | Make a probationary employee regular | Admin, HR |
| `POST /employees/{id}/separation` | Record a separation (last day, reason, notice date) | Admin, HR |
| `GET /employees/{id}/final-pay` | Final pay statement. Pass `last_day` and `reason` to preview before recording. | Admin, HR |
| `GET /employees/{id}/leave-balances` | Balances for `?year=` | Self, manager, admin, HR |
| `GET /shift-codes` | Shift codes | Anyone |
| `GET /time-records` | Filters: `employee_id`, `from`, `to` | Self, manager (team), admin, HR |
| `POST /time-records` | Clock in or out. Server time, photo path and GPS are required (Record Time rules). | Self; API key with `time:write` |
| `GET /overtime-requests` | Filters: `employee_id`, `status` | Self, approver |
| `POST /overtime-requests` | File overtime | Self |
| `POST /overtime-requests/{id}/decision` | `{ "approve": true }` or `{ "approve": false, "note": "…" }` | Approver, never self |
| `POST /overtime-requests/{id}/cancel` | Withdraw while pending | Self |
| `GET`, `POST /correction-requests`, `…/{id}/decision`, `…/{id}/cancel` | Time corrections. Approval adds a correction record and keeps the original. | Same as overtime |
| `GET /leave-types` | Leave policies, statutory and company | Anyone |
| `GET`, `POST /leave-requests`, `…/{id}/decision`, `…/{id}/cancel` | Leave, checked against balances and eligibility | Same as overtime |
| `GET /payroll-periods` | Periods and their status | Admin, HR |
| `GET /payroll-periods/{id}/payslips` | The register, computed or finalized | Admin, HR |
| `POST /payroll-periods/{id}/finalize` | Lock the period. Refused while requests are pending or anyone is below minimum wage. | Admin, HR |
| `GET /payslips` | Own payslips. Admin and HR can pass `employee_id`. Filter: `period_id` | Self, admin, HR |
| `GET /year-end/{year}` | Annualization and 2316 figures for everyone | Admin, HR |
| `GET`, `POST`, `PATCH`, `DELETE /departments`, `/branches`, `/clients` and `…/{id}/members` | Organization. See [scheduling.md](scheduling.md#api). | Read: anyone. Write: admin, HR |
| `GET`, `PUT`, `DELETE /schedule`, `GET /schedule/gaps`, `GET`, `PATCH /schedule/settings` | The operations schedule. See [scheduling.md](scheduling.md#api). | Operations, admin, HR; managers read their team |
| `GET /notifications`, `POST /notifications/read` | Your notifications | The person |
| `GET /openapi.json` | The machine-readable spec | Anyone |

### Not in v1

- Webhooks: for example `request.decided`, `payroll.finalized`, `employee.separated`. These are planned for v1.1 and will be signed with a shared secret.
- Bulk imports.
- Bank file and BIR file exports.
- Document upload.

## Configuration

| Variable | Used for |
| --- | --- |
| `HALDEN_DATA` | `memory` (default) or `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client for user sessions (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Used for API-key requests, which are scoped to the key's organization in code. |
| `HALDEN_DEV_TOKENS` | `1` allows `dev:<employee_id>` tokens in memory mode. Ignored in production. |

## Trying it

Run `npm run dev`, then:

```sh
curl -s localhost:3000/api/v1/me -H 'Authorization: Bearer dev:e10'
curl -s 'localhost:3000/api/v1/employees?q=castillo' -H 'Authorization: Bearer dev:e10'
curl -s localhost:3000/api/v1/leave-requests -H 'Authorization: Bearer dev:e19' -H 'Content-Type: application/json' \
  -d '{"leave_type_id":"lt-vl","start_date":"2026-12-03","end_date":"2026-12-03","reason":"Errand"}'
curl -s localhost:3000/api/v1/openapi.json
```

The development tokens use the sample company's employee ids: `e04` is an admin, `e10` is HR, `e08` manages `e19`, and `e13` is an employee. Data resets when the server restarts.

## Code

| File | What |
| --- | --- |
| `app/api/v1/[...path]/route.ts` | Next.js entry point, which hands every request to the pipeline |
| `lib/server/http.ts` | The pipeline: auth, routing, JSON parsing, idempotency, errors and request ids |
| `lib/server/routes.ts` | The route table; the OpenAPI spec is generated from it |
| `lib/server/services/` | Employees, time, requests, payroll, organization, schedule: permissions, validation and writes |
| `lib/server/auth.ts`, `context.ts` | Tokens, API keys, and the permission rules |
| `lib/server/repo/` | `memory.ts`, `supabase.ts`, and the `Repository` interface |
| `tests/api.test.ts` | Tests against the memory store |

## Rollout

1. **This PR:**
   - services, repository (memory and Supabase), `/api/v1`, auth, errors, idempotency and the OpenAPI spec
   - migration `0005_api.sql` with `api_keys`, `api_idempotency` and the `decide_correction` function
   - tests against the memory store
2. **When a Supabase project exists:**
   - apply the migrations and seed
   - write the RLS policies sketched in each migration
   - set the environment variables
   - run the API tests against a Supabase branch database
   - route correction decisions through `decide_correction()`, so the request and the new record are saved together; the memory store does them one after the other
3. **Web app:** move the screens from the in-browser store to server actions that call the same services.
4. **Later:** webhooks, an API key management screen, and rate limiting at the edge.
