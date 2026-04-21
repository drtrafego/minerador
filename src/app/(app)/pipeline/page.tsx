import { requireOrg } from "@/lib/auth/guards";
import { listPipelineLeads, listPipelineStages } from "@/lib/db/queries/pipeline";
import { KanbanBoard } from "@/components/pipeline/kanban-board";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const { organizationId } = await requireOrg();
  const [stages, leads] = await Promise.all([
    listPipelineStages(organizationId),
    listPipelineLeads(organizationId),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Arraste leads qualificados pelas etapas do seu funil.
        </p>
      </div>
      <KanbanBoard stages={stages} leads={leads} />
    </div>
  );
}
