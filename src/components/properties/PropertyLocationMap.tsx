import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { getMapboxToken, geocodeAddresses, type GeocodedPoint } from "@/lib/mapbox.functions";
import { generatePropertyMarketAnalysis } from "@/lib/property-market-analysis.functions";
import { getSwissParcelGeometry } from "@/lib/property-location.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CANTON_NAMES } from "@/components/properties/PropertiesMap";
import { ArrowRight, BrainCircuit, Loader2, MapPin, RotateCcw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

const YIELD_MIN = 0, YIELD_MAX = 10;
const chf = (v: number) => new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(v);

function RangeSlider({ value, min, max, step, onChange }: { value: [number, number]; min: number; max: number; step: number; onChange: (v: [number, number]) => void }) {
  return (
    <SliderPrimitive.Root className="relative flex w-full touch-none select-none items-center py-1" value={value} min={min} max={max} step={step} onValueChange={(v) => onChange([v[0], v[1]] as [number, number])}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow" />
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow" />
    </SliderPrimitive.Root>
  );
}

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
  const parcelFn = useServerFn(getSwissParcelGeometry);
  const qc = useQueryClient();
  const container = useRef<HTMLDivElement | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [mapReady, setMapReady] = useState<mapboxgl.Map | null>(null);

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

  const isSwiss = !property.country || /schweiz|switzerland|suisse|svizzera|^ch$/i.test(String(property.country));
  const { data: parcel } = useQuery({
    queryKey: ["property-parcel-geometry", property.id, point?.latitude, point?.longitude],
    enabled: !!point && isSwiss,
    staleTime: Infinity,
    queryFn: async () => {
      try { return await parcelFn({ data: { latitude: point!.latitude, longitude: point!.longitude } }); } catch { return null; }
    },
  });

  useEffect(() => {
    if (!token || !point || !container.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [point.longitude, point.latitude],
      zoom: 17,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.FullscreenControl({ container: wrapper.current ?? undefined }), "bottom-right");
    const el = document.createElement("div");
    el.className = "rounded-full border-[3px] border-background bg-primary shadow-lg";
    el.style.cssText = "width:22px;height:22px;cursor:pointer;";
    el.addEventListener("mouseenter", () => setShowDetails(true));
    el.addEventListener("click", () => setShowDetails((s) => !s));
    new mapboxgl.Marker({ element: el }).setLngLat([point.longitude, point.latitude]).addTo(map);
    map.on("load", () => {
      map.resize();
      if (isSwiss) {
        map.addSource("cadastre", {
          type: "raster", tileSize: 256,
          tiles: ["https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=ch.kantone.cadastralwebmap-farbe&STYLES=&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}"],
          attribution: "© Amtliche Vermessung Schweiz",
        });
        map.addLayer({ id: "cadastre", type: "raster", source: "cadastre", minzoom: 14, paint: { "raster-opacity": 0.55 } });
      }
      setMapReady(map);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    const onFs = () => map.resize();
    document.addEventListener("fullscreenchange", onFs);
    return () => { ro.disconnect(); document.removeEventListener("fullscreenchange", onFs); setMapReady(null); map.remove(); };
  }, [token, point, isSwiss]);

  useEffect(() => {
    const map = mapReady;
    if (!map || !parcel?.geometry) return;
    const color = (() => {
      try {
        const probe = document.createElement("div");
        probe.className = "bg-primary"; document.body.appendChild(probe);
        const css = getComputedStyle(probe).backgroundColor; probe.remove();
        const c = document.createElement("canvas").getContext("2d")!;
        c.fillStyle = css; c.fillRect(0, 0, 1, 1);
        const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      } catch { return "rgb(37, 99, 235)"; }
    })();
    const data = { type: "Feature", properties: {}, geometry: parcel.geometry } as any;
    if (map.getSource("parcel")) (map.getSource("parcel") as mapboxgl.GeoJSONSource).setData(data);
    else {
      map.addSource("parcel", { type: "geojson", data });
      map.addLayer({ id: "parcel-fill", type: "fill", source: "parcel", paint: { "fill-color": color, "fill-opacity": 0.18 } });
      map.addLayer({ id: "parcel-line", type: "line", source: "parcel", paint: { "line-color": color, "line-width": 2.5 } });
      map.on("mouseenter", "parcel-fill", () => {
        map.getCanvas().style.cursor = "pointer";
        map.setPaintProperty("parcel-fill", "fill-opacity", 0.38);
        setShowDetails(true);
      });
      map.on("mouseleave", "parcel-fill", () => {
        map.getCanvas().style.cursor = "";
        map.setPaintProperty("parcel-fill", "fill-opacity", 0.18);
      });
      map.on("click", "parcel-fill", () => setShowDetails(true));
    }
  }, [mapReady, parcel]);

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
    <div ref={wrapper} className="relative h-full w-full bg-background" onMouseLeave={() => setShowDetails(false)}>
      <div ref={container} className="h-full w-full" />
      {(geoLoading || !token) && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {showDetails && point && (
        <div className="absolute bottom-4 left-4 z-10 w-80 rounded-2xl border bg-background/90 p-4 shadow-xl backdrop-blur-md">
          <p className="truncate text-sm font-semibold">{property.title}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{query}</p>
          {(parcel?.parcel_no || property.parcel_no) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">Parzelle {parcel?.parcel_no || property.parcel_no}</span>
              {parcel?.canton && <span className="rounded-full bg-muted px-2 py-0.5">{parcel.canton}</span>}
              {parcel?.e_grid && <span className="rounded-full bg-muted px-2 py-0.5 font-mono">{parcel.e_grid}</span>}
            </div>
          )}
          {latest ? (
            <div className="mt-3 space-y-3">
              <YieldGauge min={r?.gross_yield_min} max={r?.gross_yield_max} />
              <div className="grid grid-cols-2 gap-2">
                <Tile label="Verkaufspotenzial" value={range(pp?.estimated_value_min, pp?.estimated_value_max, "CHF ")} hint={pp?.comparison ? comparisonLabels[pp.comparison] : undefined} />
                <Tile label="Vermietung" value={range(r?.monthly_rent_min, r?.monthly_rent_max, "CHF ", " / Mt.")} />
              </div>
              <MarketScale comparison={pp?.comparison} />
            </div>
          ) : (
            <div className="mt-3 space-y-2">
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
          <BrainCircuit className="h-3.5 w-3.5 text-primary" /> Parzelle oder Marker berühren
        </div>
      )}
    </div>
  );
}

const G_MIN = 2, G_MAX = 6;
function polar(cx: number, cy: number, rad: number, v: number) {
  const a = Math.PI * (1 - (Math.min(Math.max(v, G_MIN), G_MAX) - G_MIN) / (G_MAX - G_MIN));
  return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
}
function arc(from: number, to: number) {
  const [x1, y1] = polar(70, 70, 56, from), [x2, y2] = polar(70, 70, 56, to);
  return `M ${x1} ${y1} A 56 56 0 0 1 ${x2} ${y2}`;
}

function YieldGauge({ min, max }: { min?: number; max?: number }) {
  const vals = [min, max].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const [nx, ny] = polar(70, 70, 44, value ?? G_MIN);
  const label = value == null ? "Keine Angabe" : value >= 4.5 ? "Überdurchschnittlich" : value >= 3.5 ? "Marktüblich" : "Moderat";
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-2">
      <svg viewBox="0 0 140 80" className="h-[72px] w-[126px] shrink-0">
        <path d={arc(2, 3.5)} style={{ stroke: "var(--chart-4)" }} strokeWidth="12" fill="none" />
        <path d={arc(3.5, 4.5)} style={{ stroke: "var(--chart-2)" }} strokeWidth="12" fill="none" />
        <path d={arc(4.5, 6)} style={{ stroke: "var(--chart-1)" }} strokeWidth="12" fill="none" />
        {value != null && <line x1="70" y1="70" x2={nx} y2={ny} className="stroke-foreground" strokeWidth="3" strokeLinecap="round" />}
        <circle cx="70" cy="70" r="5" className="fill-foreground" />
        <text x="10" y="79" className="fill-muted-foreground" fontSize="9">2%</text>
        <text x="118" y="79" className="fill-muted-foreground" fontSize="9">6%+</text>
      </svg>
      <div>
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><TrendingUp className="h-3 w-3" />Bruttorendite</p>
        <p className="text-lg font-bold leading-tight">{range(min, max, "", " %", 1)}</p>
        <p className="text-[11px] font-medium text-primary">{label}</p>
        <p className="text-[10px] text-muted-foreground">Benchmark CH: 3.5–4.5 %</p>
      </div>
    </div>
  );
}

function MarketScale({ comparison }: { comparison?: string }) {
  const pos = comparison === "below_market" ? 16 : comparison === "at_market" ? 50 : comparison === "above_market" ? 84 : null;
  return (
    <div>
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, var(--chart-1), var(--chart-2), var(--chart-4))" }}>
        {pos != null && <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow" style={{ left: `${pos}%` }} />}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Unter Markt</span><span>Marktgerecht</span><span>Über Markt</span></div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-background/60 p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold leading-snug">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
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
