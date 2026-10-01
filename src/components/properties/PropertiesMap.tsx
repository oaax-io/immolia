import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getMapboxToken, geocodeAddresses, type GeocodedPoint } from "@/lib/mapbox.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { generatePropertyMarketAnalysis } from "@/lib/property-market-analysis.functions";
import { ArrowRight, Bed, BrainCircuit, Building2, Loader2, MapPin, Maximize, RotateCcw, Sparkles, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import {
  formatArea,
  formatCurrency,
  getPropertyStatusBadgeClass,
  propertyStatusLabels,
} from "@/lib/format";
import { PropertyPhoto } from "@/components/properties/PropertyPhoto";

interface Props {
  properties: any[];
}

// Switzerland bounding box / center
const CH_CENTER: [number, number] = [8.2275, 46.8182];
const CH_BOUNDS: [[number, number], [number, number]] = [
  [5.9559, 45.8180],
  [10.4914, 47.8084],
];

export const CANTON_NAMES: Record<string, string> = {
  AG: "Aargau", AI: "Appenzell Innerrhoden", AR: "Appenzell Ausserrhoden", BE: "Bern",
  BL: "Basel-Landschaft", BS: "Basel-Stadt", FR: "Freiburg", GE: "Genf", GL: "Glarus",
  GR: "Graubünden", JU: "Jura", LU: "Luzern", NE: "Neuenburg", NW: "Nidwalden",
  OW: "Obwalden", SG: "St. Gallen", SH: "Schaffhausen", SO: "Solothurn", SZ: "Schwyz",
  TG: "Thurgau", TI: "Tessin", UR: "Uri", VD: "Waadt", VS: "Wallis", ZG: "Zug", ZH: "Zürich",
};

type MarketSections = {
  purchase_price?: {
    estimated_value_min?: number;
    estimated_value_max?: number;
    comparison?: string;
  };
  rental?: {
    monthly_rent_min?: number;
    monthly_rent_max?: number;
    gross_yield_min?: number;
    gross_yield_max?: number;
  };
  recommendation?: { verdict?: string; summary?: string };
};

const comparisonLabels: Record<string, string> = {
  below_market: "Unter Marktwert",
  at_market: "Marktgerecht",
  above_market: "Über Marktwert",
  unknown: "Nicht eindeutig",
};

function potentialRange(min?: number, max?: number, suffix = "") {
  if (!Number.isFinite(min) && !Number.isFinite(max)) return "—";
  const format = (value?: number) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("de-CH", { maximumFractionDigits: suffix ? 1 : 0 }).format(value) : "—";
  if (min === max || !Number.isFinite(max)) return `${format(min)}${suffix}`;
  if (!Number.isFinite(min)) return `${format(max)}${suffix}`;
  return `${format(min)}–${format(max)}${suffix}`;
}

function inSwitzerland(lat: number, lng: number) {
  return (
    lng >= CH_BOUNDS[0][0] &&
    lng <= CH_BOUNDS[1][0] &&
    lat >= CH_BOUNDS[0][1] &&
    lat <= CH_BOUNDS[1][1]
  );
}

export function PropertiesMap({ properties }: Props) {
  const tokenFn = useServerFn(getMapboxToken);
  const geocodeFn = useServerFn(geocodeAddresses);
  const analyseFn = useServerFn(generatePropertyMarketAnalysis);
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [cantonFilter, setCantonFilter] = useState<string[]>([]);
  const [listingFilter, setListingFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [analysingId, setAnalysingId] = useState<string | null>(null);

  const { data: tokenData } = useQuery({
    queryKey: ["mapbox-token"],
    queryFn: () => tokenFn(),
    staleTime: Infinity,
  });
  const token = tokenData?.token ?? null;

  // Build geocode requests for properties with a usable address
  const geocodeItems = useMemo(() => {
    return properties
      .filter((p) => p.address || p.city || p.postal_code)
      .map((p) => ({
        id: p.id as string,
        query: [p.address, p.postal_code, p.city, p.country || "Schweiz"]
          .filter(Boolean)
          .join(", "),
        country: (p.country || "ch").toString().toLowerCase().slice(0, 2),
      }));
  }, [properties]);

  const geocodeKey = useMemo(
    () => geocodeItems.map((i) => `${i.id}:${i.query}`).join("|"),
    [geocodeItems],
  );

  const { data: points = [], isLoading: geocoding } = useQuery({
    queryKey: ["geocode-properties", geocodeKey],
    enabled: geocodeItems.length > 0,
    staleTime: 1000 * 60 * 60,
    queryFn: async () => {
      // chunk to keep server fn responsive
      const chunkSize = 50;
      const all: GeocodedPoint[] = [];
      for (let i = 0; i < geocodeItems.length; i += chunkSize) {
        const chunk = geocodeItems.slice(i, i + chunkSize);
        const res = await geocodeFn({ data: { items: chunk } });
        all.push(...res);
      }
      return all;
    },
  });

  const propertyById = useMemo(
    () => new Map(properties.map((p) => [p.id, p])),
    [properties],
  );

  const cantonByProperty = useMemo(
    () => new Map(points.map((point) => [point.id, point.canton ?? "UNBEKANNT"])),
    [points],
  );

  const cantons = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of points) {
      if (!propertyById.has(point.id) || !inSwitzerland(point.latitude, point.longitude)) continue;
      const canton = point.canton ?? "UNBEKANNT";
      counts.set(canton, (counts.get(canton) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => (CANTON_NAMES[a] ?? a).localeCompare(CANTON_NAMES[b] ?? b, "de"));
  }, [points, propertyById]);

  const visiblePoints = useMemo(() => points.filter((point) => {
    const property = propertyById.get(point.id);
    if (!property || !inSwitzerland(point.latitude, point.longitude)) return false;
    const canton = point.canton ?? "UNBEKANNT";
    if (cantonFilter.length > 0 && !cantonFilter.includes(canton)) return false;
    if (listingFilter !== "all" && property.listing_type !== listingFilter) return false;
    if (statusFilter !== "all" && property.status !== statusFilter) return false;
    return true;
  }), [points, propertyById, cantonFilter, listingFilter, statusFilter]);

  const visibleIds = useMemo(() => visiblePoints.map((point) => point.id), [visiblePoints]);
  const { data: analyses = [], refetch: refetchAnalyses } = useQuery({
    queryKey: ["map-market-analyses", visibleIds.join("|")],
    enabled: visibleIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_market_analyses")
        .select("id, property_id, created_at, sections")
        .in("property_id", visibleIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const latestAnalysisByProperty = useMemo(() => {
    const map = new Map<string, { id: string; created_at: string; sections: MarketSections }>();
    for (const row of analyses as any[]) {
      if (!map.has(row.property_id)) map.set(row.property_id, row);
    }
    return map;
  }, [analyses]);

  const selectedId = pinnedId ?? hoveredId;
  const selected = selectedId ? propertyById.get(selectedId) ?? null : null;
  const selectedAnalysis = selectedId ? latestAnalysisByProperty.get(selectedId) : undefined;

  // Init map once we have a token
  useEffect(() => {
    if (!token || !mapContainer.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: CH_CENTER,
      zoom: 7.2,
      minZoom: 7,
      maxBounds: [
        [4.5, 44.5],
        [12.5, 49.0],
      ],
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // Render markers when points change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // clear existing
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (visiblePoints.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const pt of visiblePoints) {
      const prop = propertyById.get(pt.id);
      if (!prop) continue;

      const el = document.createElement("button");
      el.type = "button";
      el.className = `property-map-marker canton-${pt.canton ?? "UNBEKANNT"}`;
      el.setAttribute("aria-label", `${prop.title}, ${CANTON_NAMES[pt.canton ?? ""] ?? "Kanton unbekannt"}`);
      const price = prop.listing_type === "rent" ? prop.rent : prop.price;
      el.textContent = price ? formatCurrency(Number(price)).replace(/\s/g, "") : "•";
      el.addEventListener("mouseenter", () => {
        if (!pinnedId) setHoveredId(prop.id);
      });
      el.addEventListener("mouseleave", () => setHoveredId(null));
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setPinnedId((current) => current === prop.id ? null : prop.id);
        setHoveredId(null);
        map.flyTo({ center: [pt.longitude, pt.latitude], zoom: Math.max(map.getZoom(), 12) });
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([pt.longitude, pt.latitude])
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([pt.longitude, pt.latitude]);
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 600 });
    } else {
      // No Swiss points — reset to Switzerland overview
      map.flyTo({ center: CH_CENTER, zoom: 7.2, duration: 600 });
    }
  }, [visiblePoints, propertyById, pinnedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const clearPinned = () => setPinnedId(null);
    map.on("click", clearPinned);
    return () => { map.off("click", clearPinned); };
  }, [token]);

  const runAnalysis = async (property: any) => {
    setAnalysingId(property.id);
    try {
      await analyseFn({ data: { propertyId: property.id, requestId: crypto.randomUUID() } });
      await refetchAnalyses();
      toast.success("KI-Potenzial wurde analysiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "KI-Analyse fehlgeschlagen");
    } finally {
      setAnalysingId(null);
    }
  };

  if (!token) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-xl border bg-muted/20 text-sm text-muted-foreground">
        Mapbox-Token nicht konfiguriert. Bitte MAPBOX_PUBLIC_TOKEN setzen.
      </div>
    );
  }

  const withoutAddress = properties.length - geocodeItems.length;
  const hasMapFilters = cantonFilter.length > 0 || listingFilter !== "all" || statusFilter !== "all";
  const resetMapFilters = () => {
    setCantonFilter([]);
    setListingFilter("all");
    setStatusFilter("all");
    setPinnedId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex max-w-full flex-wrap items-center gap-2 overflow-hidden rounded-lg border bg-card p-2 shadow-soft">
        <Select value={listingFilter} onValueChange={setListingFilter}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Kauf & Miete</SelectItem>
            <SelectItem value="sale">Verkauf</SelectItem>
            <SelectItem value="rent">Vermietung</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            {Object.entries(propertyStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="order-last flex w-full min-w-0 flex-nowrap gap-1.5 overflow-x-auto pb-1 lg:order-none lg:w-auto lg:flex-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
          {cantons.map(([canton, count]) => {
            const active = cantonFilter.length === 0 || cantonFilter.includes(canton);
            return (
              <Button
                key={canton}
                type="button"
                size="sm"
                variant="outline"
                className={`h-8 shrink-0 gap-1.5 px-2 ${active ? "opacity-100" : "opacity-45"}`}
                onClick={() => setCantonFilter((current) => current.includes(canton) ? current.filter((item) => item !== canton) : [...current, canton])}
              >
                <span className={`property-map-legend-dot canton-${canton}`} />
                {CANTON_NAMES[canton] ?? "Unbekannt"}
                <span className="text-muted-foreground">{count}</span>
              </Button>
            );
          })}
        </div>
        {hasMapFilters && (
          <Button type="button" size="sm" variant="ghost" onClick={resetMapFilters}>
            <RotateCcw className="mr-1 h-4 w-4" />Zurücksetzen
          </Button>
        )}
      </div>

      <div className="relative">
      <div
        ref={mapContainer}
        className="h-[calc(100vh-320px)] min-h-[500px] w-full overflow-hidden rounded-xl border"
      />

      {/* Info bar */}
      <div className="absolute left-3 top-3 z-10 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-soft backdrop-blur">
        {geocoding ? (
          <span className="text-muted-foreground">Adressen werden geladen…</span>
        ) : (
          <span>
            <strong>{visiblePoints.length}</strong> auf Karte
            {withoutAddress > 0 && (
              <span className="text-muted-foreground"> · {withoutAddress} ohne Adresse</span>
            )}
          </span>
        )}
      </div>

      {visiblePoints.length === 0 && !geocoding && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="rounded-lg border bg-background/95 px-4 py-3 text-sm shadow-soft backdrop-blur">Keine Immobilien entsprechen diesen Kartenfiltern.</div>
        </div>
      )}

      {selected && (
        <div className="absolute bottom-4 left-4 right-4 z-10 mx-auto max-w-xl overflow-hidden rounded-lg border bg-card shadow-glow">
          <div className="flex gap-3 p-3">
            <Link
              to="/properties/$id"
              params={{ id: selected.id }}
              className="block h-28 w-32 shrink-0 overflow-hidden rounded-md bg-muted"
            >
              <PropertyPhoto sources={selected.images} alt={selected.title} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  to="/properties/$id"
                  params={{ id: selected.id }}
                  className="line-clamp-1 font-semibold hover:text-primary"
                >
                  {selected.title}
                </Link>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => { setPinnedId(null); setHoveredId(null); }}
                  className="h-7 w-7 shrink-0"
                  aria-label="Schliessen"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Badge
                variant="outline"
                className={`mt-1 text-[10px] ${getPropertyStatusBadgeClass(selected.status)}`}
              >
                {propertyStatusLabels[selected.status as keyof typeof propertyStatusLabels]}
              </Badge>
              <p className="mt-1 line-clamp-1 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {[selected.address, selected.city].filter(Boolean).join(", ") || "—"}
              </p>
               <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-display text-sm font-bold">
                  {formatCurrency(
                    selected.listing_type === "rent"
                      ? selected.rent
                        ? Number(selected.rent)
                        : null
                      : selected.price
                      ? Number(selected.price)
                      : null,
                  )}
                  {selected.listing_type === "rent" && selected.rent && (
                    <span className="text-[10px] font-normal text-muted-foreground"> /Mt.</span>
                  )}
                </span>
                <div className="flex gap-2 text-[11px] text-muted-foreground">
                  {selected.rooms && (
                    <span className="flex items-center gap-0.5">
                      <Bed className="h-3 w-3" />
                      {selected.rooms}
                    </span>
                  )}
                  {(selected.living_area || selected.area) && (
                    <span className="flex items-center gap-0.5">
                      <Maximize className="h-3 w-3" />
                      {formatArea(Number(selected.living_area || selected.area))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="border-t bg-muted/20 p-3">
            {selectedAnalysis?.sections ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border bg-background p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold"><TrendingUp className="h-3.5 w-3.5 text-success" />Verkaufspotenzial</p>
                  <p className="mt-1 text-sm font-semibold">{potentialRange(selectedAnalysis.sections.purchase_price?.estimated_value_min, selectedAnalysis.sections.purchase_price?.estimated_value_max)} CHF</p>
                  <p className="text-[11px] text-muted-foreground">{comparisonLabels[selectedAnalysis.sections.purchase_price?.comparison ?? ""] ?? "KI-Markteinschätzung"}</p>
                </div>
                <div className="rounded-md border bg-background p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold"><Building2 className="h-3.5 w-3.5 text-primary" />Vermietungspotenzial</p>
                  <p className="mt-1 text-sm font-semibold">{potentialRange(selectedAnalysis.sections.rental?.monthly_rent_min, selectedAnalysis.sections.rental?.monthly_rent_max)} CHF/Mt.</p>
                  <p className="text-[11px] text-muted-foreground">Bruttorendite {potentialRange(selectedAnalysis.sections.rental?.gross_yield_min, selectedAnalysis.sections.rental?.gross_yield_max, "%")}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold"><BrainCircuit className="h-3.5 w-3.5 text-primary" />Noch keine Potenzialanalyse</p>
                  <p className="text-[11px] text-muted-foreground">Wird nur auf deinen Klick erstellt und gespeichert.</p>
                </div>
                <Button type="button" size="sm" onClick={() => runAnalysis(selected)} disabled={analysingId === selected.id}>
                  {analysingId === selected.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                  KI-Potenzial analysieren
                </Button>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium canton-label canton-${cantonByProperty.get(selected.id) ?? "UNBEKANNT"}`}>
                <span className={`property-map-legend-dot canton-${cantonByProperty.get(selected.id) ?? "UNBEKANNT"}`} />
                {CANTON_NAMES[cantonByProperty.get(selected.id) ?? ""] ?? "Kanton unbekannt"}
              </span>
              <Button asChild type="button" size="sm" variant="ghost">
                <Link to="/properties/$id" params={{ id: selected.id }}>Objekt öffnen<ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
