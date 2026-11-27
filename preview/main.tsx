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
  else view = <DirectoryView />;
  return <AppShell>{view}</AppShell>;
}

createRoot(document.getElementById("root")!).render(<Routes />);
