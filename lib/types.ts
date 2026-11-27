// Row types mirror supabase/migrations/0001_employee_management.sql (snake_case, nullable where the column is).
// When Supabase is wired up, replace these with `supabase gen types typescript` output.

export type EmploymentStatus = "active" | "onboarding" | "on_leave" | "offboarded";
export type EmploymentType = "full_time" | "part_time" | "contractor" | "intern";
// Labor Code Art. 295–296 [280–281]: regular, probationary, project, seasonal, casual; fixed-term per Brent School v. Zamora.
export type EmploymentStatusPH = "probationary" | "regular" | "project" | "seasonal" | "casual" | "fixed_term";
export type SeparationReason =
  | "resignation" | "end_of_contract" | "failed_probation" | "just_cause"
  | "redundancy" | "labor_saving" | "retrenchment" | "closure" | "closure_losses" | "disease" | "retirement" | "death";
export type PhRegion = "NCR" | "CAR" | "I" | "II" | "III" | "IV-A" | "IV-B" | "V" | "VI" | "VII" | "VIII" | "IX" | "X" | "XI" | "XII" | "XIII" | "BARMM";
export type OnboardingPhase = "before_start" | "first_day" | "first_week" | "first_90_days";
export type TaskOwnerRole = "people_team" | "it" | "manager" | "new_hire" | "buddy";
export type OnboardingStatus = "in_progress" | "completed" | "cancelled";
// operations: schedules shifts for everyone (workforce management in a BPO); no pay or HR records.
export type AppRole = "admin" | "hr" | "operations" | "employee";
export type ShiftKind = "whole_day" | "half_day";
export type ShiftSource = "system_default" | "uploaded" | "manual";
export type TimeRecordKind = "clock_in" | "clock_out";
export type TimeRecordSource = "device" | "correction";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type CorrectionKind = "missing_in" | "missing_out" | "wrong_in" | "wrong_out";
export type PayBasis = "monthly" | "hourly";
export type HolidayKind = "regular" | "special_non_working" | "special_working";
export type PayrollStatus = "open" | "finalized" | "paid";

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  head_id: string | null;
}

/** A branch: an office or site people work from. "Remote" is a location too. */
export interface Location {
  id: string;
  organization_id: string;
  name: string;
  city: string | null;
  country_code: string | null;
  timezone: string;
  is_remote: boolean;
  ph_region: PhRegion | null; // for the regional minimum wage
}

/** A client account people are assigned to (BPO). */
export interface Client {
  id: string;
  organization_id: string;
  name: string;
  code: string; // short label for the schedule, e.g. "NWM"
  industry: string | null;
  archived_at: string | null;
}

export interface Employee {
  id: string;
  organization_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  pronouns: string | null;
  work_email: string;
  phone: string | null;
  job_title: string;
  department_id: string | null;
  location_id: string | null; // branch
  client_id: string | null; // client account (BPO); null for staff not on an account
  manager_id: string | null;
  employment_type: EmploymentType;
  status: EmploymentStatus;
  start_date: string; // ISO date
  end_date: string | null;
  avatar_url: string | null;
  role: AppRole;
  shift_code_id: string | null;
  // Philippine employment terms (null for people outside the Philippines)
  employment_status_ph: EmploymentStatusPH | null;
  probation_end_date: string | null; // 6 months (180 days) at most, unless an apprenticeship
  standards_given_on: string | null; // date the probation standards were given in writing (Art. 296)
  contract_end_date: string | null; // project, seasonal and fixed-term
  regularized_on: string | null;
  birth_date: string | null; // retirement pay eligibility (RA 7641)
  separation_reason: SeparationReason | null;
  separation_notice_date: string | null;
}

export interface ShiftCode {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  kind: ShiftKind;
  start_time: string; // "HH:MM", local wall clock
  end_time: string; // may be earlier than start_time for overnight shifts
  break_minutes: number;
  timezone: string;
  grace_minutes: number;
  source: ShiftSource;
  is_default: boolean;
  archived_at: string | null;
}

export interface TimeRecord {
  id: string;
  organization_id: string;
  employee_id: string;
  shift_code_id: string | null;
  kind: TimeRecordKind;
  recorded_at: string; // ISO timestamp, set by the server
  work_date: string;
  source: TimeRecordSource; // device = live capture; correction = approved correction request
  correction_request_id: string | null;
  // Required for device records (camera photo + GPS); null only for approved corrections.
  photo_path: string | null; // Storage key; the prototype stores a data URL here
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  device: string | null;
}

export interface Compensation {
  id: string;
  employee_id: string;
  pay_basis: PayBasis;
  rate: number; // PHP per month (monthly) or per hour (hourly)
  is_managerial: boolean; // Labor Code Art. 82: no OT, night differential or holiday premium
  on_ph_payroll: boolean;
  effective_from: string;
}

export interface Holiday {
  date: string;
  name: string;
  kind: HolidayKind;
}

