import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type MyProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export const myProfileKey = (userId?: string | null) => ["my-profile", userId ?? "anon"];

/**
 * Profil des angemeldeten Users (inkl. Profilbild) – live aktualisiert.
 */
export function useMyProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: myProfileKey(userId),
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as MyProfile | null;
    },
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      // Eindeutiger Kanal pro Hook-Instanz – mehrere Komponenten dürfen den Hook nutzen.
      .channel(`my-profile-${userId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => {
          qc.setQueryData(myProfileKey(userId), payload.new as MyProfile);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const fallbackName =
    (user?.user_metadata as any)?.full_name || user?.email || null;

  const fullName = query.data?.full_name || fallbackName;
  const avatarUrl =
    query.data?.avatar_url || ((user?.user_metadata as any)?.avatar_url ?? null);

  const initials = (fullName || "U")
    .split(" ")
    .map((s: string) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return { profile: query.data ?? null, fullName, avatarUrl, initials, email: user?.email ?? null };
}
