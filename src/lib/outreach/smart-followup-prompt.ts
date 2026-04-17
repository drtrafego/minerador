import type { campaigns } from "@/db/schema/campaigns";
import type { leads as leadsTable } from "@/db/schema/leads";

type CampaignRow = typeof campaigns.$inferSelect;
type LeadRow = typeof leadsTable.$inferSelect;

export type SmartFollowUpHistoryItem = {
  direction: "outbound" | "inbound";
  body: string;
  sentAt: Date;
};

export type BuildSmartFollowUpPromptArgs = {
  lead: LeadRow;
  campaign: CampaignRow;
  history: SmartFollowUpHistoryItem[];
  stepIndex: number;
};

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trimEnd() + "...";
}

function leadSummary(lead: LeadRow): string {
  const raw = (lead.rawData ?? {}) as Record<string, unknown>;
  const headline =
    typeof raw.headline === "string"
      ? (raw.headline as string)
      : typeof raw.bio === "string"
        ? (raw.bio as string)
        : typeof raw.category === "string"
          ? (raw.category as string)
          : "";
  const lines: string[] = [];
  lines.push(`- name: ${lead.displayName ?? ""}`);
  if (lead.city) lines.push(`- city: ${lead.city}`);
  if (lead.region) lines.push(`- region: ${lead.region}`);
  if (lead.country) lines.push(`- country: ${lead.country}`);
  if (headline) lines.push(`- headline: ${truncate(headline, 240)}`);
  return lines.join("\n");
}

function formatDate(date: Date): string {
  try {
    return date.toISOString();
  } catch {
    return String(date);
  }
}

function historyMarkdown(history: SmartFollowUpHistoryItem[]): string {
  if (history.length === 0) return "(sem historico registrado)";
  return history
    .map((item, idx) => {
      const who = item.direction === "outbound" ? "NOS" : "LEAD";
      return [
        `### Mensagem ${idx + 1} (${who}, ${formatDate(item.sentAt)})`,
        item.body.trim(),
      ].join("\n");
    })
    .join("\n\n");
}

export function buildSmartFollowUpPrompt(
  args: BuildSmartFollowUpPromptArgs,
): string {
  const { lead, campaign, history, stepIndex } = args;

  const niche = campaign.niche ?? "";
  const qualificationResumo = campaign.qualificationPrompt
    ? truncate(campaign.qualificationPrompt, 600)
    : "";

  const icpBlock: string[] = [];
  if (niche) icpBlock.push(`- nicho alvo: ${niche}`);
  if (qualificationResumo) icpBlock.push(`- resumo do ICP: ${qualificationResumo}`);
  if (icpBlock.length === 0) icpBlock.push("- (nao informado)");

  return [
    "Voce e um copywriter estilo Ben Settle, escrevendo um follow up de outreach em portugues.",
    "Tom conversacional, curto, direto, uma unica ideia por mensagem, sem soar vendedor.",
    "Nada de travessao, hifen como separador ou meia risca. Use virgula, ponto, dois pontos ou ponto e virgula.",
    "",
    "Missao: gerar a proxima mensagem da sequencia, mudando o angulo em relacao ao que ja foi dito.",
    "Nao repita argumentos ja usados. Nao peca desculpa por insistir. Nao force urgencia artificial.",
    "Respeite o tom das mensagens anteriores e o estilo de quem ja escreveu para este lead.",
    "Limite rigido: maximo 80 palavras. Sem assinatura, sem emoji, sem saudacao formal.",
    "",
    "Placeholders que voce pode usar se fizer sentido (serao substituidos depois):",
    "{{first_name}}, {{name}}, {{niche}}, {{city}}",
    "",
    "ICP da campanha:",
    icpBlock.join("\n"),
    "",
    "Lead:",
    leadSummary(lead),
    "",
    `Indice do follow up atual (0-based): ${stepIndex}`,
    "",
    "Historico completo da thread (em ordem cronologica):",
    historyMarkdown(history),
    "",
    "Retorne APENAS o texto puro da nova mensagem, sem explicacao, sem prefixo, sem aspas, sem markdown.",
  ].join("\n");
}
