/**
 * Property Portal Connections (Core Step 4).
 * Fachmodell: Portal-Verbindung pro Firma (property_portal_connections).
 * Secrets liegen ausschliesslich serverseitig als Umgebungsvariablen; die Tabelle
 * speichert nur den Präfix (secret_ref), z. B. "PORTAL" → PORTAL_API_BASE_URL,
 * PORTAL_INBOUND_API_KEY, PORTAL_TARGET_API_KEY, PORTAL_SIGNING_SECRET.
 *
 * Protokoll "legacy_asimo_v1" = historisches ASIMO-Portal-Protokoll
 * (Header x-asimo-key / x-asimo-signature, Endpoint /api/public/asimo/properties).
 * Die Namen sind reines Wire-Protokoll und bestimmen nie die Firma.
 */
export type PortalConnection = {
  id: string;
  agency_id: string;
  provider_key: string;
  display_name: string;
  enabled: boolean;
  protocol: string;
  secret_ref: string;
};

export const SUPPORTED_PORTAL_PROTOCOLS = ["legacy_asimo_v1"] as const;

export function portalSecrets(secretRef: string) {
  const e = (k: string) => process.env[`${secretRef}_${k}`];
  return {
    apiBaseUrl: e("API_BASE_URL"),
    inboundApiKey: e("INBOUND_API_KEY"),
    targetApiKey: e("TARGET_API_KEY"),
    signingSecret: e("SIGNING_SECRET"),
  };
}

/**
 * Inbound: Genau eine aktive Verbindung mit diesem Protokoll + Secret-Satz,
 * deren Firma aktiv ist. Sonst null (fail closed).
 */
export async function resolveInboundConnection(
  sb: any,
  protocol: string,
  secretRef: string,
): Promise<PortalConnection | null> {
  const { data, error } = await sb
    .from("property_portal_connections")
    .select("id,agency_id,provider_key,display_name,enabled,protocol,secret_ref,agencies!inner(status)")
    .eq("enabled", true)
    .eq("protocol", protocol)
    .eq("secret_ref", secretRef);
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  if (row.agencies?.status !== "active") return null;
  const { agencies: _a, ...conn } = row;
  return conn as PortalConnection;
}
