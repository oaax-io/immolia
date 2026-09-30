import chatBg from "@/assets/chat-bg.jpg";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Paperclip, Send, Settings2, UserMinus, UserPlus, Users, X, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { tenantStoragePath } from "@/lib/tenant-storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AttachmentView, EmojiPicker, shrinkImage, type ChatAttachment } from "@/components/chat/ChatDock";

export type GroupMember = { id: string; full_name: string | null; email: string | null; avatar_url: string | null };
export type ChatGroup = {
  id: string;
  kind: "group" | "property";
  name: string;
  property_id: string | null;
  created_by: string;
  last_message_at: string | null;
  created_at: string;
  unread: number;
  lastBody: string | null;
  lastSender: string | null;
};
type GroupMessage = {
  id: string;
  group_id: string;
  sender_id: string;
  body: string;
  attachments: ChatAttachment[] | null;
  created_at: string;
};

/** Öffnet das grosse Postfach mit einem Gruppen-/Projekt-Chat (z. B. aus der Immobilien-Ansicht). */
export const OPEN_GROUP_EVENT = "immolia:open-group-chat";
export function openGroupChat(groupId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_GROUP_EVENT, { detail: groupId }));
}

/** Projekt-Chat einer Immobilie öffnen (legt ihn bei Bedarf an, Zuständige werden automatisch aufgenommen). */
export async function openPropertyChat(propertyId: string) {
  const { data, error } = await supabase.rpc("chat_property_open", { _property_id: propertyId });
  if (error || !data) {
    toast.error("Projekt-Chat konnte nicht geöffnet werden");
    return;
  }
  openGroupChat(data as string);
}

function initials(m?: GroupMember | null) {
  const s = m?.full_name || m?.email || "?";
  return s.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
}

