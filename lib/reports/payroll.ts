// Payroll and statutory reports: register, contributions to remit, withholding tax, alphalist, 13th month.

import type { Database, Employee, PayrollPeriod } from "../types";
import { displayName, formatDate } from "../format";
import { RULES, SOURCES, thirteenthMonthPay, type Payslip } from "../payroll";
import { slipFor } from "../payslips";
import { annualSummary } from "../yearend";
import { LOAN_KINDS, loanSummary } from "../loans";
import type { ReportDef, Viewer } from "./types";
import { groupOf, orgScope, people, r2 } from "./common";

const payAccess = (v: Viewer) => (v.kind === "key" || v.role === "admin" || v.role === "hr" ? "all" : false) as "all" | false;
const sum = (ls: { key: string; amount: number }[], pre?: string) => ls.filter((l) => !pre || l.key === pre || l.key.startsWith(`${pre}-`)).reduce((n, l) => n + l.amount, 0);

/** The periods of a month that payroll has run (open or closed). */
export const periodsOfMonth = (db: Database, month: string) => db.payroll_periods.filter((p) => p.start_date.startsWith(month)).sort((a, b) => a.start_date.localeCompare(b.start_date));
export const latestClosed = (db: Database) => [...db.payroll_periods].filter((p) => p.status !== "open").sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? [...db.payroll_periods].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];

function slipsFor(db: Database, list: Employee[], periods: PayrollPeriod[], nowIso: string) {
  return list.map((e) => ({ e, slips: periods.map((pp) => slipFor(db, e, pp, nowIso)).filter((s): s is Payslip => !!s) })).filter((x) => x.slips.length);
}
const openNote = (periods: PayrollPeriod[]) => (periods.some((p) => p.status === "open") ? ["Includes a period that is still open: those figures are estimates until payroll is finalized."] : []);

