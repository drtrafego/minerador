"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteCampaign,
  pauseCampaign,
  resumeCampaign,
  startCampaign,
} from "../actions";

export function CampaignActions({
  campaignId,
  status,
}: {
  campaignId: string;
  status: "draft" | "active" | "paused" | "archived";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const handlePause = () =>
    start(async () => {
      const r = await pauseCampaign(campaignId);
      if ("error" in r && r.error) toast.error(r.error);
      else toast.success("campanha pausada");
    });

  const handleResume = () =>
    start(async () => {
      const r = await resumeCampaign(campaignId);
      if ("error" in r && r.error) toast.error(r.error);
      else toast.success("campanha retomada");
    });

  const handleStart = () =>
    start(async () => {
      const r = await startCampaign(campaignId);
      if ("error" in r && r.error) toast.error(r.error);
      else toast.success("campanha iniciada");
    });

  const handleDelete = () => {
    if (!confirm("Apagar campanha? Isto remove leads associados.")) return;
    start(async () => {
      try {
        await deleteCampaign(campaignId);
      } catch {
        router.push("/campaigns");
      }
    });
  };

  return (
    <div className="flex gap-2">
      {status === "draft" ? (
        <Button onClick={handleStart} disabled={pending}>
          Iniciar
        </Button>
      ) : null}
      {status === "active" ? (
        <Button variant="outline" onClick={handlePause} disabled={pending}>
          Pausar
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button onClick={handleResume} disabled={pending}>
          Retomar
        </Button>
      ) : null}
      <Button variant="destructive" onClick={handleDelete} disabled={pending}>
        Apagar
      </Button>
    </div>
  );
}
