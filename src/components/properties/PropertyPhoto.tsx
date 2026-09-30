import { useState } from "react";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const NON_IMAGE_EXTENSIONS = /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|zip|mp4|mov|webm)(?:[?#]|$)/i;

export function propertyPhotoCandidates(paths: readonly string[] | null | undefined): string[] {
  return (paths ?? []).filter((path): path is string =>
    typeof path === "string" && !!path.trim() && !NON_IMAGE_EXTENSIONS.test(path.trim()),
  );
}

function photoUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

export function PropertyPhoto({
  sources,
  alt,
  className = "h-full w-full object-cover",
}: {
  sources: readonly string[] | null | undefined;
  alt: string;
  className?: string;
}) {
  const candidates = propertyPhotoCandidates(sources);
  const [failed, setFailed] = useState<string[]>([]);
  const path = candidates.find((candidate) => !failed.includes(candidate));

  if (!path) {
    return <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground" role="img" aria-label={`Kein Bild: ${alt}`}><Building2 className="h-10 w-10" aria-hidden="true" /></div>;
  }

  return <img key={path} src={photoUrl(path)} alt={alt} className={className} loading="lazy" onError={() => setFailed((previous) => [...previous, path])} />;
}