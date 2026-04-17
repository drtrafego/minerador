import Link from "next/link";
import { requireOrg } from "@/lib/auth/guards";
import { listCampaigns } from "@/lib/db/queries/campaigns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  active: "ativa",
  paused: "pausada",
  archived: "arquivada",
};

const SOURCE_LABEL: Record<string, string> = {
  google_places: "Google Maps",
  instagram_hashtag: "Instagram",
  instagram_profile: "Instagram",
  manual: "manual",
};

export default async function CampaignsPage() {
  const { organizationId } = await requireOrg();
  const campaigns = await listCampaigns(organizationId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Crie campanhas de prospeccao, mine leads e qualifique com Claude.
          </p>
        </div>
        <Button render={<Link href="/campaigns/new">Nova campanha</Link>} />
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma campanha ainda</CardTitle>
            <CardDescription>
              Crie sua primeira campanha para comecar a minerar leads.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/campaigns/new">Criar campanha</Link>} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Nicho</TableHead>
                  <TableHead>Fonte</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Qualificados</TableHead>
                  <TableHead className="text-right">Rejeitados</TableHead>
                  <TableHead className="text-right">Pendentes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.niche ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.primarySource
                        ? (SOURCE_LABEL[c.primarySource] ?? c.primarySource)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={c.status === "active" ? "default" : "outline"}
                      >
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{c.totalLeads}</TableCell>
                    <TableCell className="text-right text-green-500">
                      {c.qualifiedLeads}
                    </TableCell>
                    <TableCell className="text-right text-red-500">
                      {c.disqualifiedLeads}
                    </TableCell>
                    <TableCell className="text-right text-yellow-500">
                      {c.pendingLeads}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
