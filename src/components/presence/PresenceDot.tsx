import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { effectivePresence, presenceMeta } from "@/lib/presence";

/** Tickt regelmässig, damit veraltete Heartbeats live auf "offline" wechseln. */
function useTick(active: boolean, ms = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

export function PresenceDot({
  status,
  updatedAt,
  className,
  ring = true,
}: {
  status?: string | null;
  updatedAt?: string | null;
  className?: string;
  ring?: boolean;
}) {
  useTick(!!updatedAt);
  const meta = presenceMeta(effectivePresence(status, updatedAt));
  return (
    <span
      title={meta.label}
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        meta.dot,
        ring && "ring-2 ring-background",
        className,
      )}
    />
  );
}

export function PresenceLabel({
  status,
  updatedAt,
  className,
}: {
  status?: string | null;
  updatedAt?: string | null;
  className?: string;
}) {
  useTick(!!updatedAt);
  const meta = presenceMeta(effectivePresence(status, updatedAt));
  return (
    <span className={cn("inline-flex items-center text-xs", meta.text, className)}>
      {meta.label}
    </span>
  );
}
