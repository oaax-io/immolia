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
import { CANTON_NAMES } from "@/lib/cantons";
import { ArrowRight, BrainCircuit, Loader2, MapPin, RotateCcw, SlidersHorizontal, Sparkles, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";

const YIELD_MIN = 0, YIELD_MAX = 10;
const chf = (v: number) => new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(v);

export function RangeSlider({ value, min, max, step, onChange }: { value: [number, number]; min: number; max: number; step: number; onChange: (v: [number, number]) => void }) {
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
  const [isFs, setIsFs] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(property.id);
  const [cantonFilter, setCantonFilter] = useState("all");
  const [yieldRange, setYieldRange] = useState<[number, number]>([YIELD_MIN, YIELD_MAX]);
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const fittedRef = useRef(false);

  // All tenant properties – loaded only in fullscreen (RLS keeps it to the active firm)
  const { data: allProps = [] } = useQuery({
    queryKey: ["location-map-all-properties"],
    enabled: isFs,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, title, address, postal_code, city, country, price, rent, listing_type, status")
        .is("deleted_at", null);
      if (error) {
        const retry = await supabase.from("properties").select("id, title, address, postal_code, city, country, price, rent, listing_type, status");
        return (retry.data ?? []) as any[];
      }
      return (data ?? []) as any[];
    },
  });
  const geoItems = useMemo(
    () => allProps.filter((p) => p.id !== property.id && (p.address || p.city))
      .map((p) => ({ id: p.id, query: [p.address, p.postal_code, p.city, p.country || "Schweiz"].filter(Boolean).join(", ") })),
    [allProps, property.id],
  );
  const { data: allPoints = [] } = useQuery({
    queryKey: ["location-map-geocode", geoItems.map((i) => `${i.id}:${i.query}`).join("|")],
    enabled: isFs && geoItems.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const out: GeocodedPoint[] = [];
      for (let i = 0; i < geoItems.length; i += 50) out.push(...(await geocodeFn({ data: { items: geoItems.slice(i, i + 50) } })));
      return out;
    },
  });
  const { data: analysesById = new Map<string, Sections>() } = useQuery({
    queryKey: ["location-map-analyses"],
    enabled: isFs,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("property_market_analyses").select("property_id, sections, created_at").order("created_at", { ascending: false });
      const m = new Map<string, Sections>();
      for (const row of data ?? []) if (!m.has(row.property_id as string)) m.set(row.property_id as string, row.sections as Sections);
      return m;
    },
  });

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
    el.addEventListener("mouseenter", () => { if (!document.fullscreenElement) { setSelectedId(property.id); setShowDetails(true); } });
    el.addEventListener("click", () => { setSelectedId(property.id); setShowDetails(true); });
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
    const onFs = () => {
      const fs = !!document.fullscreenElement && document.fullscreenElement === wrapper.current;
      setIsFs(fs);
      if (!fs) { setSelectedId(property.id); fittedRef.current = false; map.flyTo({ center: [point.longitude, point.latitude], zoom: 17 }); }
      setTimeout(() => map.resize(), 50);
    };
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
      map.on("click", "parcel-fill", () => { setSelectedId(property.id); setShowDetails(true); });
    }
  }, [mapReady, parcel]);

  const propById = useMemo(() => new Map(allProps.map((p) => [p.id, p])), [allProps]);
  const priceOf = (p: any) => Number(p?.listing_type === "rent" ? p?.rent : p?.price) || 0;
  const yieldOf = (s?: Sections) => {
    const a = s?.rental?.gross_yield_min, b = s?.rental?.gross_yield_max;
    const v = [a, b].filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
  };
  const maxPrice = useMemo(() => {
    const m = Math.max(0, ...allProps.filter((p) => p.listing_type !== "rent").map((p) => Number(p.price) || 0));
    return m > 0 ? Math.ceil(m / 100_000) * 100_000 : 5_000_000;
  }, [allProps]);
  const pr = priceRange ?? [0, maxPrice];
  const cantonOptions = useMemo(() => {
    const c = new Map<string, number>();
    for (const pt of allPoints) { const k = pt.canton ?? "UNBEKANNT"; c.set(k, (c.get(k) ?? 0) + 1); }
    return [...c.entries()].sort(([a], [b]) => (CANTON_NAMES[a] ?? a).localeCompare(CANTON_NAMES[b] ?? b, "de"));
  }, [allPoints]);
  const yieldActive = yieldRange[0] > YIELD_MIN || yieldRange[1] < YIELD_MAX;
  const priceActive = !!priceRange && (priceRange[0] > 0 || priceRange[1] < maxPrice);
  const filteredPoints = useMemo(() => allPoints.filter((pt) => {
    const p = propById.get(pt.id);
    if (!p) return false;
    if (cantonFilter !== "all" && (pt.canton ?? "UNBEKANNT") !== cantonFilter) return false;
    if (yieldActive) { const y = yieldOf(analysesById.get(pt.id)); if (y == null || y < yieldRange[0] || y > yieldRange[1]) return false; }
    if (priceActive && p.listing_type !== "rent") { const v = priceOf(p); if (!v || v < pr[0] || v > pr[1]) return false; }
    if (priceActive && p.listing_type === "rent") return false;
    return true;
  }), [allPoints, propById, cantonFilter, yieldActive, yieldRange, priceActive, pr[0], pr[1], analysesById]);

  useEffect(() => {
    const map = mapReady;
    if (!map || !isFs) return;
    const markers: mapboxgl.Marker[] = [];
    for (const pt of filteredPoints) {
      const p = propById.get(pt.id);
      const el = document.createElement("button");
      el.type = "button";
      el.className = `property-map-marker canton-${pt.canton ?? "UNBEKANNT"}`;
      const v = priceOf(p);
      el.textContent = v ? (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)} Mio` : chf(v)) : "•";
      el.setAttribute("aria-label", p?.title ?? "Objekt");
      el.addEventListener("click", (e) => { e.stopPropagation(); setSelectedId(pt.id); setShowDetails(true); });
      markers.push(new mapboxgl.Marker({ element: el }).setLngLat([pt.longitude, pt.latitude]).addTo(map));
    }
    if (!fittedRef.current && filteredPoints.length && point) {
      fittedRef.current = true;
      const b = new mapboxgl.LngLatBounds([point.longitude, point.latitude], [point.longitude, point.latitude]);
      filteredPoints.filter((pt) => !isSwiss || (pt.latitude > 45.7 && pt.latitude < 47.9 && pt.longitude > 5.8 && pt.longitude < 10.6)).forEach((pt) => b.extend([pt.longitude, pt.latitude]));
      map.fitBounds(b, { padding: 80, maxZoom: 14, duration: 800 });
    }
    return () => markers.forEach((m) => m.remove());
  }, [mapReady, isFs, filteredPoints, propById, point]);

  const isMain = selectedId === property.id;
  const selProp = isMain ? property : propById.get(selectedId);
  const selSections = isMain ? latest : analysesById.get(selectedId) ?? null;

  const runAnalysis = async () => {
    setAnalysing(true);
    try {
      await analyseFn({ data: { propertyId: selectedId, requestId: crypto.randomUUID() } });
      await qc.invalidateQueries({ queryKey: ["market_analyses", selectedId] });
      await qc.invalidateQueries({ queryKey: ["location-map-analyses"] });
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

  const pp = selSections?.purchase_price;
  const r = selSections?.rental;
  const selQuery = isMain ? query : [selProp?.address, selProp?.postal_code, selProp?.city].filter(Boolean).join(", ");
  const resetFilters = () => { setCantonFilter("all"); setYieldRange([YIELD_MIN, YIELD_MAX]); setPriceRange(null); };

  return (
    <div ref={wrapper} className="relative h-full w-full bg-background" onMouseLeave={() => { if (!isFs) setShowDetails(false); }}>
      <div ref={container} className="h-full w-full" />
      {(geoLoading || !token) && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {isFs && (
        panelOpen ? (
          <div className="absolute left-4 top-4 z-20 w-80 space-y-4 rounded-2xl border bg-background/95 p-4 shadow-xl backdrop-blur-md">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-primary" />Suche & Filter</p>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Filter zurücksetzen" onClick={resetFilters}><RotateCcw className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Einklappen" onClick={() => setPanelOpen(false)}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Kanton</p>
              <Select value={cantonFilter} onValueChange={setCantonFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent container={wrapper.current ?? undefined}>
                  <SelectItem value="all">Alle Kantone</SelectItem>
                  {cantonOptions.map(([c, n]) => (
                    <SelectItem key={c} value={c}>{CANTON_NAMES[c] ?? "Unbekannt"} ({n})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="font-medium text-muted-foreground">Bruttorendite</span><span className="font-semibold">{yieldRange[0].toFixed(1)} – {yieldRange[1].toFixed(1)}{yieldRange[1] >= YIELD_MAX ? "+" : ""} %</span></div>
              <RangeSlider value={yieldRange} min={YIELD_MIN} max={YIELD_MAX} step={0.1} onChange={setYieldRange} />
              {yieldActive && <p className="text-[11px] text-muted-foreground">Nur Objekte mit KI-Marktanalyse.</p>}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="font-medium text-muted-foreground">Kaufpreis</span><span className="font-semibold">CHF {chf(pr[0])} – {chf(pr[1])}</span></div>
              <RangeSlider value={pr} min={0} max={maxPrice} step={Math.max(10_000, Math.round(maxPrice / 200 / 10_000) * 10_000)} onChange={setPriceRange} />
            </div>
            <p className="border-t pt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{filteredPoints.length}</span> von {allPoints.length} weiteren Objekten sichtbar</p>
          </div>
        ) : (
          <Button size="sm" className="absolute left-4 top-4 z-20 shadow-lg" onClick={() => setPanelOpen(true)}>
            <SlidersHorizontal className="mr-2 h-4 w-4" />Filter{filteredPoints.length !== allPoints.length ? ` (${filteredPoints.length})` : ""}
          </Button>
        )
      )}
      {showDetails && point && selProp && (
        <div className="absolute bottom-4 left-4 z-10 w-80 rounded-2xl border bg-background/90 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{selProp.title}</p>
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{selQuery}</p>
            </div>
            {isFs && <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setShowDetails(false)}><X className="h-3.5 w-3.5" /></Button>}
          </div>
          {isMain && (parcel?.parcel_no || property.parcel_no) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">Parzelle {parcel?.parcel_no || property.parcel_no}</span>
              {parcel?.canton && <span className="rounded-full bg-muted px-2 py-0.5">{parcel.canton}</span>}
              {parcel?.e_grid && <span className="rounded-full bg-muted px-2 py-0.5 font-mono">{parcel.e_grid}</span>}
            </div>
          )}
          {!isMain && priceOf(selProp) > 0 && (
            <p className="mt-2 text-xs"><span className="text-muted-foreground">{selProp.listing_type === "rent" ? "Miete" : "Preis"}:</span> <span className="font-semibold">CHF {chf(priceOf(selProp))}{selProp.listing_type === "rent" ? " / Mt." : ""}</span></p>
          )}
          {selSections ? (
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
          {!isMain && (
            <Button asChild size="sm" variant="outline" className="mt-2 w-full">
              <Link to="/properties/$id" params={{ id: selectedId }} onClick={() => document.exitFullscreen?.().catch(() => {})}>
                Objekt öffnen <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      )}
      {!showDetails && point && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1 text-xs shadow">
          <BrainCircuit className="h-3.5 w-3.5 text-primary" /> {isFs ? "Objekt anklicken für Details" : "Parzelle oder Marker berühren"}
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

export function YieldGauge({ min, max }: { min?: number; max?: number }) {
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

export function MarketScale({ comparison }: { comparison?: string }) {
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

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
