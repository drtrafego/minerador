import { Flame, Snowflake, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Temperature = "cold" | "warm" | "hot" | null;

const styles: Record<Exclude<Temperature, null>, { label: string; icon: typeof Flame; cls: string }> = {
  cold: {
    label: "Cold",
    icon: Snowflake,
    cls: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-900",
  },
  warm: {
    label: "Warm",
    icon: Sun,
    cls: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900",
  },
  hot: {
    label: "Hot",
    icon: Flame,
    cls: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-900",
  },
};

export function TemperatureBadge({
  temperature,
  score,
  compact,
}: {
  temperature: Temperature;
  score?: number | null;
  compact?: boolean;
}) {
  const resolved: Temperature = temperature ?? deriveFromScore(score);
  if (!resolved) return null;
  const { label, icon: Icon, cls } = styles[resolved];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {!compact ? label : null}
    </span>
  );
}

function deriveFromScore(score: number | null | undefined): Temperature {
  if (score == null) return null;
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}
