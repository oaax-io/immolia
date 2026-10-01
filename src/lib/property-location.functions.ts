import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

const gatewayHeaders = (fieldMask: string) => {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) throw new Error("Google-Adresssuche ist nicht konfiguriert.");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": mapsKey,
    "Content-Type": "application/json",
    "X-Goog-FieldMask": fieldMask,
  };
};

async function googleError(res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  console.error(`Google Maps request failed [${res.status}]: ${body}`);
  throw new Error(res.status === 429 ? "Zu viele Adressanfragen. Bitte kurz warten." : `Google-Adresssuche fehlgeschlagen (${res.status}).`);
}

export const searchGoogleAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({
    q: z.string().trim().min(3).max(200),
    country: z.string().max(30).optional(),
    sessionToken: z.string().uuid(),
  }).parse(value))
  .handler(async ({ data }): Promise<AddressSuggestion[]> => {
    const countryCodes = (data.country ?? "ch,de,at,li").split(",").map((code) => code.trim().toLowerCase()).filter(Boolean).slice(0, 5);
    const res = await fetch("https://connector-gateway.lovable.dev/google_maps/places/v1/places:autocomplete", {
      method: "POST",
      headers: gatewayHeaders("suggestions.placePrediction.placeId,suggestions.placePrediction.text.text"),
      body: JSON.stringify({
        input: data.q,
        sessionToken: data.sessionToken,
        includedRegionCodes: countryCodes,
        languageCode: "de",
        locationBias: { circle: { center: { latitude: 46.8182, longitude: 8.2275 }, radius: 50000 } },
      }),
    });
    if (!res.ok) return googleError(res);
    const json = await res.json() as { suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }> };
    return (json.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      if (!prediction?.placeId || !prediction.text?.text) return [];
      return [{ id: prediction.placeId, label: prediction.text.text, street: "", postal_code: "", city: "", country: "", country_code: "", longitude: null, latitude: null }];
    }).slice(0, 6);
  });

export const resolveGoogleAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ placeId: z.string().min(3).max(300), sessionToken: z.string().uuid() }).parse(value))
  .handler(async ({ data }): Promise<AddressSuggestion> => {
    const url = new URL(`https://connector-gateway.lovable.dev/google_maps/places/v1/places/${encodeURIComponent(data.placeId)}`);
    url.searchParams.set("sessionToken", data.sessionToken);
    url.searchParams.set("languageCode", "de");
    const res = await fetch(url, { headers: gatewayHeaders("id,formattedAddress,addressComponents,location") });
    if (!res.ok) return googleError(res);
    const place = await res.json() as {
      id?: string;
      formattedAddress?: string;
      addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
      location?: { latitude?: number; longitude?: number };
    };
    const component = (type: string) => place.addressComponents?.find((item) => item.types?.includes(type));
    const route = component("route")?.longText ?? "";
    const number = component("street_number")?.longText ?? "";
    const city = component("locality")?.longText ?? component("postal_town")?.longText ?? component("administrative_area_level_2")?.longText ?? "";
    const country = component("country");
    return {
      id: place.id ?? data.placeId,
      label: place.formattedAddress ?? [route, number, city].filter(Boolean).join(" "),
      street: [route, number].filter(Boolean).join(" "),
      postal_code: component("postal_code")?.longText ?? "",
      city,
      country: country?.longText ?? "",
      country_code: country?.shortText?.toUpperCase() ?? "",
      longitude: place.location?.longitude ?? null,
      latitude: place.location?.latitude ?? null,
    };
  });

