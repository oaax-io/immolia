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
  Smile,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

export type OpenChatOptions = { call?: boolean; callId?: string; room?: string; minimized?: boolean };
type DockCtx = {
  openChat: (memberId: string, opts?: OpenChatOptions) => void;
  /** Neue Nachricht: Chat als schwebende Blase anzeigen (ohne ihn zu öffnen). */
  notifyChat: (memberId: string) => void;
  /** Schliesst das offene Einzel-Chatfenster und liefert dessen Person (für das grosse Postfach). */
  takeOpenChat: () => string | null;
};
const Ctx = createContext<DockCtx>({ openChat: () => {}, notifyChat: () => {}, takeOpenChat: () => null });
export const useChatDock = () => useContext(Ctx);

type ChatMode = "normal" | "minimized" | "maximized";
type DockChat = { id: string; mode: ChatMode; autoCall: { callId?: string; room?: string; key: number } | null; unread: number };

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
  const [chats, setChats] = useState<DockChat[]>([]);

  const openChat = useCallback((memberId: string, opts?: OpenChatOptions) => {
    setChats((prev) => {
      const autoCall = opts?.call ? { callId: opts.callId, room: opts.room, key: Date.now() } : null;
      const targetMode: ChatMode = opts?.minimized ? "minimized" : "normal";
      const others = prev.map((c) =>
        c.id !== memberId && !opts?.minimized && c.mode !== "minimized" ? { ...c, mode: "minimized" as ChatMode } : c,
      );
      const existing = others.find((c) => c.id === memberId);
      if (existing) {
        return others.map((c) =>
          c.id === memberId
            ? { ...c, mode: targetMode, autoCall: autoCall ?? c.autoCall, unread: targetMode === "minimized" ? c.unread : 0 }
            : c,
        );
      }
      return [...others, { id: memberId, mode: targetMode, autoCall, unread: 0 }];
    });
  }, []);

  const notifyChat = useCallback((memberId: string) => {
    setChats((prev) => {
      const existing = prev.find((c) => c.id === memberId);
      if (existing) {
        if (existing.mode !== "minimized") return prev;
        return prev.map((c) => (c.id === memberId ? { ...c, unread: c.unread + 1 } : c));
      }
      return [...prev, { id: memberId, mode: "minimized", autoCall: null, unread: 1 }];
    });
  }, []);

  const setMode = useCallback((id: string, mode: ChatMode) => {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id === id) return { ...c, mode, unread: mode === "minimized" ? c.unread : 0 };
        if (mode !== "minimized" && c.mode !== "minimized") return { ...c, mode: "minimized" };
        return c;
      }),
    );
  }, []);

  const closeChat = useCallback((id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const takeOpenChat = useCallback(() => {
    const open = chatsRef.current.find((c) => c.mode !== "minimized");
    if (!open) return null;
    setChats((prev) => prev.filter((c) => c.id !== open.id));
    return open.id;
  }, []);

  const bubbles = chats.filter((c) => c.mode === "minimized");
  const hasOpenWindow = chats.some((c) => c.mode !== "minimized");

  // Toasts oberhalb von Chatfenster / Chat-Kreisen platzieren.
  useEffect(() => {
    const root = document.documentElement;
    let offset = "24px";
    if (hasOpenWindow) offset = "calc(min(560px, 85dvh) + 32px)";
    else if (bubbles.length > 0) offset = `${24 + bubbles.length * 68}px`;
    root.style.setProperty("--chat-toast-offset", offset);
    return () => { root.style.removeProperty("--chat-toast-offset"); };
  }, [hasOpenWindow, bubbles.length]);

  return (
    <Ctx.Provider value={{ openChat, notifyChat, takeOpenChat }}>
      {children}
      <IncomingCallListener
        onAccept={(callerId, callId, room) => openChat(callerId, { call: true, callId, room })}
      />

      {chats.map((c) => (
        <ChatWindow
          key={c.id}
          memberId={c.id}
          mode={c.mode}
          shifted={bubbles.length > 0}
          setMode={(m) => setMode(c.id, m)}
          autoCall={c.autoCall}
          onClose={() => closeChat(c.id)}
        />
      ))}

      {bubbles.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse items-center gap-3">
          {bubbles.map((c) => (
            <ChatBubble
              key={c.id}
              memberId={c.id}
              unread={c.unread}
              onOpen={() => openChat(c.id)}
              onClose={() => closeChat(c.id)}
            />
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

function ChatBubble({
  memberId,
  unread,
  onOpen,
  onClose,
}: {
  memberId: string;
  unread: number;
  onOpen: () => void;
  onClose: () => void;
}) {
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
  const name = member?.full_name ?? member?.email ?? "Chat";
  return (
    <div className="group relative animate-in fade-in zoom-in-75">
      <button
        type="button"
        onClick={onOpen}
        title={`Chat mit ${name} öffnen`}
        aria-label={`Chat mit ${name} öffnen`}
        className={cn(
          "block rounded-full shadow-xl ring-2 ring-background transition-transform hover:scale-105 focus:outline-none focus-visible:ring-primary",
          unread > 0 && "ring-primary",
        )}
      >
        <Avatar className="h-14 w-14">
          <AvatarImage src={member?.avatar_url ?? undefined} />
          <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
            {initials(member?.full_name, member?.email)}
          </AvatarFallback>
        </Avatar>
      </button>
      <PresenceDot status={member?.presence_status} updatedAt={member?.presence_updated_at} className="absolute bottom-0.5 right-0.5" />
      {unread > 0 && (
        <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        title="Chat schliessen"
        aria-label={`Chat mit ${name} schliessen`}
        className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow group-hover:flex focus-visible:flex"
      >
        <X className="h-3 w-3" />
      </button>
      <span className="pointer-events-none absolute right-full top-1/2 mr-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow group-hover:block">
        {name}
      </span>
    </div>
  );
}



export function AttachmentView({ att }: { att: ChatAttachment }) {
  const [zoom, setZoom] = useState(false);
  const { data, isError, isLoading } = useQuery({
    queryKey: ["chat-att-url", att.path],
    staleTime: 1000 * 60 * 30,
    retry: 1,
    queryFn: async (): Promise<{ url: string; preview: string | null }> => {
      if (isImage(att)) {
        const { data, error } = await supabase.storage.from("chat-attachments").download(att.path);
        if (error || !data) throw error ?? new Error("download failed");
        const url = URL.createObjectURL(data);
        return { url, preview: await makePreview(data) };
      }
      const { data, error } = await supabase.storage.from("chat-attachments").createSignedUrl(att.path, 3600);
      if (error || !data?.signedUrl) throw error ?? new Error("sign failed");
      return { url: data.signedUrl, preview: null };
    },
  });
  const url = data?.url ?? null;
  if (isImage(att)) {
    const preview = data?.preview ?? null;
    return (
      <>
        <button type="button" onClick={() => data && setZoom(true)} className="block cursor-zoom-in" title="Vergrössern">
          {isLoading ? (
            <div className="flex h-24 w-32 items-center justify-center rounded-md border">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : preview ? (
            <img src={preview} alt={att.name} className="max-h-48 rounded-md border object-cover" />
          ) : (
            <div className="flex w-40 flex-col items-center justify-center gap-1 rounded-md border bg-background p-3 text-center text-[10px] text-muted-foreground">
              <Images className="h-5 w-5" />
              <span className="max-w-full truncate text-foreground">{att.name}</span>
              <span>{isError ? "Bild nicht verfügbar" : "Keine Vorschau möglich"}</span>
            </div>
          )}
        </button>
        <ImageLightbox open={zoom} onOpenChange={setZoom} name={att.name} preview={preview} downloadUrl={url} />
      </>
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

/** Erstellt eine anzeigbare Vorschau (max. 2560 px). Auch extrem grosse Bilder werden beim Dekodieren verkleinert. */
async function makePreview(blob: Blob): Promise<string | null> {
  if (blob.type === "image/svg+xml" || blob.type === "image/gif") return URL.createObjectURL(blob);
  try {
    const probe = await createImageBitmap(blob, { resizeWidth: 2560, resizeQuality: "high" }).catch(() => null);
    if (!probe) return null;
    const ratio = probe.height / probe.width; // Seitenverhältnis bleibt durch resizeWidth erhalten
    let bmp = probe;
    if (ratio > 1) {
      probe.close();
      bmp = await createImageBitmap(blob, { resizeHeight: 2560, resizeQuality: "high" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, blob.type === "image/png" ? "image/png" : "image/jpeg", 0.9));
    return out ? URL.createObjectURL(out) : null;
  } catch {
    return null;
  }
}

function ImageLightbox({ open, onOpenChange, name, preview, downloadUrl }: {
  open: boolean; onOpenChange: (o: boolean) => void; name: string; preview: string | null; downloadUrl: string | null;
}) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => { if (open) { setScale(1); setPos({ x: 0, y: 0 }); } }, [open]);
  const zoomTo = (v: number) => {
    const n = Math.min(6, Math.max(1, Math.round(v * 100) / 100));
    setScale(n);
    if (n === 1) setPos({ x: 0, y: 0 });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] max-w-[min(1200px,95vw)] flex-col gap-2 p-3">
        <DialogTitle className="truncate pr-8 text-sm">{name}</DialogTitle>
        <div
          className="relative flex-1 overflow-hidden rounded-md bg-muted/40"
          onWheel={(e) => preview && zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
          onPointerDown={(e) => {
            if (scale === 1) return;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setPos({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
          }}
          onPointerUp={() => { drag.current = null; }}
          onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
        >
          {preview ? (
            <img
              src={preview}
              alt={name}
              draggable={false}
              className={cn("absolute inset-0 m-auto max-h-full max-w-full select-none object-contain", scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
              style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: drag.current ? "none" : "transform 120ms ease-out" }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Images className="h-8 w-8" />
              Für dieses Bild ist keine Vorschau möglich (Datei zu gross). Du kannst es herunterladen.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" title="Verkleinern" disabled={!preview || scale <= 1} onClick={() => zoomTo(scale / 1.25)}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
          <Button variant="outline" size="icon" className="h-8 w-8" title="Vergrössern" disabled={!preview || scale >= 6} onClick={() => zoomTo(scale * 1.25)}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8" disabled={!preview || scale === 1} onClick={() => zoomTo(1)}>
            Einpassen
          </Button>
          {downloadUrl && (
            <Button asChild size="sm" className="ml-auto h-8 gap-1">
              <a href={downloadUrl} download={name}><Download className="h-4 w-4" /> Herunterladen</a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Verkleinert grosse Fotos vor dem Hochladen (max. 2560 px Kantenlänge). Bei Fehlern bleibt das Original. */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const bmp = await createImageBitmap(file);
    const MAX = 2560;
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 2 * 1024 * 1024) { bmp.close(); return file; }
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name, { type });
  } catch {
    return file;
  }
}

const EMOJIS = "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 🤔 🤨 😐 😴 😮 😲 😢 😭 😤 😡 🤯 😱 🙄 🤗 🤝 👍 👎 👏 🙌 🙏 💪 👋 ✌️ 👌 ☝️ ❤️ 🧡 💛 💚 💙 💜 🔥 ⭐ ✨ 🎉 🎂 ✅ ❌ ⚠️ ❓ 💡 📌 📎 📅 ⏰ 📞 📧 💬 🏠 🏡 🏢 🔑 📄 ✍️ 💰 💶 📈 🚗 ☕ 🍾".split(" ");

export function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Emoji">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="z-[60] w-72 p-2">
        <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => onPick(e)} className="rounded p-1 text-lg leading-none hover:bg-muted">
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
      .channel(`chat-dock-${memberId}-${crypto.randomUUID()}`)
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
      for (const original of Array.from(files)) {
        const file = await shrinkImage(original);
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
              <ScrollArea
                className="min-h-0 flex-1"
                style={{
                  backgroundImage: `url(${chatBg})`,
                  backgroundSize: "420px",
                  backgroundRepeat: "repeat",
                }}
              >
                <div className="space-y-2 p-3">
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
                  <EmojiPicker
                    onPick={(e) => {
                      const ta = taRef.current;
                      const start = ta?.selectionStart ?? draft.length;
                      const end = ta?.selectionEnd ?? draft.length;
                      onDraftChange(draft.slice(0, start) + e + draft.slice(end));
                      setTimeout(() => {
                        ta?.focus();
                        ta?.setSelectionRange(start + e.length, start + e.length);
                      }, 0);
                    }}
                  />
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
  shifted,
}: {
  memberId: string;
  mode: "normal" | "minimized" | "maximized";
  setMode: (m: "normal" | "minimized" | "maximized") => void;
  onClose: () => void;
  autoCall?: { callId?: string; room?: string; key: number } | null;
  shifted?: boolean;
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

  const side = shifted ? "right-4 sm:right-24" : "right-4";
  const shell =
    mode === "maximized"
      ? "inset-4 md:inset-10"
      : mode === "minimized"
        ? "hidden"
        : callOpen
          ? `bottom-4 ${side} w-[min(380px,calc(100vw-2rem))] h-[560px] max-h-[85dvh] md:w-[860px]`
          : `bottom-4 ${side} w-[min(380px,calc(100vw-2rem))] h-[540px] max-h-[80dvh]`;

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
          title="Minimieren"
          onClick={() => setMode("minimized")}
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
