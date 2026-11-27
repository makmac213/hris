import { Suspense } from "react";
import { ScheduleView } from "@/features/schedule/ScheduleView";

export const metadata = { title: "Schedule" };

export default function SchedulePage() {
  return <Suspense><ScheduleView /></Suspense>;
}
