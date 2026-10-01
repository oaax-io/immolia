import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMapboxToken, geocodeAddresses } from "@/lib/mapbox.functions";
import { generatePropertyMarketAnalysis } from "@/lib/property-market-analysis.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrainCircuit, Loader2, MapPin, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";

type Sections = {
  purchase_price?: { estimated_value_min?: number; estimated_value_max?: number; comparison?: string };
  rental?: { monthly_rent_min?: number; monthly_rent_max?: number; gross_yield_min?: number; gross_yield_max?: number };
};

const comparisonLabels: Record<string, string> = {
  below_market: "Unter Marktwert",
  at_market: "Marktgerecht",
  above_market: "Über Marktwert",
  unknown: "Nicht eindeutig",
};

function range(min?: number, max?: number, prefix = "", suffix = "", digits = 0) {
  const f = (v?: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? new Intl.NumberFormat("de-CH", { maximumFractionDigits: digits }).format(v)
      : null;
  const a = f(min), b = f(max);
  if (!a && !b) return "—";
  if (a && b && a !== b) return `${prefix}${a}–${b}${suffix}`;
  return `${prefix}${a ?? b}${suffix}`;
}

export function PropertyLocationMap({ property }: { property: any }) {
  const tokenFn = useServerFn(getMapboxToken);
  const geocodeFn = useServerFn(geocodeAddresses);
  const analyseFn = useServerFn(generatePropertyMarketAnalysis);
  const qc = useQueryClient();
  const container = useRef<HTMLDivElement | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [analysing, setAnalysing] = useState(false);

  const query = [property.address, property.postal_code, property.city, property.country || "Schweiz"].filter(Boolean).join(", ");

  const { data: tokenData } = useQuery({ queryKey: ["mapbox-token"], queryFn: () => tokenFn(), staleTime: Infinity });
  const token = tokenData?.token ?? null;

  const { data: point, isLoading: geoLoading } = useQuery({
    queryKey: ["property-geocode", property.id, query],
    enabled: query.length > 2,
    staleTime: Infinity,
    queryFn: async () => (await geocodeFn({ data: { items: [{ id: property.id, query }] } }))[0] ?? null,
  });

  const { data: latest } = useQuery({
    queryKey: ["market_analyses", property.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("property_market_analyses")
        .select("id, created_at, sections, model, created_by")
        .eq("property_id", property.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    select: (rows: any[]) => (rows[0]?.sections as Sections | undefined) ?? null,
  });

  useEffect(() => {
    if (!token || !point || !container.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [point.longitude, point.latitude],
      zoom: 15,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    const el = document.createElement("div");
    el.className = "rounded-full border-[3px] border-background bg-primary shadow-lg";
    el.style.cssText = "width:22px;height:22px;cursor:pointer;";
    el.addEventListener("mouseenter", () => setShowDetails(true));
    el.addEventListener("click", () => setShowDetails((s) => !s));
    new mapboxgl.Marker({ element: el }).setLngLat([point.longitude, point.latitude]).addTo(map);
    map.on("load", () => map.resize());
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    return () => { ro.disconnect(); map.remove(); };
  }, [token, point]);

  const runAnalysis = async () => {
    setAnalysing(true);
    try {
      await analyseFn({ data: { propertyId: property.id, requestId: crypto.randomUUID() } });
      await qc.invalidateQueries({ queryKey: ["market_analyses", property.id] });
      toast.success("Marktanalyse erstellt");
    } catch (e: any) {
      toast.error(e?.message ?? "Marktanalyse fehlgeschlagen");
    } finally {
      setAnalysing(false);
    }
  };

  if (query.length <= 2) {
    return <Empty text="Keine Adresse hinterlegt – Objekt kann nicht auf der Karte angezeigt werden." />;
  }
  if (!geoLoading && !point) return <Empty text="Adresse konnte nicht auf der Karte gefunden werden." />;

  const pp = latest?.purchase_price;
  const r = latest?.rental;

  return (
    <div className="relative h-full w-full" onMouseLeave={() => setShowDetails(false)}>
      <div ref={container} className="h-full w-full" />
      {(geoLoading || !token) && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {showDetails && point && (
        <div className="absolute bottom-4 left-4 z-10 w-72 rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
          <p className="truncate text-sm font-semibold">{property.title}</p>
          <p className="mb-3 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{query}</p>
          {latest ? (
            <div className="space-y-2 text-sm">
              <Row label="Verkaufspotenzial" value={range(pp?.estimated_value_min, pp?.estimated_value_max, "CHF ")} hint={pp?.comparison ? comparisonLabels[pp.comparison] : undefined} />
              <Row label="Vermietungspotenzial" value={range(r?.monthly_rent_min, r?.monthly_rent_max, "CHF ", " / Mt.")} />
              <Row label="Bruttorendite" value={range(r?.gross_yield_min, r?.gross_yield_max, "", " %", 1)} icon />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Noch keine Marktanalyse vorhanden.</p>
              <Button size="sm" className="w-full" onClick={runAnalysis} disabled={analysing}>
                {analysing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                KI-Analyse erstellen
              </Button>
            </div>
          )}
        </div>
      )}
      {!showDetails && point && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-xs shadow">
          <BrainCircuit className="h-3.5 w-3.5 text-primary" /> Marker berühren für Potenzial
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">{icon && <TrendingUp className="h-3 w-3" />}{label}</span>
      <span className="text-right">
        <span className="block font-semibold">{value}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted px-6 text-center text-sm text-muted-foreground">
      <MapPin className="h-8 w-8" />{text}
    </div>
  );
}
