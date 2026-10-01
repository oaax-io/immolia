import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { getPortalConnectionStatus, publishPropertyToPortal } from "@/lib/portal.functions";

export function PortalPublishCard({ property }: { property: any }) {
  const qc = useQueryClient();
  const publish = useServerFn(publishPropertyToPortal);
  const fetchStatus = useServerFn(getPortalConnectionStatus);
  const status = useQuery({ queryKey: ["portal_connection_status"], queryFn: () => fetchStatus() });
  const enabled: boolean = !!property.portal_published;
  const name = status.data?.displayName ?? "Immobilienportal";
  const available = !!status.data?.available;

  const toggle = useMutation({
    mutationFn: async (next: boolean) => publish({ data: { propertyId: property.id, unpublish: !next } }),
    onSuccess: (_res, next) => {
      qc.invalidateQueries({ queryKey: ["property", property.id] });
      qc.invalidateQueries({ queryKey: ["properties"] });
      toast.success(next ? `Auf ${name} veröffentlicht` : `Von ${name} entfernt`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Veröffentlichung fehlgeschlagen"),
  });

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h3 className="font-display text-base font-semibold">
                {available ? `Auf ${name} veröffentlichen` : "Immobilienportal"}
              </h3>
              {enabled && available && <Badge variant="secondary" className="text-[10px]">Veröffentlicht</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {status.isLoading
                ? "Portal-Verbindung wird geprüft …"
                : available
                  ? "Überträgt dieses Objekt auf das verbundene Immobilienportal (unabhängig vom Freigabelink). Änderungen werden bei veröffentlichten Objekten automatisch synchronisiert."
                  : "Für diese Firma ist noch kein Immobilienportal verbunden."}
            </p>
            {available && enabled && property.portal_published_at && (
              <p className="text-xs text-muted-foreground">
                Zuletzt übertragen: {new Date(property.portal_published_at).toLocaleString("de-CH")}
              </p>
            )}
          </div>
          <Switch
            checked={enabled && available}
            disabled={!available || toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
