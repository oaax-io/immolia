import { tenantStoragePath } from "@/lib/tenant-storage";
import chatBg from "@/assets/chat-bg.jpg";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Send,
  Paperclip,
  X,
  Minus,
  Maximize2,
  Minimize2,
  MessageSquare,
  Images,
  AtSign,
  FileText,
  Download,
  Loader2,
  Home,
  User as UserIcon,
  Users,
  Video,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PresenceDot, PresenceLabel } from "@/components/presence/PresenceDot";
import { useLivekitToken } from "@/components/video/useLivekitToken";
import { VideoStage } from "@/components/video/VideoStage";
import { PhoneOff } from "lucide-react";
import { IncomingCallListener } from "@/components/video/IncomingCallListener";
import { AddCallParticipant } from "@/components/video/AddCallParticipant";
import { CALL_RING_MS, chatRoomName, setCallStatus, startCall, type CallRow } from "@/lib/calls";


export type ChatAttachment = {
  path: string;
  name: string;
  type: string;
  size: number;
};
export type ChatMention = {
  type: "member" | "client" | "property";
  id: string;
  label: string;
};
type Msg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  attachments: ChatAttachment[] | null;
  mentions: ChatMention[] | null;
};
type Member = { id: string; full_name: string | null; email: string | null; avatar_url: string | null; presence_status?: string | null; presence_updated_at?: string | null };

export type OpenChatOptions = { call?: boolean; callId?: string; room?: string };
type DockCtx = { openChat: (memberId: string, opts?: OpenChatOptions) => void };
const Ctx = createContext<DockCtx>({ openChat: () => {} });
export const useChatDock = () => useContext(Ctx);


function initials(name?: string | null, fallback?: string | null) {
  const src = name || fallback || "?";
  return src.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
}
function timeLabel(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }) +
        " " +
        d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}
const isImage = (a: ChatAttachment) => (a.type || "").startsWith("image/");

