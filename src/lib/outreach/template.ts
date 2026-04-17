import type { leads as leadsTable } from "@/db/schema/leads";

type LeadRow = typeof leadsTable.$inferSelect;

export function buildTemplateVars(lead: LeadRow): Record<string, string> {
  const raw = (lead.rawData ?? {}) as Record<string, unknown>;
  const company =
    typeof raw.company === "string"
      ? (raw.company as string)
      : lead.displayName;
  return {
    name: lead.displayName ?? "",
    first_name: (lead.displayName ?? "").split(" ")[0] ?? "",
    company: company ?? "",
    city: lead.city ?? "",
    region: lead.region ?? "",
    country: lead.country ?? "",
    website: lead.website ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    handle: lead.handle ?? "",
  };
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return typeof v === "string" ? v : "";
  });
}
