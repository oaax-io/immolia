import { useTenantConfig } from "@/lib/tenant-config";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCheck, Calendar, CheckSquare, UserPlus, Info, Target, Settings2, Volume2, VolumeX } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NotificationPreferencesForm } from "@/components/settings/NotificationPreferencesForm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SOUND_KEY = "notif-sound-enabled";


type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

const TYPE_ICONS: Record<string, typeof Bell> = {
  appointment: Calendar,
  task: CheckSquare,
  lead: UserPlus,
  match: Target,
};

const TYPE_STYLES: Record<string, { icon: string; iconUnread: string; accent: string; unreadBg: string }> = {
  appointment: {
    icon: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    iconUnread: "bg-sky-500 text-white",
    accent: "border-l-sky-500",
    unreadBg: "bg-sky-50/70 dark:bg-sky-950/20",
  },
  task: {
    icon: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    iconUnread: "bg-amber-500 text-white",
    accent: "border-l-amber-500",
    unreadBg: "bg-amber-50/70 dark:bg-amber-950/20",
  },
  match: {
    icon: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    iconUnread: "bg-violet-500 text-white",
    accent: "border-l-violet-500",
    unreadBg: "bg-violet-50/70 dark:bg-violet-950/20",
  },
  lead: {
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    iconUnread: "bg-emerald-500 text-white",
    accent: "border-l-emerald-500",
    unreadBg: "bg-emerald-50/70 dark:bg-emerald-950/20",
  },
};
const DEFAULT_TYPE_STYLE = {
  icon: "bg-muted text-muted-foreground",
  iconUnread: "bg-primary text-primary-foreground",
  accent: "border-l-primary",
  unreadBg: "bg-primary/5",
};

export function NotificationCenter() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundRef = useRef(true);
  const [shake, setShake] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const stored = localStorage.getItem(SOUND_KEY);
    const val = stored === null ? true : stored === "true";
    setSoundEnabled(val);
    soundRef.current = val;
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundRef.current = next;
    localStorage.setItem(SOUND_KEY, String(next));
    if (next) playDing();
  };

  const playDing = () => {
    try {
      if (!soundRef.current) return;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();

      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const tones = [880, 1320];
      tones.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.12;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch {
      // ignore
    }
  };

  const agencyId = useTenantConfig().data?.agency_id ?? null;
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", agencyId, user?.id],
    enabled: !!user && !!agencyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("notifications-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          const n = payload.new as Notification;
          playDing();
          setShake(true);
          setTimeout(() => setShake(false), 950);
          toast(n.title, {
            description: n.message ?? undefined,
            action: n.link
              ? { label: "Öffnen", onClick: () => navigateRef.current({ to: n.link as never }) }
              : undefined,
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!user) return;
      await supabase
        .from("notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("is_read", false);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleClick = (n: Notification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) {
      setOpen(false);
      navigate({ to: n.link as never });
    }
  };

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className={cn("h-[18px] w-[18px]", shake && "animate-bell-shake")} />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Benachrichtigungen</h3>
            {unreadCount > 0 && <Badge variant="secondary" className="h-5 text-[10px]">{unreadCount} neu</Badge>}
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={soundEnabled ? "Ton ausschalten" : "Ton einschalten"}
              onClick={toggleSound}
            >
              {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Benachrichtigungseinstellungen"
              onClick={() => { setOpen(false); setSettingsOpen(true); }}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[400px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 opacity-30" />
              <p>Keine Benachrichtigungen</p>
            </div>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Info;
                const style = TYPE_STYLES[n.type] ?? DEFAULT_TYPE_STYLE;
                return (
                  <li
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      "flex cursor-pointer gap-3 border-l-4 px-4 py-3 transition hover:bg-muted/50",
                      !n.is_read ? `${style.accent} ${style.unreadBg}` : "border-l-transparent",
                    )}
                  >
                    <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md", !n.is_read ? style.iconUnread : style.icon)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("truncate text-sm", !n.is_read ? "font-semibold" : "font-medium")}>{n.title}</p>
                        {!n.is_read && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markRead.mutate(n.id); }}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Als gelesen markieren"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {n.message && <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: de })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="flex items-center gap-2 border-t p-2">
          {unreadCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 justify-center gap-1.5 text-xs font-medium"
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Alle gelesen
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-center gap-1.5 text-xs font-medium text-primary hover:text-primary"
            onClick={() => {
              setOpen(false);
              navigate({ to: "/notifications" as never });
            }}
          >
            Alle ansehen
          </Button>
        </div>
      </PopoverContent>
    </Popover>

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Benachrichtigungseinstellungen</DialogTitle>
        </DialogHeader>
        <NotificationPreferencesForm />
      </DialogContent>
    </Dialog>
    </>
  );
}

