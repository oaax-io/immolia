import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantConfig } from "@/lib/tenant-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { startCall } from "@/lib/calls";

type Member = { id: string; full_name: string | null; email: string | null; avatar_url: string | null };

/** Weitere Teammitglieder der aktiven Firma in denselben Anrufraum einladen. */
export function AddCallParticipant({
  room,
  callerId,
  exclude,
  title,
}: {
  room: string;
  callerId: string;
  exclude: string[];
  title?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [invited, setInvited] = useState<string[]>([]);
  const agencyId = useTenantConfig().data?.agency_id ?? null;

  const { data: members = [] } = useQuery({
    queryKey: ["call-invite-members", agencyId],
    enabled: open && !!agencyId,
    queryFn: async () => {
      const { data: mem, error: mErr } = await supabase
        .from("agency_memberships").select("user_id").eq("agency_id", agencyId!).eq("is_active", true);
      if (mErr) throw mErr;
      const ids = (mem ?? []).map((m) => m.user_id);
      if (!ids.length) return [] as Member[];
      const { data, error } = await supabase
        .from("profiles").select("id, full_name, email, avatar_url")
        .in("id", ids).eq("is_active", true).order("full_name");
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });

  const list = members
    .filter((m) => !exclude.includes(m.id))
    .filter((m) => `${m.full_name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  const invite = async (m: Member) => {
    try {
      await startCall({ room, callerId, calleeId: m.id, title: title ?? null });
      setInvited((p) => [...p, m.id]);
      toast.message(`${m.full_name ?? m.email} wird angerufen…`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Teilnehmende hinzufügen">
          <UserPlus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[70] w-72 p-2">
        <p className="px-1 pb-2 text-sm font-medium">Teilnehmende hinzufügen</p>
        <Input placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2 h-8" />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {list.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Keine Personen gefunden</p>}
          {list.map((m) => {
            const done = invited.includes(m.id);
            return (
              <div key={m.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={m.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[9px]">{(m.full_name ?? m.email ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">{m.full_name ?? m.email}</span>
                <Button size="sm" variant={done ? "secondary" : "outline"} className="h-7" disabled={done} onClick={() => void invite(m)}>
                  {done ? "Eingeladen" : "Anrufen"}
                </Button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
