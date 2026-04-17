import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./server";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/sign-in");
  }
  return session;
}

export async function requireOrg() {
  const session = await requireUser();
  const activeOrgId = session.session?.activeOrganizationId;
  if (!activeOrgId) {
    redirect("/onboarding");
  }
  return {
    user: session.user,
    session: session.session,
    organizationId: activeOrgId,
  };
}
