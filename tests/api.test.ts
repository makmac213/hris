// /api/v1 against the in-memory store. Run with `npm test`.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handle } from "@/lib/server/http";
import { resetMemoryRepo } from "@/lib/server/repo";
import { generateApiKey } from "@/lib/server/auth";
import type { ApiScope } from "@/lib/server/repo/types";
import { ORG_ID } from "@/lib/mock-data";

let repo = resetMemoryRepo();
beforeEach(() => { repo = resetMemoryRepo(); });

async function call(method: string, path: string, opts: { as?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.as) headers.authorization = `Bearer dev:${opts.as}`;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await handle(new Request(`http://localhost/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

function apiKey(scopes: ApiScope[]) {
  const { key, row } = generateApiKey(ORG_ID, "Test device", scopes, new Date().toISOString());
  repo.addApiKey(row);
  return key;
}

test("no token: 401 in the error envelope, with a request id", async () => {
  const r = await call("GET", "/me");
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "unauthenticated");
  assert.ok(r.headers.get("x-request-id"));
});

test("unknown route is 404; wrong method is 405 with Allow", async () => {
  assert.equal((await call("GET", "/nope", { as: "e04" })).status, 404);
  const r = await call("PATCH", "/me", { as: "e04" });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "GET");
});

test("/me returns the employee and role", async () => {
  const r = await call("GET", "/me", { as: "e10" });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, "hr");
  assert.equal(r.body.can_manage, true);
});

test("development tokens can be turned off", async () => {
  process.env.HALDEN_DEV_TOKENS = "0";
  try { assert.equal((await call("GET", "/me", { as: "e04" })).status, 401); }
  finally { delete process.env.HALDEN_DEV_TOKENS; }
});

test("the directory hides private fields from other employees", async () => {
  const asEmployee = await call("GET", "/employees/e13", { as: "e16" });
  assert.equal(asEmployee.status, 200);
  assert.equal(asEmployee.body.birth_date, undefined);
  assert.equal(asEmployee.body.employment_status_ph, undefined);
  const asHr = await call("GET", "/employees/e13", { as: "e10" });
  assert.equal(asHr.body.employment_status_ph, "regular");
  assert.ok(Array.isArray(asHr.body.alerts));
});

test("lists paginate with a cursor", async () => {
  const p1 = await call("GET", "/employees?limit=10", { as: "e04" });
  assert.equal(p1.body.data.length, 10);
  const p2 = await call("GET", `/employees?limit=10&cursor=${p1.body.next_cursor}`, { as: "e04" });
  assert.equal(p2.body.data.length, 10);
  assert.ok(p2.body.data[0].id > p1.body.data[9].id);
  assert.equal((await call("GET", "/employees?limit=500", { as: "e04" })).status, 422);
});

test("pay is private: self, admin and HR only; not managers", async () => {
  assert.equal((await call("GET", "/payslips", { as: "e13" })).status, 200);
  assert.equal((await call("GET", "/payslips?employee_id=e19", { as: "e08" })).status, 403, "e08 manages e19 but can't see pay");
  const hr = await call("GET", "/payslips?employee_id=e19", { as: "e10" });
  assert.equal(hr.status, 200);
  assert.ok(hr.body.data[0].net > 0);
  assert.equal((await call("GET", "/payroll-periods", { as: "e13" })).status, 403);
});

test("leave: checks the balance, then the manager decides; nobody decides their own", async () => {
  const bad = await call("POST", "/leave-requests", { as: "e19", body: { leave_type_id: "lt-vl", start_date: "2026-12-03", end_date: "2026-12-01", reason: "Trip" } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, "validation_failed");
  assert.ok(bad.body.error.details.end);

  const day = "2026-12-03"; // a Thursday, not a holiday
  const filed = await call("POST", "/leave-requests", { as: "e19", body: { leave_type_id: "lt-vl", start_date: day, end_date: day, reason: "Family errand" } });
  assert.equal(filed.status, 201);
  assert.equal(filed.body.status, "pending");
  assert.equal(filed.body.days, 1);

  assert.equal((await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e19", body: { approve: true } })).status, 403);
  assert.equal((await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e16", body: { approve: true } })).status, 403, "not their manager");
  const reject = await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e08", body: { approve: false } });
  assert.equal(reject.status, 422, "rejecting needs a reason");
  const ok = await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e08", body: { approve: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.decided_by, "e08");
  assert.equal((await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e10", body: { approve: false, note: "Changed my mind" } })).status, 409);

  const queue = await call("GET", "/leave-requests?scope=to_decide&status=pending", { as: "e10" });
  assert.ok(queue.body.data.every((r: { employee_id: string }) => r.employee_id !== "e10"));
});

test("leave not yet earned is refused with the reason", async () => {
  const r = await call("POST", "/leave-requests", { as: "e37", body: { leave_type_id: "lt-vl", start_date: "2026-12-02", end_date: "2026-12-02", reason: "Errand" } });
  assert.equal(r.status, 422);
  assert.match(r.body.error.message, /6 months/);
});

test("approving a correction adds a correction record and keeps the original", async () => {
  const before = (await repo.snapshot(ORG_ID)).time_records.length;
  const r = await call("POST", "/correction-requests/cr-2/decision", { as: "e10", body: { approve: true } });
  assert.equal(r.status, 200);
  const db = await repo.snapshot(ORG_ID);
  assert.equal(db.time_records.length, before + 1);
  assert.equal(db.time_records.at(-1)!.source, "correction");
  assert.equal(db.time_records.at(-1)!.correction_request_id, "cr-2");
});

test("only the filer withdraws, and only while pending", async () => {
  assert.equal((await call("POST", "/overtime-requests/ot-3/cancel", { as: "e10" })).status, 403);
  assert.equal((await call("POST", "/overtime-requests/ot-3/cancel", { as: "e16" })).status, 200);
  assert.equal((await call("POST", "/overtime-requests/ot-3/cancel", { as: "e16" })).status, 409);
});

test("overtime from managerial staff is refused (Art. 82)", async () => {
  const r = await call("POST", "/overtime-requests", { as: "e10", body: { work_date: "2026-11-20", start_at: "2026-11-20T18:00:00+08:00", end_at: "2026-11-20T20:00:00+08:00", reason: "Year-end planning session" } });
  assert.equal(r.status, 409);
});

test("time records: people get server time; devices need the scope and can send the punch time", async () => {
  const body = { kind: "clock_in", photo_path: "p/1.jpg", latitude: 14.55, longitude: 121.02, accuracy_m: 8 };
  const withTime = await call("POST", "/time-records", { as: "e34", body: { ...body, recorded_at: new Date().toISOString() } });
  assert.equal(withTime.status, 422);
  const noPhoto = await call("POST", "/time-records", { as: "e34", body: { ...body, photo_path: "" } });
  assert.equal(noPhoto.status, 422);

  const readOnly = apiKey(["employees:read"]);
  assert.equal((await call("POST", "/time-records", { token: readOnly, body: { ...body, employee_id: "e34" } })).status, 403);
  const device = apiKey(["time:write"]);
  const at = new Date(Date.now() - 3600000).toISOString();
  const r = await call("POST", "/time-records", { token: device, body: { ...body, employee_id: "e34", recorded_at: at } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.recorded_at, at);
  assert.match(r.body.device, /^api-key:hk_live_/);
});

test("Idempotency-Key: a retry returns the first response and does the work once", async () => {
  const device = apiKey(["time:write"]);
  const body = { kind: "clock_in", photo_path: "p/2.jpg", latitude: 14.55, longitude: 121.02, accuracy_m: 8, employee_id: "e34", recorded_at: new Date(Date.now() - 600000).toISOString() };
  const headers = { "idempotency-key": "punch-123" };
  const a = await call("POST", "/time-records", { token: device, body, headers });
  const b = await call("POST", "/time-records", { token: device, body, headers });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.body.id, a.body.id);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  const c = await call("POST", "/time-records", { token: device, body });
  assert.equal(c.status, 409, "without the key, the duplicate time in is refused");
});

test("API keys: revoked keys fail; keys can't decide requests or finalize payroll", async () => {
  const key = apiKey(["requests:write", "payroll:write", "payroll:read"]);
  assert.equal((await call("POST", "/overtime-requests/ot-3/decision", { token: key, body: { approve: true } })).status, 403);
  const periods = await call("GET", "/payroll-periods", { token: key });
  assert.equal(periods.status, 200);
  assert.equal((await call("POST", `/payroll-periods/${periods.body.data[0].id}/finalize`, { token: key })).status, 403);
  assert.equal((await call("GET", "/me", { token: "hk_live_not-a-real-key" })).status, 401);
});

test("finalizing the open period before its cutoff is a conflict", async () => {
  const periods = await call("GET", "/payroll-periods", { as: "e04" });
  const open = periods.body.data.find((p: { status: string }) => p.status === "open");
  const r = await call("POST", `/payroll-periods/${open.id}/finalize`, { as: "e04" });
  assert.equal(r.status, 409);
});

test("hiring in Manila starts probation; duplicate emails are refused", async () => {
  const body = { first_name: "Lia", last_name: "Torres", work_email: "lia.torres@halden.co", job_title: "Analyst", department_id: "dep-finance", location_id: "loc-mnl", manager_id: "e24", start_date: "2026-12-07" };
  const r = await call("POST", "/employees", { as: "e10", body });
  assert.equal(r.status, 201);
  assert.equal(r.body.employment_status_ph, "probationary");
  assert.equal(r.body.probation_end_date, "2027-06-04");
  assert.equal((await call("POST", "/employees", { as: "e10", body })).status, 422);
  assert.equal((await call("POST", "/employees", { as: "e13", body: { ...body, work_email: "x@halden.co" } })).status, 403);
  const tooLong = await call("PATCH", `/employees/${r.body.id}`, { as: "e10", body: { probation_end_date: "2027-07-01" } });
  assert.equal(tooLong.status, 422);
  assert.match(tooLong.body.error.message, /Art\. 296/);
});

test("final pay preview and separation", async () => {
  const preview = await call("GET", "/employees/e13/final-pay?last_day=2026-12-15&reason=redundancy&notice_date=2026-11-10", { as: "e10" });
  assert.equal(preview.status, 200);
  assert.ok(preview.body.lines.some((l: { key: string }) => l.key === "separation"));
  assert.equal(preview.body.dueBy, "2027-01-14");
  assert.equal((await call("GET", "/employees/e13/final-pay?last_day=2026-12-15&reason=redundancy", { as: "e08" })).status, 403);
  const sep = await call("POST", "/employees/e13/separation", { as: "e10", body: { last_day: "2026-12-15", reason: "redundancy", notice_date: "2026-11-10" } });
  assert.equal(sep.status, 200);
  assert.equal(sep.body.final_pay_due_by, "2027-01-14");
  assert.equal((await call("POST", "/employees/e13/separation", { as: "e10", body: { last_day: "2026-12-20", reason: "redundancy" } })).status, 409);
});

test("leave balances: self and manager yes, a colleague no", async () => {
  const self = await call("GET", "/employees/e19/leave-balances", { as: "e19" });
  assert.equal(self.status, 200);
  assert.ok(self.body.data.some((b: { leave_type_id: string }) => b.leave_type_id === "lt-vl"));
  assert.equal((await call("GET", "/employees/e19/leave-balances", { as: "e08" })).status, 200);
  assert.equal((await call("GET", "/employees/e19/leave-balances", { as: "e16" })).status, 403);
});

test("year-end figures for admin and HR", async () => {
  const r = await call("GET", "/year-end/2026", { as: "e04" });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length > 5);
  assert.ok(r.body.deadlines.some((d: { form: string }) => d.form === "BIR Form 2316"));
});

test("the OpenAPI spec is public and covers every route", async () => {
  const r = await call("GET", "/openapi.json");
  assert.equal(r.status, 200);
  assert.equal(r.body.openapi, "3.1.0");
  assert.ok(r.body.paths["/leave-requests/{id}/decision"].post.requestBody);
  assert.ok(r.body.paths["/employees"].get.parameters.some((p: { name: string }) => p.name === "q"));
});

// ---- Organization and schedule ---------------------------------------------------

const SEED_TODAY = (await resetMemoryRepo().snapshot(ORG_ID)).leave_requests.find((r) => r.id === "lv-10")!.start_date;

test("schedule: operations sees everyone and the gap; managers their team; others only themselves", async () => {
  const q = `/schedule?from=${SEED_TODAY}&to=${SEED_TODAY}`;
  const ops = await call("GET", `${q}&department_id=dep-ops`, { as: "e40" });
  assert.equal(ops.status, 200);
  const paul = ops.body.data.find((r: { employee: { id: string } }) => r.employee.id === "e43");
  assert.equal(paul.days[0].coverage_gap, true);
  assert.equal(paul.days[0].leave.status, "approved");
  const lead = await call("GET", q, { as: "e41" });
  assert.deepEqual(new Set(lead.body.data.map((r: { employee: { id: string } }) => r.employee.id)), new Set(["e41", "e42", "e43", "e47"]));
  const agent = await call("GET", q, { as: "e42" });
  assert.deepEqual(agent.body.data.map((r: { employee: { id: string } }) => r.employee.id), ["e42"]);
  assert.equal((await call("GET", `/schedule?from=${SEED_TODAY}&to=2099-01-01`, { as: "e40" })).status, 422);
});

test("schedule: only operations, admin and HR assign; approved leave is refused, pending leave is a warning", async () => {
  const db = await repo.snapshot(ORG_ID);
  const approved = db.leave_requests.find((r) => r.id === "lv-12")!;
  const pending = db.leave_requests.find((r) => r.id === "lv-11")!;
  const one = (employee_id: string, date: string) => ({ entries: [{ employee_id, date, shift_code_id: "sc-ph-d0700" }] });
  assert.equal((await call("PUT", "/schedule", { as: "e42", body: one("e44", pending.start_date) })).status, 403);
  assert.equal((await call("PUT", "/schedule", { as: "e41", body: one("e42", pending.start_date) })).status, 403, "team leads view, operations schedules");
  const refused = await call("PUT", "/schedule", { as: "e40", body: one("e46", approved.start_date) });
  assert.equal(refused.status, 422);
  assert.match(refused.body.error.details[`e46:${approved.start_date}`], /approved vacation leave/);
  const warned = await call("PUT", "/schedule", { as: "e40", body: one("e44", pending.start_date) });
  assert.equal(warned.status, 200);
  assert.match(warned.body.warnings[`e44:${pending.start_date}`], /notified/);
  const reset = await call("DELETE", "/schedule", { as: "e40", body: { entries: [{ employee_id: "e44", date: pending.start_date }] } });
  assert.equal(reset.body.reset, 1);
  const key = apiKey(["schedule:read", "schedule:write"]);
  assert.equal((await call("PUT", "/schedule", { token: key, body: one("e44", pending.start_date) })).status, 200, "a WFM tool with schedule:write");
});

test("approving leave on scheduled shifts notifies operations; they can read and clear it", async () => {
  const d = await call("POST", "/leave-requests/lv-11/decision", { as: "e04", body: { approve: true } });
  assert.equal(d.status, 200);
  assert.ok(d.body.notified.includes("e40") && d.body.notified.includes("e45"), "operations and the manager");
  const list = await call("GET", "/notifications?unread=true", { as: "e40" });
  const n = list.body.data.find((x: { employee_id: string; kind: string }) => x.employee_id === "e44" && x.kind === "leave_approved_on_shift");
  assert.ok(n);
  const gaps = await call("GET", "/schedule/gaps?department_id=dep-ops", { as: "e40" });
  assert.ok(gaps.body.data.some((g: { employee_id: string }) => g.employee_id === "e44"));
  assert.equal((await call("POST", "/notifications/read", { as: "e40", body: { ids: [n.id] } })).body.marked, 1);
  assert.equal((await call("GET", "/notifications", { token: apiKey(["schedule:read"]) })).status, 403);
});

test("organization: clients, members and archiving; departments with people can't be deleted", async () => {
  const c = await call("POST", "/clients", { as: "e10", body: { name: "Harbor Air", code: "hba", industry: "Airline" } });
  assert.equal(c.status, 201);
  assert.equal(c.body.code, "HBA");
  assert.equal((await call("POST", "/clients", { as: "e10", body: { name: "Other", code: "HBA" } })).status, 422);
  assert.equal((await call("POST", "/clients", { as: "e40", body: { name: "X", code: "XX" } })).status, 403);
  assert.equal((await call("POST", `/clients/${c.body.id}/members`, { as: "e10", body: { employee_ids: ["e42", "e43"] } })).body.moved, 2);
  assert.equal((await call("GET", "/employees/e42", { as: "e10" })).body.client_id, c.body.id);
  await call("PATCH", `/clients/${c.body.id}`, { as: "e10", body: { archived: true } });
  assert.equal((await call("GET", "/employees/e42", { as: "e10" })).body.client_id, null);
  assert.equal((await call("DELETE", "/departments/dep-ops", { as: "e10" })).status, 409);
  const dep = await call("POST", "/departments", { as: "e10", body: { name: "Quality Assurance" } });
  assert.equal((await call("DELETE", `/departments/${dep.body.id}`, { as: "e10" })).status, 200);
  const br = await call("POST", "/branches", { as: "e10", body: { name: "Davao", city: "Davao City", country_code: "PH" } });
  assert.equal(br.status, 422, "a Philippine branch needs a region");
  assert.equal((await call("POST", "/branches", { as: "e10", body: { name: "Davao", city: "Davao City", country_code: "PH", ph_region: "XI" } })).status, 201);
});

test("schedule settings: operations can widen the window within limits", async () => {
  assert.equal((await call("PATCH", "/schedule/settings", { as: "e40", body: { horizon_days: 90 } })).body.horizon_days, 90);
  assert.equal((await call("PATCH", "/schedule/settings", { as: "e40", body: { horizon_days: 400 } })).status, 422);
  assert.equal((await call("PATCH", "/schedule/settings", { as: "e16", body: { horizon_days: 30 } })).status, 403);
});

test("approvers: the direct supervisor, plus the roles the organization turns on", async () => {
  const day = "2026-12-03";
  const filed = await call("POST", "/leave-requests", { as: "e19", body: { leave_type_id: "lt-vl", start_date: day, end_date: day, reason: "Family errand" } });
  assert.equal(filed.status, 201);
  assert.ok(filed.body.approver_ids.includes("e08"), "their supervisor");
  assert.ok(filed.body.approver_ids.includes("e04") && filed.body.approver_ids.includes("e10"), "admin and HR by default");
  assert.ok(!filed.body.approver_ids.includes("e40"), "operations is off by default");

  const who = await call("GET", "/approvers?employee_id=e19", { as: "e19" });
  assert.equal(who.body.supervisor_id, "e08");
  assert.deepEqual(who.body.roles, ["admin", "hr"]);

  assert.equal((await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e40", body: { approve: true } })).status, 403);
  assert.equal((await call("PATCH", "/approval-settings", { as: "e19", body: { approver_roles: ["operations"] } })).status, 403, "employees can't change who approves");
  assert.equal((await call("PATCH", "/approval-settings", { as: "e10", body: { approver_roles: ["admin"] } })).status, 422, "admin is always on, not a choice");
  const saved = await call("PATCH", "/approval-settings", { as: "e10", body: { approver_roles: ["operations"] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.approver_roles, ["operations"]);

  assert.equal((await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e22", body: { approve: true } })).status, 403, "HR is now off");
  const ok = await call("POST", `/leave-requests/${filed.body.id}/decision`, { as: "e40", body: { approve: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.decided_by, "e40");
});

test("payslips: employees get their issued payslips; the open period only on request, as an estimate", async () => {
  const mine = await call("GET", "/payslips", { as: "e19" });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data.length >= 1);
  assert.ok(mine.body.data.every((s: { employee_id: string; estimate: boolean }) => s.employee_id === "e19" && !s.estimate), "issued only, own only");

  const withEstimate = await call("GET", "/payslips?include_estimate=true", { as: "e19" });
  assert.equal(withEstimate.body.data.filter((s: { estimate: boolean }) => s.estimate).length, 1);

  const id = mine.body.data[0].id;
  const one = await call("GET", `/payslips/${encodeURIComponent(id)}`, { as: "e19" });
  assert.equal(one.status, 200);
  assert.equal(one.body.net, mine.body.data[0].net);
  assert.ok(Array.isArray(one.body.days));

  const theirs = id.replace(":e19", ":e16");
  assert.equal((await call("GET", `/payslips/${encodeURIComponent(theirs)}`, { as: "e19" })).status, 403, "not someone else's");
  assert.equal((await call("GET", `/payslips/${encodeURIComponent(theirs)}`, { as: "e08" })).status, 403, "not even their manager");
  assert.equal((await call("GET", `/payslips/${encodeURIComponent(theirs)}`, { as: "e10" })).status, 200, "HR can");
});
