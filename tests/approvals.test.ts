import { test } from "node:test";
import assert from "node:assert/strict";
import { approversFor, approverText, canApprove } from "@/lib/approvals";
import { displayName } from "@/lib/format";
import { seed } from "@/lib/mock-data";
import type { Database } from "@/lib/types";

const person = (db: Database, id: string) => db.employees.find((e) => e.id === id)!;

test("the direct supervisor approves, a colleague doesn't, nobody approves their own", () => {
  assert.equal(canApprove(seed, person(seed, "e08"), "e19"), true);
  assert.equal(canApprove(seed, person(seed, "e16"), "e19"), false);
  assert.equal(canApprove(seed, person(seed, "e10"), "e10"), false, "HR can't approve their own");
  assert.equal(canApprove(seed, person(seed, "e04"), "e19"), true, "admin always");
});

test("an offboarded supervisor no longer approves; the roles still do", () => {
  const db: Database = { ...seed, employees: seed.employees.map((e) => (e.id === "e08" ? { ...e, status: "offboarded" as const } : e)) };
  assert.equal(canApprove(db, person(db, "e08"), "e19"), false);
  const a = approversFor(db, "e19");
  assert.equal(a.supervisor, null);
  assert.ok(a.people.some((e) => e.id === "e10"));
  assert.equal(approverText(db, "e19", displayName), "HR and admin");
});

test("roles can be turned on and off; the supervisor is named first", () => {
  const db: Database = { ...seed, approval_settings: { approver_roles: ["operations"] } };
  assert.equal(canApprove(db, person(db, "e40"), "e19"), true);
  assert.equal(canApprove(db, person(db, "e10"), "e19"), false);
  const a = approversFor(db, "e19");
  assert.equal(a.people[0].id, "e08");
  assert.match(approverText(db, "e19", displayName), /^your supervisor, .+, or operations and admin$/);
});
