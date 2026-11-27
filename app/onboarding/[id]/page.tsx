import { OnboardingCaseView } from "@/features/onboarding/OnboardingCaseView";

export default async function OnboardingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OnboardingCaseView id={id} />;
}
