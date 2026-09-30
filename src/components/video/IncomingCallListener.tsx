import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Phone, PhoneOff, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CALL_RING_MS, createRingtone, setCallStatus, type CallRow } from "@/lib/calls";
import { toast } from "sonner";

type Caller = { full_name: string | null; email: string | null; avatar_url: string | null };

/**
 * Zeigt eingehende Videoanrufe an (klingeln, annehmen, ablehnen, verpasst).
 * Wird einmal global im Chat-Dock gerendert.
 */
export function IncomingCallListener({
  onAccept,
}: {
  onAccept: (callerId: string, callId: string, room: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [call, setCall] = useState<CallRow | null>(null);
  const [caller, setCaller] = useState<Caller | null>(null);
  // Zustandsmaschine: genau EIN klingelnder Anruf pro Client (idle | ringing).
  // Alle Ressourcen (Ton, Timer, aktive ID) hängen an diesem einen Slot.
  const activeIdRef = useRef<string | null>(null);
  const ringRef = useRef<ReturnType<typeof createRingtone> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Ring-Zustand vollständig beenden: Ton aus, Timer weg, UI weg. */
  const clear = useCallback(() => {
    ringRef.current?.stop();
    ringRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    activeIdRef.current = null;
    setCall(null);
    setCaller(null);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const me = user.id;
    let disposed = false;
    const ch = supabase
      .channel(`incoming-calls:${me}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "video_calls" },
        async (payload) => {
          const row = payload.new as CallRow;
          if (row.status !== "ringing") return;
          if (row.created_by === me) return;
          if (!(row.participants ?? []).includes(me)) return;
          if (Date.now() - new Date(row.started_at).getTime() > CALL_RING_MS) return;

          // Besetzt: während bereits ein Anruf klingelt, wird der zweite sofort als
          // verpasst abgeschlossen (Anrufer erhält Meldung), der erste klingelt weiter.
          if (activeIdRef.current && activeIdRef.current !== row.id) {
            void setCallStatus(row.id, "missed").catch(() => {});
            return;
          }
          activeIdRef.current = row.id;

          const { data } = await supabase
            .from("profiles")
            .select("full_name, email, avatar_url")
            .eq("id", row.created_by)
            .maybeSingle();
          // Während des Profil-Ladens beendet/ersetzt/abgemeldet? Dann nichts starten.
          if (disposed || activeIdRef.current !== row.id) return;
          setCaller((data as Caller | null) ?? null);
          setCall(row);

          ringRef.current?.stop();
          ringRef.current = createRingtone();
          ringRef.current.start();
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          const remaining = Math.max(0, CALL_RING_MS - (Date.now() - new Date(row.started_at).getTime()));
          timeoutRef.current = setTimeout(() => {
            if (activeIdRef.current !== row.id) return;
            clear();
            void setCallStatus(row.id, "missed").catch(() => {});
            toast.error(`Verpasster Anruf von ${data?.full_name ?? data?.email ?? "Kollege"}`);
            qc.invalidateQueries({ queryKey: ["notifications"] });
          }, remaining);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "video_calls" },
        (payload) => {
          const row = payload.new as CallRow;
          // Anrufer hat aufgelegt / anderswo angenommen / Timeout: Ring-Zustand beenden.
          if (row.id === activeIdRef.current && row.status !== "ringing") clear();
        },
      )
      .subscribe();
    return () => {
      // Abmelden / Benutzerwechsel / Unmount: alles freigeben, nichts bleibt klingeln.
      disposed = true;
      supabase.removeChannel(ch);
      clear();
    };
  }, [user?.id, qc, clear]);

  if (!call) return null;

  const name = caller?.full_name ?? caller?.email ?? "Kollege";

  return (
    <div className="fixed bottom-4 left-4 z-[60] w-[320px] overflow-hidden rounded-xl border bg-background shadow-2xl">
      <div className="flex items-center gap-2 border-b bg-primary/10 px-3 py-2">
        <Video className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Eingehender Videoanruf</span>
      </div>
      <div className="flex items-center gap-3 p-4">
        <Avatar className="h-11 w-11">
          <AvatarImage src={caller?.avatar_url ?? undefined} />
          <AvatarFallback className="text-xs">
            {name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="animate-pulse text-xs text-muted-foreground">ruft an…</p>
        </div>
      </div>
      <div className="flex gap-2 border-t p-3">
        <Button
          variant="outline"
          className="flex-1 gap-1.5"
          onClick={async () => {
            const id = call.id;
            clear();
            await setCallStatus(id, "declined").catch(() => {});
          }}
        >
          <PhoneOff className="h-4 w-4 text-destructive" /> Ablehnen
        </Button>
        <Button
          className="flex-1 gap-1.5"
          onClick={async () => {
            const id = call.id;
            const from = call.created_by;
            const room = call.room_name;
            clear();
            await setCallStatus(id, "accepted").catch(() => {});
            onAccept(from, id, room);
          }}
        >
          <Phone className="h-4 w-4" /> Annehmen
        </Button>
      </div>
    </div>
  );
}
