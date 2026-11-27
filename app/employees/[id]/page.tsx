import { ProfileView } from "@/features/profile/ProfileView";

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfileView id={id} />;
}
