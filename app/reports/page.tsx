import { Suspense } from "react";
import { ReportsView } from "@/features/reports/ReportsView";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  return <Suspense><ReportsView /></Suspense>;
}