export function useChatGroups(agencyId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["chat-groups", agencyId, user?.id],
    enabled: !!user?.id && !!agencyId,
    queryFn: async (): Promise<ChatGroup[]> => {
      const { data: groups, error } = await supabase
        .from("chat_groups")
        .select("id, kind, name, property_id, created_by, last_message_at, created_at")
        .eq("agency_id", agencyId!);
      if (error) throw error;
      if (!groups?.length) return [];
      const ids = groups.map((g) => g.id);
      const [{ data: mine }, { data: msgs }] = await Promise.all([
        supabase.from("chat_group_members").select("group_id, last_read_at").eq("user_id", user!.id).in("group_id", ids),
        supabase
          .from("chat_group_messages")
          .select("group_id, sender_id, body, created_at")
          .in("group_id", ids)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      const readMap = new Map((mine ?? []).map((m) => [m.group_id, m.last_read_at as string | null]));
      return groups
        .map((g) => {
          const gm = (msgs ?? []).filter((m) => m.group_id === g.id);
          const lr = readMap.get(g.id);
          const unread = gm.filter((m) => m.sender_id !== user!.id && (!lr || m.created_at > lr)).length;
          return {
            ...(g as Omit<ChatGroup, "unread" | "lastBody" | "lastSender">),
            unread,
            lastBody: gm[0]?.body ?? null,
            lastSender: gm[0]?.sender_id ?? null,
          };
        })
        .sort((a, b) => ((a.last_message_at ?? a.created_at) < (b.last_message_at ?? b.created_at) ? 1 : -1));
    },
  });

  useEffect(() => {
    if (!user?.id || !agencyId) return;
    const ch = supabase
      .channel(`chat-groups:${agencyId}:${user.id}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_group_messages" }, (payload) => {
        const row = payload.new as GroupMessage;
        qc.invalidateQueries({ queryKey: ["chat-groups", agencyId, user.id] });
        qc.invalidateQueries({ queryKey: ["chat-group-messages", row.group_id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, agencyId, qc]);

  return query;
}

function MemberPicker({
  members,
  selected,
  onToggle,
}: {
  members: GroupMember[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = members.filter((m) => (m.full_name || m.email || "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Teammitglied suchen…" />
      <div className="max-h-60 overflow-y-auto rounded-md border p-1">
        {list.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">Niemand gefunden</p>}
        {list.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
            <Checkbox checked={selected.includes(m.id)} onCheckedChange={() => onToggle(m.id)} />
            <Avatar className="h-7 w-7">
              <AvatarImage src={m.avatar_url ?? undefined} />
              <AvatarFallback className="text-[10px]">{initials(m)}</AvatarFallback>
            </Avatar>
            <span className="truncate text-sm">{m.full_name ?? m.email}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function NewGroupDialog({
  open,
  onOpenChange,
  members,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: GroupMember[];
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setName("");
      setSel([]);
    }
  }, [open]);
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("chat_group_create", { _name: name.trim(), _member_ids: sel });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      onOpenChange(false);
      onCreated(id);
    },
    onError: () => toast.error("Gruppe konnte nicht erstellt werden"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Neue Gruppe</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name der Gruppe" autoFocus />
          <MemberPicker members={members} selected={sel} onToggle={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
          <p className="text-xs text-muted-foreground">{sel.length} ausgewählt – du bist automatisch dabei.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button disabled={!name.trim() || sel.length === 0 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GroupAvatar({ group, className }: { group: Pick<ChatGroup, "kind" | "name">; className?: string }) {
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary", className)}>
      {group.kind === "property" ? <Building2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
    </span>
  );
}

export function GroupChatPanel({
  group,
  allMembers,
  onLeft,
}: {
  group: ChatGroup;
  allMembers: GroupMember[];
  onLeft: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const canManage = group.created_by === user?.id;

  const { data: memberIds = [] } = useQuery({
    queryKey: ["chat-group-members", group.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("chat_group_members").select("user_id").eq("group_id", group.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id as string);
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["chat-group-profiles", group.id, memberIds.join(",")],
    enabled: memberIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email, avatar_url").in("id", memberIds);
      return (data ?? []) as GroupMember[];
    },
  });
  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["chat-group-messages", group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_group_messages")
        .select("id, group_id, sender_id, body, attachments, created_at")
        .eq("group_id", group.id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as GroupMessage[];
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
    if (group.unread > 0 || messages.length) {
      supabase.rpc("chat_group_mark_read", { _group_id: group.id }).then(() => {
        qc.invalidateQueries({ queryKey: ["chat-groups"] });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, group.id]);

  const send = useMutation({
    mutationFn: async () => {
      const body = draft.trim();
      if (!body && !pending.length) return;
      const { error } = await supabase
        .from("chat_group_messages")
        .insert({ group_id: group.id, sender_id: user!.id, body, attachments: pending as unknown as never });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      setPending([]);
      qc.invalidateQueries({ queryKey: ["chat-group-messages", group.id] });
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    },
    onError: () => toast.error("Nachricht konnte nicht gesendet werden"),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !user?.id) return;
    setUploading(true);
    try {
      const up: ChatAttachment[] = [];
      for (const original of Array.from(files)) {
        const file = await shrinkImage(original);
        const path = await tenantStoragePath(`${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`);
        const { error } = await supabase.storage.from("chat-attachments").upload(path, file);
        if (error) throw error;
        up.push({ path, name: file.name, type: file.type, size: file.size });
      }
      setPending((p) => [...p, ...up]);
    } catch {
      toast.error("Anhang konnte nicht hochgeladen werden");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** Sprachnotiz sofort hochladen und in die Gruppe senden. */
  const sendVoice = async (file: File) => {
    if (!user?.id) return;
    try {
      const path = await tenantStoragePath(`${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`);
      const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, file);
      if (upErr) throw upErr;
      const att: ChatAttachment = { path, name: file.name, type: file.type, size: file.size };
      const { error } = await supabase
        .from("chat_group_messages")
        .insert({ group_id: group.id, sender_id: user.id, body: "Sprachnotiz", attachments: [att] as unknown as never });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["chat-group-messages", group.id] });
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
    } catch {
      toast.error("Sprachnotiz konnte nicht gesendet werden");
    }
  };

  const refreshMembers = () => {
    qc.invalidateQueries({ queryKey: ["chat-group-members", group.id] });
  };
  const addMembers = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc("chat_group_add_members", { _group_id: group.id, _member_ids: ids });
      if (error) throw error;
    },
    onSuccess: refreshMembers,
    onError: () => toast.error("Nicht erlaubt"),
  });
  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("chat_group_remove_member", { _group_id: group.id, _user_id: id });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      if (id === user?.id) {
        qc.invalidateQueries({ queryKey: ["chat-groups"] });
        onLeft();
      } else refreshMembers();
    },
    onError: () => toast.error("Nicht erlaubt"),
  });
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.rpc("chat_group_rename", { _group_id: group.id, _name: name });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-groups"] }),
    onError: () => toast.error("Nicht erlaubt"),
  });

  const [nameDraft, setNameDraft] = useState(group.name);
  useEffect(() => setNameDraft(group.name), [group.name]);
  const outsiders = allMembers.filter((m) => !memberIds.includes(m.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2 pr-12">
        <GroupAvatar group={group} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{group.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {group.kind === "property" ? "Projekt-Chat · " : ""}
            {memberIds.length} Mitglieder
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Settings2 className="h-4 w-4" /> Mitglieder
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="z-[60] w-80 space-y-3 p-3">
            {canManage && (
              <div className="flex gap-2">
                <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="h-8" />
                <Button size="sm" className="h-8" disabled={!nameDraft.trim() || nameDraft === group.name} onClick={() => rename.mutate(nameDraft.trim())}>
                  Speichern
                </Button>
              </div>
            )}
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {memberIds.map((id) => {
                const m = byId.get(id);
                return (
                  <div key={id} className="flex items-center gap-2 rounded px-1 py-1">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={m?.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">{initials(m)}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m?.full_name ?? m?.email ?? "…"}
                      {id === group.created_by && <span className="ml-1 text-[10px] text-muted-foreground">(Ersteller)</span>}
                    </span>
                    {canManage && id !== user?.id && (
                      <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Entfernen" onClick={() => removeMember.mutate(id)}>
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {canManage && outsiders.length > 0 && (
              <AddMembers members={outsiders} onAdd={(ids) => addMembers.mutate(ids)} />
            )}
            {!canManage && (
              <p className="text-[11px] text-muted-foreground">Mitglieder verwaltet die Person, die den Chat erstellt hat.</p>
            )}
            <Button variant="ghost" size="sm" className="w-full gap-1.5 text-destructive" onClick={() => removeMember.mutate(user!.id)}>
              <LogOut className="h-4 w-4" /> Chat verlassen
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="min-h-0 flex-1" style={{ backgroundImage: `url(${chatBg})`, backgroundSize: "420px", backgroundRepeat: "repeat" }}>
        <div className="space-y-2 p-3">
          {isLoading && <Loader2 className="mx-auto h-4 w-4 animate-spin" />}
          {!isLoading && messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Noch keine Nachrichten – schreib die erste.</p>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            const s = byId.get(m.sender_id);
            return (
              <div key={m.id} className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && (
                  <Avatar className="mt-1 h-7 w-7">
                    <AvatarImage src={s?.avatar_url ?? undefined} />
                    <AvatarFallback className="text-[10px]">{initials(s)}</AvatarFallback>
                  </Avatar>
                )}
                <div className={cn("max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm", mine ? "bg-primary text-primary-foreground" : "bg-background")}>
                  {!mine && <p className="mb-0.5 text-[11px] font-semibold text-primary">{s?.full_name ?? s?.email ?? "Ehemaliges Mitglied"}</p>}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  {(m.attachments ?? []).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(m.attachments ?? []).map((a) => <AttachmentView key={a.path} att={a} />)}
                    </div>
                  )}
                  <p className={cn("mt-1 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {new Date(m.created_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="shrink-0 space-y-2 border-t p-2">
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
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <Textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send.mutate();
            }
          }}
          placeholder="Nachricht an die Gruppe…"
          className="min-h-[40px] max-h-28 resize-none"
        />
        <div className="flex items-center gap-1">
          <EmojiPicker
            onPick={(e) => {
              const ta = taRef.current;
              const st = ta?.selectionStart ?? draft.length;
              const en = ta?.selectionEnd ?? draft.length;
              setDraft(draft.slice(0, st) + e + draft.slice(en));
              setTimeout(() => {
                ta?.focus();
                ta?.setSelectionRange(st + e.length, st + e.length);
              }, 0);
            }}
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Anhang" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <Button size="sm" className="ml-auto gap-1.5" disabled={send.isPending || (!draft.trim() && !pending.length)} onClick={() => send.mutate()}>
            <Send className="h-4 w-4" /> Senden
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddMembers({ members, onAdd }: { members: GroupMember[]; onAdd: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <div className="space-y-2 border-t pt-2">
      <p className="flex items-center gap-1 text-xs font-medium"><UserPlus className="h-3.5 w-3.5" /> Hinzufügen</p>
      <MemberPicker members={members} selected={sel} onToggle={(id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
      <Button size="sm" className="w-full" disabled={!sel.length} onClick={() => { onAdd(sel); setSel([]); }}>
        {sel.length} hinzufügen
      </Button>
    </div>
  );
}