export interface OvertimeRequest {
  id: string;
  employee_id: string;
  work_date: string;
  start_at: string; // ISO
  end_at: string; // ISO
  reason: string;
  status: RequestStatus;
  filed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface CorrectionRequest {
  id: string;
  employee_id: string;
  work_date: string;
  kind: CorrectionKind;
  proposed_at: string; // ISO time the employee says is correct
  original_record_id: string | null;
  reason: string;
  status: RequestStatus;
  filed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface PayrollPeriod {
  id: string;
  start_date: string;
  end_date: string;
  pay_date: string;
  status: PayrollStatus;
  finalized_at: string | null;
  finalized_by: string | null;
}

export interface EmploymentEvent {
  id: string;
  employee_id: string;
  effective_date: string;
  kind: "hired" | "promotion" | "transfer" | "title_change" | "manager_change" | "leave" | "return" | "regularized" | "separated";
  job_title: string | null;
  department_id: string | null;
  note: string | null;
}

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  name: string;
  category: "contract" | "identity" | "tax" | "policy" | "other";
  storage_path: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface OnboardingTemplateTask {
  id: string;
  template_id: string;
  title: string;
  phase: OnboardingPhase;
  owner_role: TaskOwnerRole;
  due_offset_days: number;
  position: number;
}

export interface OnboardingCase {
  id: string;
  employee_id: string;
  template_id: string | null;
  buddy_id: string | null;
  status: OnboardingStatus;
  created_at: string;
}

export interface OnboardingTask {
  id: string;
  case_id: string;
  title: string;
  phase: OnboardingPhase;
  owner_role: TaskOwnerRole;
  assignee_id: string | null;
  due_date: string;
  completed_at: string | null;
  position: number;
}

// ---- Payroll settings, other earnings and deductions --------------------------------

export type ContributionTiming = "split" | "first_cutoff" | "second_cutoff";
export type ContributionBasis = "monthly_rate" | "actual_compensation";

// Company-wide payroll policy. One row per organization.
export interface PayrollSettings {
  use_regional_minimum_wage: boolean; // from each person's work location; otherwise minimum_wage_daily for everyone
  workdays_per_year: 261 | 313 | 365; // divisor for the daily rate of monthly-paid staff
  minimum_wage_daily: number;
  minimum_wage_label: string; // e.g. "NCR, Wage Order NCR-28"
  contribution_timing: ContributionTiming; // when the month's SSS, PhilHealth and Pag-IBIG are deducted
  sss_basis: ContributionBasis; // SSS: monthly rate, or the month's actual compensation (trued up on the 2nd cutoff)
  employer_pays_sss: boolean; // the company shoulders the employee share too
  employer_pays_philhealth: boolean;
  employer_pays_pagibig: boolean;
  pay_unworked_special_days: boolean; // "no work, no pay" unless company policy pays them
  deduct_managerial_tardiness: boolean; // managerial staff are outside the hours-of-work rules (Art. 82)
  thirteenth_month_for_managerial: boolean; // PD 851 covers rank-and-file; paying managers is company policy
}

// Per-employee exceptions. Null means "use the company setting".
export interface EmployeePayrollSettings {
  employee_id: string;
  employer_pays_sss: boolean | null;
  employer_pays_philhealth: boolean | null;
  employer_pays_pagibig: boolean | null;
  pagibig_voluntary: number; // extra employee Pag-IBIG per month, above the mandatory share (after tax)
}

export type EarningCategory =
  | "taxable_allowance" // transport, communication, etc. not liquidated: taxable
  | "de_minimis" // tax-free up to the RR 29-2025 ceilings; excess goes to the ₱90,000 pool
  | "other_benefit" // bonuses and other benefits: tax-free up to ₱90,000 a year with 13th month
  | "commission" // taxable
  | "reimbursement" // liquidated expenses: not compensation, not taxed
  | "adjustment"; // corrections from earlier periods: taxable
export type DeMinimisKind = "rice" | "laundry" | "medical_dependents" | "uniform" | "medical_assistance" | "achievement_award" | "christmas_gift" | "cba_incentive" | "ot_meal";
export type DeductionCategory =
  | "sss_loan" // authorized by law (Art. 113)
  | "pagibig_loan" // authorized by law
  | "company_loan" // needs the employee's written authorization (DO 195-18)
  | "union_dues" // check-off authorization; excluded from taxable pay
  | "insurance" // premium advanced by the employer, with consent
  | "loss_damage" // Arts. 114–115: proven, heard, ≤ 20% of wages a week
  | "other_authorized";
export type PayItemSchedule = "every_cutoff" | "first_cutoff" | "second_cutoff" | "once";

export type PayTypeAppliesTo = "individual" | "all" | "rank_and_file" | "managerial";

// A company-defined kind of pay item: "Rice subsidy", "Meal allowance", "Coop share", "Mid-year bonus".
// The company names it and sets its rules; `category` is the legal treatment it falls under, which the
// company can choose but not override (e.g. only de minimis kinds with a legal ceiling can be tax-free).
export interface PayItemType {
  id: string;
  name: string;
  direction: "earning" | "deduction";
  category: EarningCategory | DeductionCategory;
  de_minimis_kind: DeMinimisKind | null;
  description: string | null;
  default_amount: number | null; // per cutoff
  default_schedule: PayItemSchedule;
  applies_to: PayTypeAppliesTo; // earnings only: "all" etc. give it to everyone eligible without adding it person by person
  counts_for_13th: boolean; // company practice may add it to the 13th month base (PD 851 allows more, never less)
  is_statutory: boolean; // built-in SSS and Pag-IBIG loans: legal fields locked
  active: boolean;
}

export interface PayItem {
  id: string;
  type_id: string | null; // the company type it came from
  employee_id: string;
  direction: "earning" | "deduction";
  category: EarningCategory | DeductionCategory;
  de_minimis_kind: DeMinimisKind | null;
  label: string;
  amount: number; // per cutoff it applies to; 0 on a company-wide type means "not for this person"
  schedule: PayItemSchedule;
  start_date: string; // first period whose end_date ≥ this
  end_date: string | null;
  installments: number | null; // loans: stop after this many deductions
  authorization: string | null; // reference to the signed authorization, where the law needs one
  created_by: string;
  created_at: string;
}

// ---- Leave ---------------------------------------------------------------------------

export type LeaveAccrual = "annual" | "monthly" | "per_event";

// A kind of leave. Statutory types carry the legal minimum; the company can add days and rules on top, never less.
export interface LeaveType {
  id: string;
  name: string;
  statutory: boolean;
  legal_basis: string | null; // e.g. "Labor Code Art. 95"
  legal_min_days: number; // 0 for company-only leave
  days: number; // per year (annual/monthly) or per event; ≥ legal_min_days
  accrual: LeaveAccrual;
  calendar_days: boolean; // maternity and special leave for women count calendar days; the rest count workdays
  min_service_months: number; // service needed before it can be used
  paid: boolean;
  convertible: boolean; // unused days paid in cash at year end and on separation
  carry_over_max: number; // days that roll into next year
  counts_as_sil: boolean; // a company leave of ≥ 5 paid days that replaces SIL (Art. 95 exemption)
  requires_document: string | null;
  who: string | null; // who it's for, in plain words; HR checks it on approval
  description: string | null;
  active: boolean;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  half_day: boolean; // single-day requests only
  reason: string;
  status: RequestStatus;
  filed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

/** Balances brought in at go-live, or adjusted by HR. */
export interface LeaveAdjustment {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  days: number; // + adds, − removes
  note: string;
}

/** Year-to-date payroll figures from before the app was used (imported at go-live). */
export interface PayrollOpening {
  employee_id: string;
  year: number;
  through_date: string; // figures cover Jan 1 to this date
  taxable_compensation: number;
  tax_withheld: number;
  non_taxable_benefits: number; // 13th month and other benefits already paid (toward ₱90,000)
  mandatory_contributions: number;
  basic_pay: number; // for the 13th month base
  thirteenth_paid: number;
}

// ---- Scheduling ------------------------------------------------------------------------

/**
 * One person's shift on one date, set by operations. Days without a row follow the person's default
 * shift code on weekdays and rest on weekends. shift_code_id null means a rest day.
 */
export interface ShiftAssignment {
  id: string; // `${employee_id}:${work_date}`: one row per person per day
  organization_id: string;
  employee_id: string;
  work_date: string;
  shift_code_id: string | null;
  covers_employee_id: string | null; // filling in for someone on leave that day
  note: string | null;
  assigned_by: string;
  assigned_at: string;
}

export interface ScheduleSettings {
  horizon_days: number; // how far ahead operations can schedule, counted from today
  short_notice_hours: number; // leave filed less than this before the shift starts is flagged as short notice
}

/** Who besides the direct supervisor may approve leave, overtime and corrections. Admin always can. */
export interface ApprovalSettings {
  approver_roles: ("hr" | "operations")[];
}

export type NotificationKind = "leave_approved_on_shift" | "short_notice_leave" | "missing_time_out";

export interface AppNotification {
  id: string;
  organization_id: string;
  recipient_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string; // app path, e.g. /schedule?date=2026-12-02
  employee_id: string | null; // who it is about
  created_at: string;
  read_at: string | null;
}

export interface Database {
  departments: Department[];
  locations: Location[];
  employees: Employee[];
  employment_events: EmploymentEvent[];
  employee_documents: EmployeeDocument[];
  onboarding_template_tasks: OnboardingTemplateTask[];
  onboarding_cases: OnboardingCase[];
  onboarding_tasks: OnboardingTask[];
  shift_codes: ShiftCode[];
  time_records: TimeRecord[];
  compensation: Compensation[];
  holidays: Holiday[];
  overtime_requests: OvertimeRequest[];
  correction_requests: CorrectionRequest[];
  payroll_periods: PayrollPeriod[];
  payroll_settings: PayrollSettings;
  employee_payroll_settings: EmployeePayrollSettings[];
  pay_items: PayItem[];
  pay_item_types: PayItemType[];
  leave_types: LeaveType[];
  leave_requests: LeaveRequest[];
  leave_adjustments: LeaveAdjustment[];
  payroll_openings: PayrollOpening[];
  clients: Client[];
  shift_assignments: ShiftAssignment[];
  schedule_settings: ScheduleSettings;
  approval_settings: ApprovalSettings;
  notifications: AppNotification[];
}