async function geocodeSwissAddress(query: string): Promise<{ east: number; north: number }> {
  const url = new URL("https://api3.geo.admin.ch/rest/services/api/SearchServer");
  url.search = new URLSearchParams({ searchText: query, type: "locations", origins: "address,parcel", sr: "2056", limit: "1" }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error("Die Adresse konnte nicht im Schweizer Kataster gefunden werden.");
  const json = await res.json() as { results?: Array<{ attrs?: { y?: number; x?: number } }> };
  const attrs = json.results?.[0]?.attrs;
  const east = Number(attrs?.y);
  const north = Number(attrs?.x);
  if (!Number.isFinite(east) || !Number.isFinite(north)) throw new Error("Zu dieser Adresse wurde keine Katasterkoordinate gefunden.");
  return { east, north };
}

export const lookupSwissParcel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({
    latitude: z.number().min(45).max(48).nullish(),
    longitude: z.number().min(5).max(11).nullish(),
    address: z.string().trim().min(3).max(300).optional(),
  }).parse(value))
  .handler(async ({ data }): Promise<{ parcel_no: string; e_grid: string; canton: string }> => {
    let east = NaN;
    let north = NaN;
    if (typeof data.latitude === "number" && typeof data.longitude === "number") {
      const transform = new URL("https://geodesy.geo.admin.ch/reframe/wgs84tolv95");
      transform.search = new URLSearchParams({ easting: String(data.longitude), northing: String(data.latitude), altitude: "0", format: "json" }).toString();
      const transformed = await fetch(transform);
      if (!transformed.ok) throw new Error("Die Koordinaten konnten nicht für den Kataster umgerechnet werden.");
      const lv95 = await transformed.json() as { easting?: string; northing?: string };
      east = Number(lv95.easting);
      north = Number(lv95.northing);
    } else if (data.address) {
      ({ east, north } = await geocodeSwissAddress(data.address));
    }
    if (!Number.isFinite(east) || !Number.isFinite(north)) throw new Error("Bitte zuerst eine gültige Adresse erfassen.");

    for (const tolerance of [2, 6, 10]) {
      const identify = new URL("https://api3.geo.admin.ch/rest/services/api/MapServer/identify");
      identify.search = new URLSearchParams({
        geometry: `${east},${north}`, geometryType: "esriGeometryPoint",
        layers: "all:ch.kantone.cadastralwebmap-farbe", tolerance: String(tolerance),
        mapExtent: `${east - 500},${north - 500},${east + 500},${north + 500}`,
        imageDisplay: "800,600,96", sr: "2056", lang: "de", returnGeometry: "false",
      }).toString();
      const response = await fetch(identify);
      if (!response.ok) continue;
      const result = await response.json() as { results?: Array<{ attributes?: { number?: string; egris_egrid?: string; ak?: string } }> };
      const attributes = result.results?.[0]?.attributes;
      if (attributes?.number || attributes?.egris_egrid) return { parcel_no: attributes.number ?? "", e_grid: attributes.egris_egrid ?? "", canton: attributes.ak ?? "" };
    }
    throw new Error("Für diese Adresse wurde keine amtliche Parzelle gefunden.");
  });
export const getSwissParcelGeometry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({
    latitude: z.number().min(45).max(48),
    longitude: z.number().min(5).max(11),
  }).parse(value))
  .handler(async ({ data }): Promise<{ parcel_no: string; e_grid: string; canton: string; geometry: { type: string; coordinates: number[][][] } } | null> => {
    const { latitude: lat, longitude: lng } = data;
    const identify = new URL("https://api3.geo.admin.ch/rest/services/api/MapServer/identify");
    identify.search = new URLSearchParams({
      geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint",
      layers: "all:ch.kantone.cadastralwebmap-farbe", tolerance: "2",
      mapExtent: `${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}`,
      imageDisplay: "800,600,96", sr: "4326", lang: "de",
      returnGeometry: "true", geometryFormat: "geojson",
    }).toString();
    const res = await fetch(identify);
    if (!res.ok) return null;
    const json = await res.json() as { results?: Array<{ geometry?: { type: string; coordinates: number[][][] }; properties?: { number?: string; egris_egrid?: string; ak?: string } }> };
    const hit = json.results?.find((r) => r.geometry);
    if (!hit) return null;
    return { parcel_no: hit.properties?.number ?? "", e_grid: hit.properties?.egris_egrid ?? "", canton: hit.properties?.ak ?? "", geometry: hit.geometry! };
  });
