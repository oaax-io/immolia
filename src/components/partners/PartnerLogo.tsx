import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Initialen aus dem Partnernamen, z. B. «UBS» → «UB». */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Partner-Logo mit sauberem Fallback auf Initialen.
 * Nie ein kaputtes Bild: Ladefehler blendet auf Initialen um.
 */
export function PartnerLogo({
  name,
  url,
  size = 36,
  className,
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  const show = url && !failed;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {show ? (
        <img
          src={url ?? ""}
          alt=""
          className="h-full w-full object-contain p-0.5"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="font-semibold text-muted-foreground"
          style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}
        >
          {initials(name)}
        </span>
      )}
    </div>
  );
}
