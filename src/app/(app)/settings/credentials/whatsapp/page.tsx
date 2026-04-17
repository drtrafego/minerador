import { requireOrg } from "@/lib/auth/guards";
import { loadWhatsAppAPICredential } from "@/lib/clients/whatsapp-api";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { decryptCredential } from "@/lib/crypto/credentials";
import { and, eq, desc } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

async function getQRStatus(organizationId: string) {
  const row = await db.query.credentials.findFirst({
    where: and(
      eq(credentials.organizationId, organizationId),
      eq(credentials.provider, "whatsapp_session"),
    ),
    orderBy: desc(credentials.createdAt),
  });
  if (!row) return null;
  try {
    const data = await decryptCredential<{ phoneNumber: string; savedAt: number }>(
      row.ciphertext,
    );
    return {
      phoneNumber: data.phoneNumber,
      savedAt: new Date(data.savedAt),
    };
  } catch {
    return null;
  }
}

export default async function WhatsAppSettingsPage() {
  const { organizationId } = await requireOrg();

  const [qrStatus, apiCred] = await Promise.all([
    getQRStatus(organizationId),
    loadWhatsAppAPICredential(organizationId),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://seu-dominio.com";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          Configure os canais de envio via WhatsApp.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">WhatsApp QR (Baileys)</CardTitle>
            <Badge variant={qrStatus ? "default" : "secondary"}>
              {qrStatus ? "Conectado" : "Desconectado"}
            </Badge>
          </div>
          <CardDescription>
            Conecta via QR Code, sem necessidade de conta Business.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {qrStatus ? (
            <>
              <div className="flex gap-2">
                <span className="text-muted-foreground">Numero:</span>
                <span>+{qrStatus.phoneNumber}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground">Conectado em:</span>
                <span>{qrStatus.savedAt.toLocaleString("pt-BR")}</span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">Nenhuma sessao ativa.</p>
          )}
          <div className="pt-2 border-t">
            <p className="text-muted-foreground mb-1">Comando de login:</p>
            <code className="block bg-muted rounded px-3 py-2 text-xs select-all">
              pnpm whatsapp:login --org {organizationId}
            </code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">WhatsApp API Oficial (Meta)</CardTitle>
            <Badge variant={apiCred ? "default" : "secondary"}>
              {apiCred ? "Configurado" : "Nao configurado"}
            </Badge>
          </div>
          <CardDescription>
            Usa a Meta Cloud API. Requer conta WhatsApp Business verificada.
            Prioritario sobre QR quando configurado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {apiCred ? (
            <div className="flex gap-2">
              <span className="text-muted-foreground">Phone Number ID:</span>
              <span>
                {apiCred.cred.phone_number_id.slice(0, 6)}...
                {apiCred.cred.phone_number_id.slice(-4)}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Adicione via botao &quot;Adicionar credential&quot; com provider{" "}
              <code className="bg-muted px-1 rounded">whatsapp_api</code> e
              payload JSON:
            </p>
          )}
          {!apiCred && (
            <pre className="bg-muted rounded px-3 py-2 text-xs overflow-x-auto">
              {JSON.stringify(
                {
                  phone_number_id: "SEU_PHONE_NUMBER_ID",
                  access_token: "SEU_ACCESS_TOKEN",
                  verify_token: "token_secreto_para_webhook",
                },
                null,
                2,
              )}
            </pre>
          )}
          <div className="pt-2 border-t">
            <p className="text-muted-foreground mb-1">URL do Webhook (Meta):</p>
            <code className="block bg-muted rounded px-3 py-2 text-xs select-all">
              {appUrl}/api/webhooks/whatsapp
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
