// Row types mirror supabase/migrations/0001_employee_management.sql (snake_case, nullable where the column is).
// When Supabase is wired up, replace these with `supabase gen types typescript` output.

export type EmploymentStatus = "active" | "onboarding" | "on_leave" | "offboarded";
export type EmploymentType = "full_time" | "part_time" | "contractor" | "intern";
export type OnboardingPhase = "before_start" | "first_day" | "first_week" | "first_90_days";
export type TaskOwnerRole = "people_team" | "it" | "manager" | "new_hire" | "buddy";
export type OnboardingStatus = "in_progress" | "completed" | "cancelled";

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  head_id: string | null;
}

export interface Location {
  id: string;
  organization_id: string;
  name: string;
  city: string | null;
  country_code: string | null;
  timezone: string;
  is_remote: boolean;
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
  location_id: string | null;
  manager_id: string | null;
  employment_type: EmploymentType;
  status: EmploymentStatus;
  start_date: string; // ISO date
  end_date: string | null;
  avatar_url: string | null;
}

export interface EmploymentEvent {
  id: string;
  employee_id: string;
  effective_date: string;
  kind: "hired" | "promotion" | "transfer" | "title_change" | "manager_change" | "leave" | "return";
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

export interface Database {
  departments: Department[];
  locations: Location[];
  employees: Employee[];
  employment_events: EmploymentEvent[];
  employee_documents: EmployeeDocument[];
  onboarding_template_tasks: OnboardingTemplateTask[];
  onboarding_cases: OnboardingCase[];
  onboarding_tasks: OnboardingTask[];
}
