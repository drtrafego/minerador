import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/guards";
import { getInboxThread } from "@/lib/db/queries/inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const dynamic = "force-dynamic";

const MSG_STATUS_LABEL: Record<string, string> = {
  pending: "pendente",
  sent: "enviado",
  delivered: "entregue",
  failed: "falhou",
  received: "recebido",
};

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const { organizationId } = await requireOrg();

  const detail = await getInboxThread(organizationId, threadId);
  if (!detail) notFound();

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-2xl font-semibold">
                {detail.lead.displayName}
              </h1>
              <Badge variant="outline">{detail.thread.channel}</Badge>
              <Badge variant="secondary">{detail.thread.status}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {detail.lead.email ? <span>{detail.lead.email}</span> : null}
              {detail.lead.phone ? <span>{detail.lead.phone}</span> : null}
              {detail.lead.handle ? <span>@{detail.lead.handle}</span> : null}
              {detail.lead.city ? <span>{detail.lead.city}</span> : null}
              {detail.campaign ? (
                <Link
                  href={`/campaigns/${detail.campaign.id}`}
                  className="underline"
                >
                  {detail.campaign.name}
                </Link>
              ) : null}
            </div>
          </div>
          <Button variant="outline" render={<Link href="/inbox">Voltar</Link>} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Conversa</CardTitle>
            <CardDescription>
              {detail.messages.length} mensagem(ns) no total
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sem mensagens ainda.
              </p>
            ) : (
              detail.messages.map((msg) => {
                const outbound = msg.direction === "outbound";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${outbound ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] space-y-1 rounded-lg p-3 text-sm ${
                        outbound
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      {msg.subject ? (
                        <p className="text-xs font-semibold opacity-80">
                          {msg.subject}
                        </p>
                      ) : null}
                      <pre className="whitespace-pre-wrap font-sans">
                        {msg.body}
                      </pre>
                      <div className="flex items-center gap-2 text-xs opacity-75">
                        <span>
                          {MSG_STATUS_LABEL[msg.status] ?? msg.status}
                        </span>
                        <span>step {msg.step}</span>
                        <span>
                          {new Date(
                            msg.sentAt ?? msg.createdAt,
                          ).toLocaleString("pt-BR")}
                        </span>
                      </div>
                      {msg.errorReason ? (
                        <p className="text-xs text-red-300">
                          erro: {msg.errorReason}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <span>
                  <Button disabled>Responder</Button>
                </span>
              }
            />
            <TooltipContent>Disponivel na Fase 2b</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