export const register: ReportDef = {
  key: "payroll-register", title: "Payroll register", category: "payroll", access: payAccess,
  description: "Per person for one period: gross, contributions, tax, other deductions, net pay and the employer's cost.",
  filters: ["period", "org"],
  run(db, p, scope, nowIso) {
    const period = db.payroll_periods.find((x) => x.id === p.period_id) ?? latestClosed(db);
    if (!period) return { scope: "No payroll periods", columns: [], rows: [] };
    const list = slipsFor(db, people(db, p, scope), [period], nowIso);
    const rows = list.map(({ e, slips: [s] }) => ({
      name: displayName(e), employee_number: e.employee_number, department: groupOf(db, e, "department"),
      gross: r2(s.gross), contributions: r2(sum(s.contributions)), tax: r2(s.tax), other_deductions: r2(sum(s.otherDeductions)), net: r2(s.net),
      employer: r2(sum(s.employer.filter((l) => l.key.endsWith("-er")))), cost: r2(s.gross + sum(s.employer)),
    })).sort((a, b) => a.name.localeCompare(b.name));
    const tot = (k: keyof (typeof rows)[number]) => r2(rows.reduce((n, r) => n + (r[k] as number), 0));
    const byDept = new Map<string, number>();
    for (const r of rows) byDept.set(r.department, (byDept.get(r.department) ?? 0) + r.cost);
    return {
      scope: `${formatDate(period.start_date)} to ${formatDate(period.end_date)}, paid ${formatDate(period.pay_date)} · ${period.status === "open" ? "Open (estimate)" : period.status === "paid" ? "Paid" : "Finalized"}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "employee_number", label: "Employee no.", kind: "text" }, { key: "department", label: "Department", kind: "text" },
        { key: "gross", label: "Gross", kind: "money" }, { key: "contributions", label: "Contributions", kind: "money" }, { key: "tax", label: "Withholding tax", kind: "money" },
        { key: "other_deductions", label: "Other deductions", kind: "money" }, { key: "net", label: "Net pay", kind: "money" },
        { key: "employer", label: "Employer contributions", kind: "money" }, { key: "cost", label: "Total cost", kind: "money" },
      ],
      rows,
      totals: { name: "Total", employee_number: "", department: "", gross: tot("gross"), contributions: tot("contributions"), tax: tot("tax"), other_deductions: tot("other_deductions"), net: tot("net"), employer: tot("employer"), cost: tot("cost") },
      kpis: [
        { label: "Net pay", value: tot("net"), kind: "money", note: `${rows.length} people` },
        { label: "Gross pay", value: tot("gross"), kind: "money" },
        { label: "Total cost", value: tot("cost"), kind: "money", note: "Gross plus employer contributions" },
      ],
      charts: [{ kind: "bars", title: "Total cost by department", valueKind: "money", items: [...byDept].map(([label, value]) => ({ label, value: r2(value) })).sort((a, b) => b.value - a.value) }],
      notes: period.status === "open" ? openNote([period]) : ["Finalized periods show the payslips as issued."],
    };
  },
};

export const contributions: ReportDef = {
  key: "contributions", title: "Contributions to remit", category: "payroll", access: payAccess,
  description: "SSS, PhilHealth and Pag-IBIG for a month, both cutoffs together: employee and employer shares per person, and the totals to remit.",
  filters: ["month", "org"],
  sources: [SOURCES.sss, SOURCES.philhealth, SOURCES.pagibig],
  run(db, p, scope, nowIso) {
    const periods = periodsOfMonth(db, p.month);
    const list = slipsFor(db, people(db, p, scope), periods, nowIso);
    const ee = (s: Payslip[], k: string) => s.reduce((n, x) => n + sum(x.contributions, k) + sum(x.employer.filter((l) => l.key === `${k}-ee-by-er`)), 0);
    const er = (s: Payslip[], k: string) => s.reduce((n, x) => n + sum(x.employer.filter((l) => l.key === `${k}-er`)), 0);
    const rows = list.map(({ e, slips }) => {
      const r = {
        name: displayName(e), employee_number: e.employee_number,
        sss_ee: r2(ee(slips, "sss")), sss_er: r2(er(slips, "sss")),
        ph_ee: r2(ee(slips, "philhealth")), ph_er: r2(er(slips, "philhealth")),
        pagibig_ee: r2(ee(slips, "pagibig") + slips.reduce((n, x) => n + sum(x.contributions, "pagibig-voluntary"), 0)), pagibig_er: r2(er(slips, "pagibig")),
        total: 0,
      };
      r.total = r2(r.sss_ee + r.sss_er + r.ph_ee + r.ph_er + r.pagibig_ee + r.pagibig_er);
      return r;
    }).filter((r) => r.total > 0).sort((a, b) => a.name.localeCompare(b.name));
    const tot = (k: keyof (typeof rows)[number]) => r2(rows.reduce((n, r) => n + (r[k] as number), 0));
    return {
      scope: `${monthName(p.month)}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "employee_number", label: "Employee no.", kind: "text" },
        { key: "sss_ee", label: "SSS, employee", kind: "money" }, { key: "sss_er", label: "SSS, employer incl. EC", kind: "money" },
        { key: "ph_ee", label: "PhilHealth, employee", kind: "money" }, { key: "ph_er", label: "PhilHealth, employer", kind: "money" },
        { key: "pagibig_ee", label: "Pag-IBIG, employee", kind: "money" }, { key: "pagibig_er", label: "Pag-IBIG, employer", kind: "money" },
        { key: "total", label: "Total", kind: "money" },
      ],
      rows,
      totals: { name: "Total", employee_number: "", sss_ee: tot("sss_ee"), sss_er: tot("sss_er"), ph_ee: tot("ph_ee"), ph_er: tot("ph_er"), pagibig_ee: tot("pagibig_ee"), pagibig_er: tot("pagibig_er"), total: tot("total") },
      kpis: [
        { label: "SSS to remit", value: r2(tot("sss_ee") + tot("sss_er")), kind: "money" },
        { label: "PhilHealth to remit", value: r2(tot("ph_ee") + tot("ph_er")), kind: "money" },
        { label: "Pag-IBIG to remit", value: r2(tot("pagibig_ee") + tot("pagibig_er")), kind: "money" },
      ],
      notes: [
        ...openNote(periods),
        ...(periods.length < 2 ? ["Only one cutoff of this month has been run, so these are half-month figures."] : []),
        "An employee share the company pays for the employee still counts as the employee share owed. Voluntary Pag-IBIG savings are in the employee column.",
      ],
    };
  },
};