export function ChatDockProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<"normal" | "minimized" | "maximized">("normal");
  const [autoCall, setAutoCall] = useState<{ callId?: string; room?: string; key: number } | null>(null);

  const openChat = useCallback((memberId: string, opts?: OpenChatOptions) => {
    setActiveId(memberId);
    setMode("normal");
    setAutoCall(opts?.call ? { callId: opts.callId, room: opts.room, key: Date.now() } : null);
  }, []);

  return (
    <Ctx.Provider value={{ openChat }}>
      {children}
      <IncomingCallListener
        onAccept={(callerId, callId, room) => openChat(callerId, { call: true, callId, room })}
      />

      {activeId && (
        <ChatWindow
          key={activeId}
          memberId={activeId}
          mode={mode}
          setMode={setMode}
          autoCall={autoCall}
          onClose={() => {
            setActiveId(null);
            setAutoCall(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}


function AttachmentView({ att }: { att: ChatAttachment }) {
  const { data: url } = useQuery({
    queryKey: ["chat-att-url", att.path],
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data } = await supabase.storage.from("chat-attachments").createSignedUrl(att.path, 3600);
      return data?.signedUrl ?? null;
    },
  });
  if (isImage(att)) {
    return (
      <a href={url ?? "#"} target="_blank" rel="noreferrer" className="block">
        {url ? (
          <img src={url} alt={att.name} className="max-h-48 rounded-md border object-cover" />
        ) : (
          <div className="flex h-24 w-32 items-center justify-center rounded-md border">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </a>
    );
  }
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs text-foreground hover:bg-muted"
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="max-w-[160px] truncate">{att.name}</span>
      <Download className="h-3.5 w-3.5 opacity-60" />
    </a>
  );
}

export function ChatPanel({
  memberId,
  paused = false,
}: {
  memberId: string;
  paused?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"chat" | "media">("chat");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { data: member } = useQuery({
    queryKey: ["chat-member", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, presence_status, presence_updated_at")
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data as Member | null;
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["chat-thread", user?.id, memberId],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("direct_messages")
        .select("*")
        .or(
          `and(sender_id.eq.${user!.id},recipient_id.eq.${memberId}),and(sender_id.eq.${memberId},recipient_id.eq.${user!.id})`,
        )
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Msg[];
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`chat-dock-${memberId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "direct_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-thread", user.id, memberId] });
        qc.invalidateQueries({ queryKey: ["direct-messages", user.id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, memberId, qc]);

  // Mark read
  useEffect(() => {
    if (paused || !user?.id) return;
    const ids = messages.filter((m) => m.sender_id === memberId && !m.read_at).map((m) => m.id);
    if (!ids.length) return;
    supabase
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["direct-messages", user.id] });
        qc.invalidateQueries({ queryKey: ["chat-thread", user.id, memberId] });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, paused, memberId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, tab]);

  // Mention suggestions
  const { data: suggestions = [] } = useQuery({
    queryKey: ["mention-suggestions", mentionQuery],
    enabled: mentionOpen,
    queryFn: async () => {
      const q = mentionQuery.trim();
      const like = `%${q}%`;
      const [people, clients, props] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").eq("is_active", true).limit(5),
        q
          ? supabase.from("clients").select("id, full_name").ilike("full_name", like).limit(5)
          : supabase.from("clients").select("id, full_name").order("created_at", { ascending: false }).limit(5),
        q
          ? supabase.from("properties").select("id, title, city").ilike("title", like).limit(5)
          : supabase.from("properties").select("id, title, city").order("created_at", { ascending: false }).limit(5),
      ]);
      const out: ChatMention[] = [];
      for (const p of people.data ?? []) {
        const label = p.full_name || p.email || "Unbekannt";
        if (!q || label.toLowerCase().includes(q.toLowerCase()))
          out.push({ type: "member", id: p.id, label });
      }
      for (const c of clients.data ?? []) out.push({ type: "client", id: c.id, label: c.full_name });
      for (const p of props.data ?? [])
        out.push({ type: "property", id: p.id, label: p.title ?? p.city ?? "Objekt" });
      return out;
    },
  });

  const onDraftChange = (v: string) => {
    setDraft(v);
    const caret = taRef.current?.selectionStart ?? v.length;
    const upto = v.slice(0, caret);
    const m = /@([\p{L}\d\s'-]{0,30})$/u.exec(upto);
    if (m) {
      setMentionQuery(m[1] ?? "");
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (mn: ChatMention) => {
    const caret = taRef.current?.selectionStart ?? draft.length;
    const upto = draft.slice(0, caret);
    const rest = draft.slice(caret);
    const replaced = upto.replace(/@([\p{L}\d\s'-]{0,30})$/u, `@${mn.label} `);
    setDraft(replaced + rest);
    setMentions((prev) => (prev.some((p) => p.id === mn.id && p.type === mn.type) ? prev : [...prev, mn]));
    setMentionOpen(false);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !user?.id) return;
    setUploading(true);
    try {
      const uploaded: ChatAttachment[] = [];
      for (const file of Array.from(files)) {
        const path = await tenantStoragePath(`${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`);
        const { error } = await supabase.storage.from("chat-attachments").upload(path, file);
        if (error) throw error;
        uploaded.push({ path, name: file.name, type: file.type, size: file.size });
      }
      setPending((p) => [...p, ...uploaded]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const send = useMutation({
    mutationFn: async () => {
      const body = draft.trim();
      if (!body && pending.length === 0) return;
      const used = mentions.filter((mn) => body.includes(`@${mn.label}`));
      const { error } = await supabase.from("direct_messages").insert({
        sender_id: user!.id,
        recipient_id: memberId,
        body: body || (pending.length === 1 ? pending[0].name : `${pending.length} Anhänge`),
        attachments: pending as unknown as never,
        mentions: used as unknown as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      setPending([]);
      setMentions([]);
      qc.invalidateQueries({ queryKey: ["chat-thread", user?.id, memberId] });
      qc.invalidateQueries({ queryKey: ["direct-messages", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const media = useMemo(
    () =>
      messages.flatMap((m) =>
        (m.attachments ?? []).map((a) => ({ att: a, at: m.created_at, mine: m.sender_id === user?.id })),
      ),
    [messages, user?.id],
  );

  const title = member?.full_name ?? member?.email ?? "Chat";




  return (
    <div className="flex min-h-0 flex-1 flex-col">
          {/* Tabs */}
          <div className="flex shrink-0 gap-4 border-b px-3">
            {(
              [
                { k: "chat", label: "Chat", icon: MessageSquare, count: messages.length },
                { k: "media", label: "Medien", icon: Images, count: media.length },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-1 py-2 text-xs font-medium transition",
                  tab === t.k
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                {t.count > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {t.count}
                  </Badge>
                )}
              </button>
            ))}
          </div>

          {tab === "chat" ? (
            <>
              <ScrollArea className="min-h-0 flex-1">
                <div
                  className="space-y-2 p-3"
                  style={{
                    backgroundImage: `url(${chatBg})`,
                    backgroundSize: "420px",
                    backgroundRepeat: "repeat",
                  }}
                >
                  {messages.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Noch keine Nachrichten — schreib die erste!
                    </p>
                  )}
                  {messages.map((m) => {
                    const mine = m.sender_id === user?.id;
                    return (
                      <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[80%] space-y-2 rounded-lg px-3 py-2 text-sm",
                            mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                          )}
                        >
                          {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                          {(m.attachments ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {(m.attachments ?? []).map((a) => (
                                <AttachmentView key={a.path} att={a} />
                              ))}
                            </div>
                          )}
                          {(m.mentions ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(m.mentions ?? []).map((mn) => (
                                <Badge
                                  key={`${mn.type}-${mn.id}`}
                                  variant="secondary"
                                  className="gap-1 text-[10px]"
                                >
                                  {mn.type === "property" ? (
                                    <Home className="h-3 w-3" />
                                  ) : mn.type === "client" ? (
                                    <UserIcon className="h-3 w-3" />
                                  ) : (
                                    <Users className="h-3 w-3" />
                                  )}
                                  {mn.label}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <p
                            className={cn(
                              "text-[10px]",
                              mine ? "text-primary-foreground/70" : "text-muted-foreground",
                            )}
                          >
                            {timeLabel(m.created_at)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              {/* Composer */}
              <div className="relative shrink-0 space-y-2 border-t p-2">
                {mentionOpen && suggestions.length > 0 && (
                  <div className="absolute bottom-full left-2 right-2 mb-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
                    {suggestions.map((s) => (
                      <button
                        key={`${s.type}-${s.id}`}
                        onClick={() => insertMention(s)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                      >
                        {s.type === "property" ? (
                          <Home className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : s.type === "client" ? (
                          <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <span className="truncate">{s.label}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {s.type === "property" ? "Immobilie" : s.type === "client" ? "Kunde" : "Team"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {pending.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {pending.map((a) => (
                      <Badge key={a.path} variant="secondary" className="gap-1 text-[10px]">
                        <Paperclip className="h-3 w-3" />
                        <span className="max-w-[120px] truncate">{a.name}</span>
                        <button onClick={() => setPending((p) => p.filter((x) => x.path !== a.path))}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <Textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMentionOpen(false);
                    if (e.key === "Enter" && !e.shiftKey && !mentionOpen) {
                      e.preventDefault();
                      send.mutate();
                    }
                  }}
                  placeholder="Nachricht schreiben…"
                  className="min-h-[40px] max-h-28 resize-none"
                />
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="Anhang"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title="Erwähnen"
                    onClick={() => {
                      setDraft((d) => d + "@");
                      setMentionQuery("");
                      setMentionOpen(true);
                      setTimeout(() => taRef.current?.focus(), 0);
                    }}
                  >
                    <AtSign className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    className="ml-auto gap-1.5"
                    onClick={() => send.mutate()}
                    disabled={(!draft.trim() && pending.length === 0) || send.isPending}
                  >
                    <Send className="h-4 w-4" />
                    Senden
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-3">
                {media.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Noch keine geteilten Medien in diesem Chat.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {media.map((m) => (
                      <div key={m.att.path} className="space-y-1 rounded-md border p-2">
                        <AttachmentView att={m.att} />
                        <p className="truncate text-[10px] text-muted-foreground">
                          {m.mine ? "Du" : title} · {timeLabel(m.at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
    </div>
  );
}

function ChatWindow({
  memberId,
  mode,
  setMode,
  onClose,
  autoCall,
}: {
  memberId: string;
  mode: "normal" | "minimized" | "maximized";
  setMode: (m: "normal" | "minimized" | "maximized") => void;
  onClose: () => void;
  autoCall?: { callId?: string; room?: string; key: number } | null;
}) {
  const { user } = useAuth();
  const { data: member } = useQuery({
    queryKey: ["chat-member", memberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, presence_status, presence_updated_at")
        .eq("id", memberId)
        .maybeSingle();
      if (error) throw error;
      return data as Member | null;
    },
  });
  const title = member?.full_name ?? member?.email ?? "Chat";
  const [callOpen, setCallOpen] = useState(false);
  const [calling, setCalling] = useState(false);
  const callIdRef = useRef<string | null>(null);
  const [roomOverride, setRoomOverride] = useState<string | null>(null);
  const callRoom = roomOverride ?? (user?.id ? chatRoomName(user.id, memberId) : `chat-${memberId}`);

  const callState = useLivekitToken(callRoom, callOpen);

  const endCall = useCallback(async () => {
    setCallOpen(false);
    setCalling(false);
    const id = callIdRef.current;
    callIdRef.current = null;
    if (id) await setCallStatus(id, "ended").catch(() => {});
  }, []);

  const beginCall = useCallback(async () => {
    if (!user?.id) return;
    setCallOpen(true);
    setCalling(true);
    try {
      const row = await startCall({
        room: callRoom,
        callerId: user.id,
        calleeId: memberId,
        title: member?.full_name ?? member?.email ?? null,
      });
      callIdRef.current = row?.id ?? null;
      toast.message(`${title} wird angerufen…`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [user?.id, callRoom, memberId, member?.full_name, member?.email, title]);

  // Anrufer-seitiger Klingel-Timeout: auch wenn die Gegenseite die App geschlossen hat,
  // klingelt ein Anruf nie länger als CALL_RING_MS. Danach verpasst + Video-Stage schliessen.
  useEffect(() => {
    if (!callOpen || !calling) return;
    const t = setTimeout(() => {
      const id = callIdRef.current;
      callIdRef.current = null;
      setCallOpen(false);
      setCalling(false);
      if (id) void setCallStatus(id, "missed").catch(() => {});
      toast.error(`${title} hat nicht geantwortet`);
    }, CALL_RING_MS);
    return () => clearTimeout(t);
  }, [callOpen, calling, title]);

  // Angenommener eingehender Anruf: direkt verbinden
  useEffect(() => {
    if (!autoCall) return;
    callIdRef.current = autoCall.callId ?? null;
    setRoomOverride(autoCall.room ?? null);
    setCallOpen(true);
    setCalling(false);
  }, [autoCall]);

  // Antwort der Gegenseite verfolgen (angenommen / abgelehnt / beendet)
  useEffect(() => {
    if (!callOpen) return;
    const ch = supabase
      .channel(`call-watch-${callRoom}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "video_calls" },
        (payload) => {
          const row = payload.new as CallRow;
          if (row.id !== callIdRef.current) return;
          if (row.status === "accepted") setCalling(false);
          if (row.status === "declined") {
            toast.error(`${title} hat den Anruf abgelehnt`);
            callIdRef.current = null;
            setCallOpen(false);
            setCalling(false);
          }
          if (row.status === "missed" || row.status === "ended") {
            if (row.status === "missed") toast.error(`${title} hat nicht geantwortet`);
            callIdRef.current = null;
            setCallOpen(false);
            setCalling(false);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [callOpen, callRoom, title]);

  const shell =
    mode === "maximized"
      ? "inset-4 md:inset-10"
      : mode === "minimized"
        ? "bottom-4 right-4 w-[300px]"
        : callOpen
          ? "bottom-4 right-4 w-[380px] h-[560px] max-h-[85dvh] md:w-[860px]"
          : "bottom-4 right-4 w-[380px] h-[540px] max-h-[80dvh]";

  return (
    <div className={cn("fixed z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl", shell)}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b bg-muted/60 px-3 py-2"
        onDoubleClick={() => setMode(mode === "minimized" ? "normal" : "minimized")}
      >
        <span className="relative">
          <Avatar className="h-7 w-7">
            <AvatarImage src={member?.avatar_url ?? undefined} />
            <AvatarFallback className="text-[10px]">{initials(member?.full_name, member?.email)}</AvatarFallback>
          </Avatar>
          <PresenceDot status={member?.presence_status} updatedAt={member?.presence_updated_at} className="absolute -bottom-0.5 -right-0.5" />
        </span>
        <span className="min-w-0 flex flex-1 flex-col overflow-hidden">
          <span className="truncate text-sm font-semibold leading-tight">{title}</span>
          <PresenceLabel status={member?.presence_status} updatedAt={member?.presence_updated_at} className="text-[10px]" />
        </span>
        {callOpen && user?.id && (
          <AddCallParticipant room={callRoom} callerId={user.id} exclude={[user.id, memberId]} title={title} />
        )}
        {callOpen && calling && (
          <span className="mr-1 animate-pulse text-[10px] font-medium text-primary">klingelt…</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={callOpen ? "Anruf beenden" : "Videoanruf starten"}
          onClick={() => {
            if (callOpen) void endCall();
            else void beginCall();
          }}
        >
          {callOpen ? <PhoneOff className="h-4 w-4 text-destructive" /> : <Video className="h-4 w-4" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={mode === "minimized" ? "Öffnen" : "Minimieren"}
          onClick={() => setMode(mode === "minimized" ? "normal" : "minimized")}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={mode === "maximized" ? "Verkleinern" : "Vergrössern"}
          onClick={() => setMode(mode === "maximized" ? "normal" : "maximized")}
        >
          {mode === "maximized" ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Schliessen" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col md:flex-row",
          mode === "minimized" && "hidden",
        )}
      >
        {callOpen && (
          <div className="relative min-h-[220px] flex-1 border-b bg-muted/40 md:min-h-0 md:border-b-0 md:border-r">
            <VideoStage state={callState} onLeave={() => void endCall()} />
          </div>
        )}
        <div
          className={cn(
            "flex min-h-0 flex-col",
            callOpen ? "flex-1 md:w-[360px] md:flex-none" : "min-h-0 flex-1",
          )}
        >
          <ChatPanel memberId={memberId} paused={mode === "minimized"} />
        </div>
      </div>
    </div>
  );
}
