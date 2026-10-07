import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, AlertTriangle, Lightbulb, Landmark, Users, FileText, ArrowRight, Eye, ListChecks, Plus, Loader2, EyeOff, Rocket, PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useMyProfile } from "@/hooks/useMyProfile";
import { propertyStatusLabels } from "@/lib/format";

type Props = {
  propertyId: string;
  title: string;
  status: string;
  marketingType: string;
  imageCount: number;
  hasMinPrice: boolean;
  onClose: () => void;
  onNew: () => void;
  onStatusChange: (status: string, marketing?: string) => void;
};

export function PropertyLaunchpad(p: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMyProfile();
  const firstName = (me?.full_name || "").trim().split(/\s+/)[0] || "";
  const [busy, setBusy] = useState<string | null>(null);

  const isOffMarket = p.marketingType === "off_market";
  const current = isOffMarket ? "off_market" : p.status === "available" ? "active" : p.status === "draft" ? "draft" : "other";

  const setMode = async (mode: "draft" | "off_market" | "active") => {
    setBusy(mode);
    const patch: Record<string, string> =
      mode === "draft" ? { status: "draft" }
      : mode === "active" ? { status: "available", ...(isOffMarket ? { marketing_type: "sale" } : {}) }
      : { status: p.status === "draft" ? "preparation" : p.status, marketing_type: "off_market" };
    const { error } = await supabase.from("properties").update(patch as any).eq("id", p.propertyId);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    p.onStatusChange(patch.status, patch.marketing_type);
    qc.invalidateQueries({ queryKey: ["properties"] });
    toast.success(mode === "draft" ? "Bleibt als Entwurf gespeichert" : mode === "active" ? "Objekt ist jetzt verfügbar" : "Als Off-Market markiert");
  };

  const go = (fn: () => void) => { p.onClose(); fn(); };

  const hints: { tone: "warn" | "tip"; text: string }[] = [];
  if (p.imageCount === 0) hints.push({ tone: "warn", text: "Du hast noch keine Bilder hinzugefügt. Für ein überzeugendes Exposé empfehlen wir mindestens 3 Fotos." });
  else if (p.imageCount < 3) hints.push({ tone: "tip", text: `Erst ${p.imageCount} Bild${p.imageCount === 1 ? "" : "er"} – mit mindestens 3 Fotos wirkt das Exposé deutlich stärker.` });
  if (!p.hasMinPrice) hints.push({ tone: "tip", text: "Tipp: Setze einen internen Mindestpreis als Leitplanke für deine Preisverhandlungen." });

  const modes = [
    { key: "draft" as const, label: "Als Entwurf belassen", icon: PenLine },
    { key: "off_market" as const, label: "Off-Market", icon: EyeOff },
    { key: "active" as const, label: "Direkt aktivieren", icon: Rocket },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckCircle2 className="size-6" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-xl font-semibold">
            Klasse gemacht{firstName ? `, ${firstName}` : ""}!
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Dein Objekt <span className="font-medium text-foreground">«{p.title}»</span> ist sicher gespeichert. Wie möchtest du es jetzt aktivieren?
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Status & Sichtbarkeit</h4>
        {current === "draft" && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              {firstName ? `${firstName}, d` : "D"}er Status steht noch auf «Entwurf». Bist du sicher, dass du so fortfahren willst? Oder ist es vielleicht ein Off-Market-Projekt für vorgemerkte Suchkunden?
            </span>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          {modes.map((m) => {
            const active = current === m.key;
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                type="button"
                disabled={!!busy}
                onClick={() => setMode(m.key)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-background hover:border-primary/50 hover:bg-primary/5",
                )}
              >
                {busy === m.key ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                {m.label}
              </button>
            );
          })}
        </div>
        {current === "other" && (
          <p className="text-xs text-muted-foreground">Aktueller Status: {propertyStatusLabels[p.status as keyof typeof propertyStatusLabels] ?? p.status}</p>
        )}
      </section>

      {hints.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Empfehlungen</h4>
          {hints.map((h, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
              {h.tone === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />}
              <span>{h.text}</span>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Sofort loslegen</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Landmark, title: "Finanzierung starten", text: "Dossier für die Bankprüfung vorbereiten.", run: () => navigate({ to: "/financing" }) },
            { icon: Users, title: "Matching prüfen", text: "Passende Suchkunden nach Budget, Ort und Zimmern.", run: () => navigate({ to: "/matching" }) },
            { icon: FileText, title: "Exposé & Portal", text: "Exposé erstellen oder fürs Portal freigeben.", run: () => navigate({ to: "/properties/$id", params: { id: p.propertyId } }) },
          ].map((a) => (
            <button
              key={a.title}
              type="button"
              onClick={() => go(a.run)}
              className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <a.icon className="size-4" />
              </div>
              <div className="text-sm font-semibold">{a.title}</div>
              <div className="text-xs text-muted-foreground">{a.text}</div>
              <ArrowRight className="mt-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={p.onNew}><Plus className="mr-1 size-4" />Weiteres Objekt erfassen</Button>
        <Button variant="outline" onClick={p.onClose}><ListChecks className="mr-1 size-4" />Fertig & zur Übersicht</Button>
        <Button onClick={() => go(() => navigate({ to: "/properties/$id", params: { id: p.propertyId } }))}>
          <Eye className="mr-1 size-4" />Immobilie ansehen
        </Button>
      </div>
    </div>
  );
}
