import { Suspense } from "react";
import { OrgChartView } from "@/features/org/OrgChartView";

export const metadata = { title: "Org chart" };

export default function OrgChartPage() {
  return (
    <Suspense>
      <OrgChartView />
    </Suspense>
  );
}
