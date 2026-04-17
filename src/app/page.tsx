import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";

export default async function Home() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in");
  if (!session.session?.activeOrganizationId) redirect("/onboarding");
  redirect("/dashboard");
}
