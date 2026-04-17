import { requireOrg } from "@/lib/auth/guards";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, organizationId } = await requireOrg();

  return (
    <SidebarProvider>
      <AppSidebar
        userName={user.name}
        userEmail={user.email}
        organizationId={organizationId}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mx-2 h-4" />
          <span className="text-sm font-medium">Minerador Claude</span>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
