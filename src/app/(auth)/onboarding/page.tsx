"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) {
      toast.error("Nome obrigatorio");
      return;
    }
    const slug = slugify(name) || `org-${Date.now()}`;
    setLoading(true);
    const { data, error } = await authClient.organization.create({
      name,
      slug,
    });
    if (error || !data) {
      setLoading(false);
      toast.error(error?.message ?? "Falha ao criar organizacao");
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    setLoading(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bem-vindo</CardTitle>
        <CardDescription>
          Crie sua primeira organizacao para comecar
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da organizacao</Label>
            <Input id="name" name="name" placeholder="DR.TRAFEGO" required />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Criando..." : "Criar e continuar"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