export const withholding: ReportDef = {
  key: "withholding", title: "Withholding tax (1601-C figures)", category: "payroll", access: payAccess,
  description: "Tax withheld on compensation for a month, per person: total pay, non-taxable pay, taxable pay and tax withheld. These are the BIR Form 1601-C totals.",
  filters: ["month", "org"],
  sources: [SOURCES.tax, SOURCES.taxExclusions],
  run(db, p, scope, nowIso) {
    const periods = periodsOfMonth(db, p.month);
    const list = slipsFor(db, people(db, p, scope), periods, nowIso);
    const rows = list.map(({ e, slips }) => {
      const gross = slips.reduce((n, s) => n + s.gross, 0), taxable = slips.reduce((n, s) => n + s.taxable, 0), tax = slips.reduce((n, s) => n + s.tax, 0);
      return { name: displayName(e), employee_number: e.employee_number, mwe: slips.some((s) => s.mwe) ? "Yes" : "No", gross: r2(gross), non_taxable: r2(gross - taxable), taxable: r2(taxable), tax: r2(tax) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const tot = (k: "gross" | "non_taxable" | "taxable" | "tax") => r2(rows.reduce((n, r) => n + r[k], 0));
    return {
      scope: `${monthName(p.month)}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "employee_number", label: "Employee no.", kind: "text" }, { key: "mwe", label: "Minimum wage earner", kind: "text" },
        { key: "gross", label: "Total compensation", kind: "money" }, { key: "non_taxable", label: "Non-taxable", kind: "money" }, { key: "taxable", label: "Taxable", kind: "money" }, { key: "tax", label: "Tax withheld", kind: "money" },
      ],
      rows,
      totals: { name: "Total", employee_number: "", mwe: "", gross: tot("gross"), non_taxable: tot("non_taxable"), taxable: tot("taxable"), tax: tot("tax") },
      kpis: [
        { label: "Tax withheld", value: tot("tax"), kind: "money", note: "Due by the 10th of next month" },
        { label: "Taxable compensation", value: tot("taxable"), kind: "money" },
        { label: "Non-taxable", value: tot("non_taxable"), kind: "money", note: "Contributions, de minimis, MWE pay" },
      ],
      notes: [...openNote(periods), "Non-taxable includes mandatory employee contributions, de minimis benefits within the ceilings, and a minimum wage earner's wage, holiday, overtime and night pay."],
    };
  },
};

export const alphalist: ReportDef = {
  key: "alphalist", title: "Alphalist (1604-C)", category: "payroll", access: payAccess,
  description: "The year per person, annualized: gross, non-taxable, contributions, taxable, tax due, tax withheld and the December adjustment. These are the figures for BIR Form 1604-C and each 2316.",
  filters: ["year", "org"],
  sources: [SOURCES.tax],
  run(db, p, scope, nowIso) {
    const list = people(db, p, scope).map((e) => annualSummary(db, e, p.year, nowIso)).filter((x): x is NonNullable<typeof x> => !!x);
    const rows = list.sort((a, b) => displayName(a.employee).localeCompare(displayName(b.employee))).map((a) => ({
      name: displayName(a.employee), employee_number: a.employee.employee_number, mwe: a.mwe ? "Yes" : "No",
      gross: r2(a.gross), non_taxable: r2(a.nonTaxable), mandatory: r2(a.mandatory), taxable: r2(a.taxable), tax_due: r2(a.taxDue), tax_withheld: r2(a.taxWithheld),
      adjustment: r2(a.decemberAdjustment), substituted: a.substitutedFiling ? "Yes" : "No",
    }));
    const tot = (k: "gross" | "non_taxable" | "mandatory" | "taxable" | "tax_due" | "tax_withheld" | "adjustment") => r2(rows.reduce((n, r) => n + r[k], 0));
    return {
      scope: `${p.year}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "employee_number", label: "Employee no.", kind: "text" }, { key: "mwe", label: "MWE", kind: "text" },
        { key: "gross", label: "Gross", kind: "money" }, { key: "non_taxable", label: "Non-taxable", kind: "money" }, { key: "mandatory", label: "Contributions", kind: "money" },
        { key: "taxable", label: "Taxable", kind: "money" }, { key: "tax_due", label: "Tax due", kind: "money" }, { key: "tax_withheld", label: "Tax withheld", kind: "money" },
        { key: "adjustment", label: "December adjustment", kind: "money" }, { key: "substituted", label: "Substituted filing", kind: "text" },
      ],
      rows,
      totals: { name: "Total", employee_number: "", mwe: "", gross: tot("gross"), non_taxable: tot("non_taxable"), mandatory: tot("mandatory"), taxable: tot("taxable"), tax_due: tot("tax_due"), tax_withheld: tot("tax_withheld"), adjustment: tot("adjustment"), substituted: "" },
      kpis: [
        { label: "Tax due for the year", value: tot("tax_due"), kind: "money" },
        { label: "Withheld", value: tot("tax_withheld"), kind: "money" },
        { label: "Qualify for substituted filing", value: rows.filter((r) => r.substituted === "Yes").length, kind: "number", note: `of ${rows.length}` },
      ],
      notes: list.some((a) => a.estimated) ? ["Months still to come are estimated from current pay, so the year isn't final yet. File by January 31."] : ["File BIR Form 1604-C with the alphalist by January 31."],
    };
  },
};

export const thirteenth: ReportDef = {
  key: "thirteenth-month", title: "13th month pay", category: "payroll", access: payAccess,
  description: "13th month pay per person for a year (PD 851): a twelfth of basic pay earned, the tax-free part, and the December 24 deadline.",
  filters: ["year", "org"],
  sources: [SOURCES.thirteenth],
  run(db, p, scope) {
    const rows = people(db, p, scope).map((e) => {
      const comp = db.compensation.find((c) => c.employee_id === e.id && c.on_ph_payroll);
      if (!comp) return null;
      const amount = r2(thirteenthMonthPay(db, e, p.year));
      return { name: displayName(e), employee_number: e.employee_number, department: groupOf(db, e, "department"), managerial: comp.is_managerial ? "Yes" : "No", amount, tax_free: r2(Math.min(amount, RULES.thirteenthMonthTaxFree)), taxable: r2(Math.max(0, amount - RULES.thirteenthMonthTaxFree)) };
    }).filter((r): r is NonNullable<typeof r> => !!r && (r.amount > 0 || r.managerial === "Yes")).sort((a, b) => a.name.localeCompare(b.name));
    const tot = (k: "amount" | "tax_free" | "taxable") => r2(rows.reduce((n, r) => n + r[k], 0));
    return {
      scope: `${p.year}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "employee_number", label: "Employee no.", kind: "text" }, { key: "department", label: "Department", kind: "text" },
        { key: "managerial", label: "Managerial", kind: "text" }, { key: "amount", label: "13th month", kind: "money" }, { key: "tax_free", label: "Tax-free part", kind: "money" }, { key: "taxable", label: "Taxable part", kind: "money" },
      ],
      rows,
      totals: { name: "Total", employee_number: "", department: "", managerial: "", amount: tot("amount"), tax_free: tot("tax_free"), taxable: tot("taxable") },
      kpis: [
        { label: "Total 13th month", value: tot("amount"), kind: "money", note: `Pay by December 24, ${p.year}` },
        { label: "People", value: rows.filter((r) => r.amount > 0).length, kind: "number" },
      ],
      notes: [
        "Basic pay earned in the year, divided by 12, for rank-and-file employees who worked at least a month. Managerial staff get it only if company settings say so.",
        "The tax-free part counts the ₱90,000 limit for 13th month and other benefits together. Other benefits paid in the year reduce it further.",
      ],
    };
  },
};

export const monthName = (ym: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));
export const loanBalances: ReportDef = {
  key: "loan-balances", title: "Loan balances", category: "payroll", access: payAccess,
  description: "Every loan and advance still being paid as of a date: amount, repaid, balance, per-cutoff deduction and the expected last deduction.",
  filters: ["as_of", "org"],
  run(db, p, scope) {
    const ids = new Set(people(db, p, scope).map((e) => e.id));
    const byId = new Map(db.employees.map((e) => [e.id, e]));
    const rows = (db.loans ?? []).filter((l) => ids.has(l.employee_id) && (l.status === "active" || l.status === "paused") && l.created_at.slice(0, 10) <= p.as_of)
      .map((l) => loanSummary(db, l, p.as_of)).filter((s) => s.balance > 0)
      .map((s) => ({
        name: displayName(byId.get(s.loan.employee_id)!), kind: s.info.label, reference: s.loan.reference_no ?? "", status: s.status === "paused" ? "Paused" : "Active",
        principal: s.loan.principal, repaid: s.repaid, balance: s.balance, per_cutoff: s.perCutoff, last: s.lastDeduction?.pay_date ?? null,
      })).sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
    const tot = (k: "principal" | "repaid" | "balance") => r2(rows.reduce((n, r) => n + r[k], 0));
    const byKind = new Map<string, number>();
    for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.balance);
    return {
      scope: `As of ${formatDate(p.as_of)}${orgScope(db, p)}`,
      columns: [
        { key: "name", label: "Name", kind: "text" }, { key: "kind", label: "Loan", kind: "text" }, { key: "reference", label: "Reference", kind: "text" },
        { key: "status", label: "Status", kind: "text" }, { key: "principal", label: "Amount", kind: "money" }, { key: "repaid", label: "Repaid", kind: "money" },
        { key: "balance", label: "Balance", kind: "money" }, { key: "per_cutoff", label: "Per cutoff", kind: "money" }, { key: "last", label: "Last deduction", kind: "date" },
      ],
      rows,
      totals: { name: "Total", kind: "", reference: "", status: "", principal: tot("principal"), repaid: tot("repaid"), balance: tot("balance"), per_cutoff: null, last: null },
      kpis: [
        { label: "Outstanding", value: tot("balance"), kind: "money", note: `${rows.length} loan${rows.length === 1 ? "" : "s"}` },
        { label: "Repaid so far", value: tot("repaid"), kind: "money" },
      ],
      charts: [{ kind: "bars", title: "Outstanding by kind", valueKind: "money", items: [...byKind].map(([label, value]) => ({ label, value: r2(value) })).sort((a, b) => b.value - a.value) }],
      notes: ["Last deduction assumes every cutoff from now on can cover the full amount. Payments made outside payroll are included."],
    };
  },
};

export const loanRemittances: ReportDef = {
  key: "loan-remittances", title: "Loan remittances", category: "payroll", access: payAccess,
  description: "What payroll deducted for each loan in a month, by agency and loan number: the SSS and Pag-IBIG loan amortizations to remit, and company loans for the books.",
  filters: ["month", "org"],
  sources: [SOURCES.sss, SOURCES.pagibig],
  run(db, p, scope, nowIso) {
    const periods = periodsOfMonth(db, p.month);
    const list = slipsFor(db, people(db, p, scope), periods, nowIso);
    const loansById = new Map((db.loans ?? []).map((l) => [l.id, l]));
    const rows: { agency: string; name: string; employee_number: string; kind: string; reference: string; amount: number }[] = [];
    for (const { e, slips } of list) {
      const taken = new Map<string, number>();
      for (const s of slips) for (const l of s.otherDeductions) if (l.key.startsWith("ded-") && loansById.has(l.key.slice(4))) taken.set(l.key.slice(4), (taken.get(l.key.slice(4)) ?? 0) + l.amount);
      for (const [id, amount] of taken) {
        const loan = loansById.get(id)!;
        const info = LOAN_KINDS[loan.kind];
        rows.push({ agency: info.agency ?? "Company", name: displayName(e), employee_number: e.employee_number, kind: info.label, reference: loan.reference_no ?? "", amount: r2(amount) });
      }
    }
    const order = ["SSS", "Pag-IBIG", "Company"];
    rows.sort((a, b) => order.indexOf(a.agency) - order.indexOf(b.agency) || a.name.localeCompare(b.name));
    const by = (agency: string) => r2(rows.filter((r) => r.agency === agency).reduce((n, r) => n + r.amount, 0));
    return {
      scope: `${monthName(p.month)}${orgScope(db, p)}`,
      columns: [
        { key: "agency", label: "Remit to", kind: "text" }, { key: "name", label: "Name", kind: "text" }, { key: "employee_number", label: "Employee no.", kind: "text" },
        { key: "kind", label: "Loan", kind: "text" }, { key: "reference", label: "Loan number", kind: "text" }, { key: "amount", label: "Deducted", kind: "money" },
      ],
      rows,
      totals: { agency: "Total", name: "", employee_number: "", kind: "", reference: "", amount: r2(rows.reduce((n, r) => n + r.amount, 0)) },
      kpis: [
        { label: "SSS loans to remit", value: by("SSS"), kind: "money" },
        { label: "Pag-IBIG loans to remit", value: by("Pag-IBIG"), kind: "money" },
        { label: "Company loans collected", value: by("Company"), kind: "money" },
      ],
      notes: [
        ...openNote(periods),
        "Remit SSS and Pag-IBIG loan amortizations with the month's contributions, against the agency's loan billing. A deduction lower than the billed amortization (a short cutoff) should be explained to the agency.",
      ],
    };
  },
};

export const PAYROLL_REPORTS = [register, contributions, withholding, alphalist, thirteenth, loanBalances, loanRemittances];
