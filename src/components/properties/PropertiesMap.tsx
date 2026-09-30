import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getMapboxToken, geocodeAddresses, type GeocodedPoint } from "@/lib/mapbox.functions";
import { Badge } from "@/components/ui/badge";
import { MapPin, Bed, Maximize } from "lucide-react";
import {
  formatArea,
  formatCurrency,
  getPropertyStatusBadgeClass,
  propertyStatusLabels,
} from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
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
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [selected, setSelected] = useState<any | null>(null);

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

    if (points.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const pt of points) {
      // Keep map focused on Switzerland — skip foreign geocode results
      if (!inSwitzerland(pt.latitude, pt.longitude)) continue;
      const prop = propertyById.get(pt.id);
      if (!prop) continue;

      const el = document.createElement("button");
      el.type = "button";
      el.className =
        "flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-primary px-2 text-xs font-semibold text-primary-foreground shadow-md transition hover:scale-110";
      const price = prop.listing_type === "rent" ? prop.rent : prop.price;
      el.textContent = price ? formatCurrency(Number(price)).replace(/\s/g, "") : "•";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(prop);
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
  }, [points, propertyById]);

  if (!token) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-xl border bg-muted/20 text-sm text-muted-foreground">
        Mapbox-Token nicht konfiguriert. Bitte MAPBOX_PUBLIC_TOKEN setzen.
      </div>
    );
  }

  const withoutAddress = properties.length - geocodeItems.length;

  return (
    <div className="relative">
      <div
        ref={mapContainer}
        className="h-[calc(100vh-280px)] min-h-[500px] w-full overflow-hidden rounded-xl border"
      />

      {/* Info bar */}
      <div className="absolute left-3 top-3 z-10 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-soft backdrop-blur">
        {geocoding ? (
          <span className="text-muted-foreground">Adressen werden geladen…</span>
        ) : (
          <span>
            <strong>{points.length}</strong> auf Karte
            {withoutAddress > 0 && (
              <span className="text-muted-foreground"> · {withoutAddress} ohne Adresse</span>
            )}
          </span>
        )}
      </div>

      {/* Selected property card */}
      {selected && (
        <div className="absolute bottom-4 left-4 right-4 z-10 mx-auto max-w-md rounded-xl border bg-card shadow-glow">
          <div className="flex gap-3 p-3">
            <Link
              to="/properties/$id"
              params={{ id: selected.id }}
              className="block h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-muted"
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
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Schliessen"
                >
                  ×
                </button>
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
              <div className="mt-1 flex items-center justify-between">
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
        </div>
      )}
    </div>
  );
}
