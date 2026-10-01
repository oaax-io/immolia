import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AddressSuggestion = {
  id: string;
  label: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  country_code: string;
  longitude: number | null;
  latitude: number | null;
};

export const getMapboxToken = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ token: string | null }> => {
    return { token: process.env.MAPBOX_PUBLIC_TOKEN ?? null };
  },
);

export type GeocodedPoint = {
  id: string;
  longitude: number;
  latitude: number;
  canton: string | null;
};

export const geocodeAddresses = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        items: z
          .array(
            z.object({
              id: z.string(),
              query: z.string().min(2),
              country: z.string().optional(),
            }),
          )
          .max(200),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<GeocodedPoint[]> => {
    const token = process.env.MAPBOX_PUBLIC_TOKEN;
    if (!token) return [];

    const out: GeocodedPoint[] = [];
    await Promise.all(
      data.items.map(async (it) => {
        const params = new URLSearchParams({
          access_token: token,
          limit: "1",
          language: "de",
          types: "address,place,postcode,locality",
        });
        if (it.country) params.set("country", it.country);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          it.query,
        )}.json?${params.toString()}`;
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const json = (await res.json()) as any;
          const f = json.features?.[0];
          if (!f?.center) return;
          const context = Array.isArray(f.context) ? f.context : [];
          const region = [f, ...context].find(
            (entry: any) => typeof entry?.id === "string" && entry.id.startsWith("region."),
          );
          const shortCode = typeof region?.properties?.short_code === "string"
            ? region.properties.short_code
            : typeof region?.short_code === "string"
              ? region.short_code
              : "";
          const canton = shortCode.includes("-")
            ? shortCode.split("-").pop()?.toUpperCase() ?? null
            : null;
          out.push({ id: it.id, longitude: f.center[0], latitude: f.center[1], canton });
        } catch {
          /* ignore */
        }
      }),
    );
    return out;
  });

export const searchAddress = createServerFn({ method: "GET" })
  .inputValidator((data) =>
    z
      .object({
        q: z.string().min(2),
        country: z.string().optional(),
        language: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<AddressSuggestion[]> => {
    const token = process.env.MAPBOX_PUBLIC_TOKEN;
    if (!token) return [];

    const params = new URLSearchParams({
      access_token: token,
      autocomplete: "true",
      limit: "6",
      language: data.language ?? "de",
      types: "address,place,postcode,locality,neighborhood",
    });
    if (data.country) params.set("country", data.country);

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      data.q,
    )}.json?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as any;

    return (json.features ?? []).map((f: any): AddressSuggestion => {
      const ctx: any[] = f.context ?? [];
      const find = (prefix: string) =>
        ctx.find((c) => typeof c.id === "string" && c.id.startsWith(prefix));
      const postcode = find("postcode")?.text ?? "";
      const place = find("place")?.text ?? find("locality")?.text ?? "";
      const country = find("country");
      const street =
        f.place_type?.[0] === "address"
          ? `${f.text ?? ""}${f.address ? " " + f.address : ""}`.trim()
          : f.text ?? "";
      const [lng, lat] = f.center ?? [null, null];
      return {
        id: f.id,
        label: f.place_name,
        street,
        postal_code: postcode,
        city: place,
        country: country?.text ?? "",
        country_code: (country?.short_code ?? "").toUpperCase(),
        longitude: lng,
        latitude: lat,
      };
    });
  });

export type NearbyPoi = {
  id: string;
  name: string;
  category: "transit" | "school" | "shop" | "restaurant" | "park" | "health" | "other";
  distance_m: number;
  longitude: number;
  latitude: number;
};

const POI_QUERIES: Array<{ q: string; category: NearbyPoi["category"] }> = [
  { q: "Bahnhof", category: "transit" },
  { q: "Bushaltestelle", category: "transit" },
  { q: "Schule", category: "school" },
  { q: "Supermarkt", category: "shop" },
  { q: "Restaurant", category: "restaurant" },
  { q: "Park", category: "park" },
  { q: "Apotheke", category: "health" },
];

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export const getNearbyPois = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        longitude: z.number(),
        latitude: z.number(),
        country: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<NearbyPoi[]> => {
    const token = process.env.MAPBOX_PUBLIC_TOKEN;
    if (!token) return [];

    const results = await Promise.all(
      POI_QUERIES.map(async ({ q, category }) => {
        const params = new URLSearchParams({
          access_token: token,
          limit: "2",
          language: "de",
          proximity: `${data.longitude},${data.latitude}`,
          types: "poi",
        });
        if (data.country) params.set("country", data.country);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params.toString()}`;
        try {
          const res = await fetch(url);
          if (!res.ok) return [] as NearbyPoi[];
          const json = (await res.json()) as any;
          return (json.features ?? [])
            .filter((f: any) => Array.isArray(f.center))
            .map((f: any): NearbyPoi => {
              const [lng, lat] = f.center;
              return {
                id: f.id,
                name: f.text ?? f.place_name ?? q,
                category,
                distance_m: haversine(data.latitude, data.longitude, lat, lng),
                longitude: lng,
                latitude: lat,
              };
            });
        } catch {
          return [] as NearbyPoi[];
        }
      }),
    );

    return results
      .flat()
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 10);
  });

export function buildStaticMapUrl(opts: {
  longitude: number;
  latitude: number;
  zoom?: number;
  width?: number;
  height?: number;
  token: string;
  pois?: Array<{ longitude: number; latitude: number }>;
}): string {
  const { longitude, latitude, zoom = 14, width = 1000, height = 600, token, pois = [] } = opts;
  const mainPin = `pin-l+e63946(${longitude},${latitude})`;
  const poiPins = pois
    .slice(0, 8)
    .map((p) => `pin-s+3b82f6(${p.longitude},${p.latitude})`)
    .join(",");
  const overlays = [mainPin, poiPins].filter(Boolean).join(",");
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/${longitude},${latitude},${zoom},0/${width}x${height}@2x?access_token=${token}`;
}

