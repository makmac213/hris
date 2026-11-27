// Single-file preview of the Next.js app for sharing as an artifact.
// It renders the same views; next/link and next/navigation are swapped for hash-routing shims.
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { DirectoryView } from "@/features/directory/DirectoryView";
import { ProfileView } from "@/features/profile/ProfileView";
import { OrgChartView } from "@/features/org/OrgChartView";
import { OnboardingListView } from "@/features/onboarding/OnboardingListView";
import { OnboardingCaseView } from "@/features/onboarding/OnboardingCaseView";
import { AttendanceView } from "@/features/time/AttendanceView";
import { ShiftCodesView } from "@/features/time/ShiftCodesView";
import { MyTimeView } from "@/features/time/MyTimeView";
import { ApprovalsView } from "@/features/requests/ApprovalsView";
import { PayrollView } from "@/features/payroll/PayrollView";
import { MyPayView } from "@/features/payroll/MyPayView";
import { PayTypesView } from "@/features/payroll/PayTypesView";
import { YearEndView } from "@/features/payroll/YearEndView";
import { MyLeaveView } from "@/features/leave/MyLeaveView";
import { LeavePoliciesView } from "@/features/leave/LeavePoliciesView";
import { OrganizationView } from "@/features/org/OrganizationView";
import { ScheduleView } from "@/features/schedule/ScheduleView";
import { ReportsView } from "@/features/reports/ReportsView";
import { LoansView } from "@/features/loans/LoansView";
import { usePathname } from "./shims/navigation";

function Routes() {
  const path = usePathname();
  const parts = path.split("/").filter(Boolean);
  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  let view;
  if (parts[0] === "employees" && parts[1]) view = <ProfileView key={parts[1]} id={parts[1]} />;
  else if (parts[0] === "onboarding" && parts[1]) view = <OnboardingCaseView key={parts[1]} id={parts[1]} />;
  else if (parts[0] === "onboarding") view = <OnboardingListView />;
  else if (parts[0] === "org-chart") view = <OrgChartView />;
  else if (parts[0] === "organization") view = <OrganizationView />;
  else if (parts[0] === "schedule") view = <ScheduleView />;
  else if (parts[0] === "time" && parts[1] === "shift-codes") view = <ShiftCodesView />;
  else if (parts[0] === "time") view = <AttendanceView />;
  else if (parts[0] === "my-time") view = <MyTimeView />;
  else if (parts[0] === "approvals") view = <ApprovalsView />;
  else if (parts[0] === "payroll" && parts[1] === "pay-types") view = <PayTypesView />;
  else if (parts[0] === "payroll" && parts[1] === "year-end") view = <YearEndView />;
  else if (parts[0] === "my-leave") view = <MyLeaveView />;
  else if (parts[0] === "leave") view = <LeavePoliciesView />;
  else if (parts[0] === "payroll") view = <PayrollView />;
  else if (parts[0] === "my-pay") view = <MyPayView />;
  else if (parts[0] === "reports") view = <ReportsView />;
  else if (parts[0] === "loans") view = <LoansView />;
  else view = <DirectoryView />;
  return <AppShell>{view}</AppShell>;
}

createRoot(document.getElementById("root")!).render(<Routes />);
