import Link from "next/link";
import { requireOrg } from "@/lib/auth/guards";
import { listLeads } from "@/lib/db/queries/leads";
import { listCampaigns } from "@/lib/db/queries/campaigns";
import { LeadsTable } from "@/components/leads-table";

export const dynamic = "force-dynamic";

type Status = "all" | "pending" | "qualified" | "disqualified" | "needs_review";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; campaign?: string }>;
}) {
  const { status: statusParam, campaign: campaignParam } = await searchParams;
  const { organizationId } = await requireOrg();

  const status: Status =
    statusParam === "qualified" ||
    statusParam === "disqualified" ||
    statusParam === "pending" ||
    statusParam === "needs_review"
      ? statusParam
      : "all";

  const [leads, campaigns] = await Promise.all([
    listLeads({
      organizationId,
      status,
      campaignId: campaignParam || undefined,
    }),
    listCampaigns(organizationId),
  ]);

  function buildHref(opts: { status?: string; campaign?: string }) {
    const params = new URLSearchParams();
    if (opts.status && opts.status !== "all") params.set("status", opts.status);
    if (opts.campaign) params.set("campaign", opts.campaign);
    const qs = params.toString();
    return qs ? `/leads?${qs}` : "/leads";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="text-sm text-muted-foreground">
          Todos os leads minerados pela organizacao.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs uppercase text-muted-foreground">Status</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "todos"],
                ["pending", "pendentes"],
                ["qualified", "qualificados"],
                ["disqualified", "rejeitados"],
                ["needs_review", "revisar"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={buildHref({ status: key, campaign: campaignParam })}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  status === key
                    ? "border-ring bg-secondary"
                    : "border-input text-muted-foreground"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {campaigns.length > 0 ? (
          <div>
            <p className="mb-1 text-xs uppercase text-muted-foreground">
              Campanha
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={buildHref({ status: statusParam })}
                className={`rounded-lg border px-3 py-1 text-sm ${
                  !campaignParam
                    ? "border-ring bg-secondary"
                    : "border-input text-muted-foreground"
                }`}
              >
                todas
              </Link>
              {campaigns.map((c) => (
                <Link
                  key={c.id}
                  href={buildHref({ status: statusParam, campaign: c.id })}
                  className={`rounded-lg border px-3 py-1 text-sm ${
                    campaignParam === c.id
                      ? "border-ring bg-secondary"
                      : "border-input text-muted-foreground"
                  }`}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <LeadsTable leads={leads} showCampaign />
    </div>
  );
}
