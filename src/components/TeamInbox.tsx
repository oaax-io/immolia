import { useTenantConfig } from "@/lib/tenant-config";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Search, Maximize2, Paperclip, Pin, PinOff, Video, Minus, Plus } from "lucide-react";
import { GroupAvatar, GroupChatPanel, NewGroupDialog, OPEN_GROUP_EVENT, useChatGroups } from "@/components/chat/GroupChat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel, useChatDock } from "@/components/chat/ChatDock";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Member = { id: string; full_name: string | null; email: string | null; avatar_url: string | null; presence_status?: string | null; presence_updated_at?: string | null };
type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  attachments?: { path: string; name: string; type: string; size: number }[] | null;
};

function initialsOf(m?: Member | null) {
  const src = m?.full_name || m?.email || "?";
  return src.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }) +
        " " +
        d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

export function TeamInbox() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { openChat, notifyChat, takeOpenChat } = useChatDock();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [inlineId, setInlineId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  const agencyId = useTenantConfig().data?.agency_id ?? null;
  const { data: members = [] } = useQuery({
    queryKey: ["inbox-members", agencyId],
    enabled: !!user?.id && !!agencyId,
    queryFn: async () => {
      // nur Mitglieder der aktiven Firma
      const { data: mem, error: mErr } = await supabase
        .from("agency_memberships").select("user_id").eq("agency_id", agencyId!).eq("is_active", true);
      if (mErr) throw mErr;
      const ids = (mem ?? []).map((m) => m.user_id);
      if (!ids.length) return [] as Member[];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, presence_status, presence_updated_at")
        .in("id", ids)
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []).filter((m) => m.id !== user!.id) as Member[];
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["direct-messages", user?.id, agencyId],
    enabled: !!user?.id && !!agencyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("direct_messages")
        .select("*")
        .or(`sender_id.eq.${user!.id},recipient_id.eq.${user!.id}`)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as Message[];
    },
  });

  const { data: pins = [] } = useQuery({
    queryKey: ["chat-pins", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_pins")
        .select("member_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.member_id as string);
    },
  });

  const togglePin = useMutation({
    mutationFn: async (memberId: string) => {
      if (pins.includes(memberId)) {
        const { error } = await supabase
          .from("chat_pins")
          .delete()
          .eq("user_id", user!.id)
          .eq("member_id", memberId);
        if (error) throw error;
        return false;
      }
      const { error } = await supabase
        .from("chat_pins")
        .insert({ user_id: user!.id, member_id: memberId });
      if (error) throw error;
      return true;
    },
    onSuccess: (pinned) => {
      qc.invalidateQueries({ queryKey: ["chat-pins", user?.id] });
      toast.success(pinned ? "Chat angepinnt" : "Pin entfernt");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Realtime
  useEffect(() => {
    if (!user?.id || !agencyId) return;
    // Kanal pro Firma + Benutzer, serverseitig auf agency_id gefiltert; RLS bleibt die Sicherheitsgrenze.
    const channel = supabase
      .channel(`direct-messages:${agencyId}:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "direct_messages", filter: `agency_id=eq.${agencyId}` },
        (payload) => {
          const row = payload.new as (Message & { agency_id?: string | null }) | undefined;
          if (row && row.agency_id && row.agency_id !== agencyId) return;
          qc.invalidateQueries({ queryKey: ["direct-messages", user.id, agencyId] });
          if (payload.eventType === "INSERT" && row?.recipient_id === user.id) {
            notifyChat(row.sender_id);
            const from = members.find((m) => m.id === row.sender_id);
            toast.message(`Neue Nachricht von ${from?.full_name ?? "Kollege"}`, {
              description: row.body.slice(0, 80),
              action: {
                label: "Öffnen",
                onClick: () => openChat(row.sender_id),
              },
            });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, agencyId, members, qc, openChat, notifyChat]);

  const { data: groups = [] } = useChatGroups(agencyId);
  const groupUnread = groups.reduce((n, g) => n + g.unread, 0);
  const unreadTotal = useMemo(
    () => messages.filter((m) => m.recipient_id === user?.id && !m.read_at).length + groupUnread,
    [messages, user?.id, groupUnread],
  );

  // Gruppen-/Projekt-Chat von aussen öffnen (z. B. Immobilien-Ansicht)
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      setOpen(false);
      setInlineId(`g:${id}`);
      setExpanded(true);
    };
    window.addEventListener(OPEN_GROUP_EVENT, h);
    return () => window.removeEventListener(OPEN_GROUP_EVENT, h);
  }, [qc]);

  const filteredGroups = groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()));
  const activeGroup = inlineId?.startsWith("g:") ? groups.find((g) => g.id === inlineId.slice(2)) ?? null : null;

  const threads = useMemo(() => {
    const map = new Map<string, { last: Message; unread: number }>();
    for (const m of messages) {
      const other = m.sender_id === user?.id ? m.recipient_id : m.sender_id;
      const entry = map.get(other) ?? { last: m, unread: 0 };
      entry.last = m;
      if (m.recipient_id === user?.id && !m.read_at) entry.unread += 1;
      map.set(other, entry);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ member: members.find((m) => m.id === id), ...v, id }))
      .map((t) => ({ ...t, pinned: pins.includes(t.id) }))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.last.created_at < b.last.created_at ? 1 : -1;
      });
  }, [messages, members, user?.id, pins]);

  const filteredMembers = members.filter((m) =>
    (m.full_name || m.email || "").toLowerCase().includes(search.toLowerCase()),
  );

  const selectDock = (id: string) => {
    if (id.startsWith("g:")) {
      setInlineId(id);
      setOpen(false);
      setExpanded(true);
      return;
    }
    openChat(id);
    setOpen(false);
    setExpanded(false);
  };

  const selectInline = (id: string) => {
    setInlineId(id);
  };

  const ThreadList = ({ dense, onSelect }: { dense?: boolean; onSelect: (id: string) => void }) => (
    <div className="p-2">
      <div className="mb-2">
        <div className="flex items-center justify-between px-2 py-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gruppen & Projekte</p>
          <button type="button" onClick={() => setNewGroupOpen(true)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-muted">
            <Plus className="h-3 w-3" /> Neue Gruppe
          </button>
        </div>
        {filteredGroups.length === 0 && (
          <p className="px-2 pb-1 text-[11px] text-muted-foreground">Noch keine Gruppen. Projekt-Chats startest du in der Immobilie.</p>
        )}
        {filteredGroups.map((g) => (
          <button
            key={g.id}
            onClick={() => onSelect(`g:${g.id}`)}
            className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-muted", inlineId === `g:${g.id}` && "bg-muted")}
          >
            <GroupAvatar group={g} className={dense ? "h-8 w-8" : undefined} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{g.name}</span>
                {g.last_message_at && <span className="shrink-0 text-[10px] text-muted-foreground">{timeLabel(g.last_message_at)}</span>}
              </div>
              <p className={cn("truncate text-xs", g.unread ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {g.kind === "property" ? "Projekt · " : ""}
                {g.lastBody ? `${g.lastSender === user?.id ? "Du: " : ""}${g.lastBody || "Anhang"}` : "Keine Nachrichten"}
              </p>
            </div>
            {g.unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{g.unread}</span>
            )}
          </button>
        ))}
      </div>
      {!search && threads.length > 0 && (
        <div className="mb-2">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Unterhaltungen
          </p>
          {threads.map((t) => (
            <div key={t.id} className="group relative">
            <button
              onClick={() => onSelect(t.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-2 pr-9 text-left transition hover:bg-muted",
                t.pinned && "bg-primary/5",
                inlineId === t.id && "bg-muted",
              )}
            >
              <span className="relative">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={t.member?.avatar_url ?? undefined} />
                  <AvatarFallback className="text-xs">{initialsOf(t.member)}</AvatarFallback>
                </Avatar>
                <PresenceDot status={t.member?.presence_status} updatedAt={t.member?.presence_updated_at} className="absolute -bottom-0.5 -right-0.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {t.member?.full_name ?? t.member?.email ?? "Unbekannt"}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {timeLabel(t.last.created_at)}
                  </span>
                </div>
                <p
                  className={cn(
                    "flex items-center gap-1 truncate text-xs",
                    t.unread ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {(t.last.attachments ?? []).length > 0 && <Paperclip className="h-3 w-3 shrink-0" />}
                  {t.last.sender_id === user?.id ? "Du: " : ""}
                  {t.last.body}
                </p>
              </div>
              {t.unread > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {t.unread}
                </span>
              )}
            </button>
            <button
              type="button"
              title={t.pinned ? "Pin entfernen" : "Chat anpinnen"}
              onClick={(e) => {
                e.stopPropagation();
                togglePin.mutate(t.id);
              }}
              className={cn(
                "absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground",
                t.pinned ? "text-primary opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              {t.pinned ? <Pin className="h-3.5 w-3.5 fill-current" /> : <PinOff className="h-3.5 w-3.5" />}
            </button>
            </div>
          ))}
        </div>
      )}
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Mitarbeitende
      </p>
      {filteredMembers.length === 0 && (
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">Keine Mitarbeitenden gefunden</p>
      )}
      {filteredMembers.map((m) => (
        <button
          key={m.id}
          onClick={() => onSelect(m.id)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-muted"
        >
          <span className="relative">
            <Avatar className={dense ? "h-8 w-8" : "h-9 w-9"}>
              <AvatarImage src={m.avatar_url ?? undefined} />
              <AvatarFallback className="text-xs">{initialsOf(m)}</AvatarFallback>
            </Avatar>
            <PresenceDot status={m.presence_status} updatedAt={m.presence_updated_at} className="absolute -bottom-0.5 -right-0.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm">{m.full_name ?? m.email}</p>
            {m.full_name && m.email && (
              <p className="truncate text-[11px] text-muted-foreground">{m.email}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );

  const SearchBox = (
    <div className="relative">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Personen oder Gruppen suchen…"
        className="pl-8"
      />
    </div>
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" title="Postfach">
            <Inbox className="h-5 w-5" />
            {unreadTotal > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {unreadTotal > 9 ? "9+" : unreadTotal}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] p-0">
          <div className="flex h-[460px] flex-col">
            <div className="border-b p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Postfach</span>
                <div className="flex items-center gap-1">
                  {unreadTotal > 0 && <Badge variant="secondary">{unreadTotal} neu</Badge>}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Vergrössern"
                    onClick={() => {
                      const docked = takeOpenChat();
                      setInlineId((cur) => docked ?? cur ?? threads[0]?.id ?? null);
                      setOpen(false);
                      setExpanded(true);
                    }}
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {SearchBox}
            </div>
            <ScrollArea className="flex-1">
              <ThreadList dense onSelect={selectDock} />
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog
        open={expanded}
        onOpenChange={(o) => {
          setExpanded(o);
          if (!o) setInlineId(null);
        }}
      >
        <DialogContent className="flex h-[85dvh] w-[min(1100px,95vw)] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 md:flex-row">
          <div className="flex min-h-0 w-full flex-col border-b md:w-[320px] md:shrink-0 md:border-b-0 md:border-r">
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Inbox className="h-4 w-4" /> Postfach
              </DialogTitle>
              {unreadTotal > 0 && <Badge variant="secondary">{unreadTotal} neu</Badge>}
            </div>
            <div className="shrink-0 border-b p-3">{SearchBox}</div>
            <ScrollArea className="min-h-0 flex-1">
              <ThreadList onSelect={selectInline} />
            </ScrollArea>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {inlineId?.startsWith("g:") ? (
              activeGroup ? (
                <div className="flex min-h-0 flex-1 flex-col pr-10 md:pr-0">
                  <GroupChatPanel key={activeGroup.id} group={activeGroup} allMembers={members} onLeft={() => setInlineId(null)} />
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Lädt…</div>
              )
            ) : inlineId ? (
              <>
                <div className="flex shrink-0 items-center justify-end gap-2 border-b px-3 py-2 pr-12">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      const id = inlineId;
                      setExpanded(false);
                      setInlineId(null);
                      openChat(id, { call: true });
                    }}
                  >
                    <Video className="h-4 w-4" /> Videoanruf
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    title="Chat unten rechts minimieren"
                    onClick={() => {
                      const id = inlineId;
                      setExpanded(false);
                      setInlineId(null);
                      openChat(id, { minimized: true });
                    }}
                  >
                    <Minus className="h-4 w-4" /> Minimieren
                  </Button>
                </div>
                <ChatPanel key={inlineId} memberId={inlineId} />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                <Inbox className="h-8 w-8 opacity-50" />
                <p className="text-sm">Wähle links eine Unterhaltung aus</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        members={members}
        onCreated={(id) => {
          setOpen(false);
          setInlineId(`g:${id}`);
          setExpanded(true);
        }}
      />
    </>
  );
}
