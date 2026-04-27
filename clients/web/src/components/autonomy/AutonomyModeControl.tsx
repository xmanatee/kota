import type { AutonomyMode } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const AUTONOMY_MODES: AutonomyMode[] = [
  "passive",
  "supervised",
  "autonomous",
];

const BADGE_VARIANT: Record<AutonomyMode, "success" | "warning" | "secondary"> =
  {
    autonomous: "success",
    supervised: "warning",
    passive: "secondary",
  };

const SHORT_LABEL: Record<AutonomyMode, string> = {
  autonomous: "auto",
  supervised: "sup",
  passive: "pass",
};

export function AutonomyModeBadge({
  mode,
  className,
}: {
  mode: AutonomyMode;
  className?: string;
}) {
  return (
    <Badge
      variant={BADGE_VARIANT[mode]}
      className={cn("h-4 px-1.5 text-[10px] uppercase", className)}
      title={`autonomy mode: ${mode}`}
    >
      {SHORT_LABEL[mode]}
    </Badge>
  );
}

export function AutonomyModeSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: AutonomyMode;
  onChange: (mode: AutonomyMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as AutonomyMode)}
      onClick={(e) => e.stopPropagation()}
      className={cn("h-7 py-0 text-xs", className)}
      aria-label="Autonomy mode"
    >
      {AUTONOMY_MODES.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </Select>
  );
}
