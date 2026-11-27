import { Suspense } from "react";
import { MyTimeView } from "@/features/time/MyTimeView";

export const metadata = { title: "My time" };

export default function MyTimePage() {
  return <Suspense><MyTimeView /></Suspense>;
}
