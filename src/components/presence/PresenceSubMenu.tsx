import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PRESENCE_OPTIONS, presenceMeta } from "@/lib/presence";
import { PresenceDot } from "./PresenceDot";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export function useMyPresence() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-presence", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("presence_status, presence_updated_at")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        status: (data?.presence_status ?? "offline") as string,
        updatedAt: (data?.presence_updated_at ?? null) as string | null,
      };
    },
  });
}

export function PresenceSubMenu() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: presence } = useMyPresence();
  const status = presence?.status;
  const meta = presenceMeta(status);

  const setStatus = async (value: string) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from("profiles")
      .update({ presence_status: value, presence_updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) {
      toast.error("Status konnte nicht gespeichert werden");
      return;
    }
    qc.invalidateQueries({ queryKey: ["my-presence"] });
    qc.invalidateQueries({ queryKey: ["team-members"] });
    qc.invalidateQueries({ queryKey: ["chat-member"] });
    toast.success(`Status: ${presenceMeta(value).label}`);
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PresenceDot status={status} updatedAt={presence?.updatedAt} ring={false} className="mr-2" />
        <span className="flex-1">Status</span>
        <span className="ml-2 text-xs text-muted-foreground">{meta.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        {PRESENCE_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => setStatus(o.value)}>
            <PresenceDot status={o.value} ring={false} raw className="mr-2" />
            <span className="flex-1">{o.label}</span>
            {status === o.value && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
