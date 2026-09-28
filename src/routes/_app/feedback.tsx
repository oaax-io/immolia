import { useTenantConfig } from "@/lib/tenant-config";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  MessageSquarePlus, Bug, Lightbulb, HelpCircle, Paperclip, X, Image as ImageIcon,
  Send, Loader2, Filter, ChevronUp, ChevronLeft, ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/_app/feedback")({
  component: FeedbackPage,
});

const TYPES = [
  { value: "idea", label: "Idee", icon: Lightbulb, color: "bg-amber-100 text-amber-800" },
  { value: "bug", label: "Fehler", icon: Bug, color: "bg-red-100 text-red-800" },
  { value: "question", label: "Frage", icon: HelpCircle, color: "bg-blue-100 text-blue-800" },
  { value: "other", label: "Sonstiges", icon: MessageSquarePlus, color: "bg-slate-100 text-slate-800" },
] as const;

const STATUSES = [
  { value: "new", label: "Neu", color: "bg-slate-100 text-slate-800" },
  { value: "under_review", label: "In Prüfung", color: "bg-blue-100 text-blue-800" },
  { value: "in_progress", label: "In Bearbeitung", color: "bg-amber-100 text-amber-800" },
  { value: "updated", label: "Aktualisiert", color: "bg-emerald-100 text-emerald-800" },
  { value: "duplicate", label: "Bereits vorhanden", color: "bg-violet-100 text-violet-800" },
  { value: "rejected", label: "Abgelehnt", color: "bg-rose-100 text-rose-800" },
  // Legacy
  { value: "planned", label: "Geplant", color: "bg-blue-100 text-blue-800" },
  { value: "done", label: "Erledigt", color: "bg-emerald-100 text-emerald-800" },
] as const;

const PRIORITIES = [
  { value: "low", label: "Niedrig" },
  { value: "medium", label: "Mittel" },
  { value: "high", label: "Hoch" },
  { value: "critical", label: "Kritisch" },
] as const;

type Attachment = { url: string; name: string; mime: string };

function typeMeta(t: string) { return TYPES.find(x => x.value === t) ?? TYPES[3]; }
function statusMeta(s: string) { return STATUSES.find(x => x.value === s) ?? STATUSES[0]; }

function useIsSuperadmin() {
  const { data } = useQuery({
    queryKey: ["is-superadmin-local"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_superadmin");
      if (error) return false;
      return !!data;
    },
    staleTime: 5 * 60 * 1000,
  });
  return !!data;
}

async function uploadFiles(files: File[], userId: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) {
    const ext = f.name.split(".").pop() ?? "bin";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("feedback").upload(path, f, { contentType: f.type });
    if (error) throw error;
    const { data } = supabase.storage.from("feedback").getPublicUrl(path);
    out.push({ url: data.publicUrl, name: f.name, mime: f.type });
  }
  return out;
}

const ACTIVE_STATUSES = STATUSES.filter(s => !["planned", "done"].includes(s.value));

function FeedbackPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const fbAgencyId = useTenantConfig().data?.agency_id ?? null;
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["feedback", fbAgencyId, filterStatus, filterType],
    enabled: !!fbAgencyId,
    queryFn: async () => {
      let q = supabase.from("feedback").select("*").order("created_at", { ascending: false });
      if (filterStatus !== "all") q = q.eq("status", filterStatus as any);
      if (filterType !== "all") q = q.eq("type", filterType as any);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: votes = [] } = useQuery({
    queryKey: ["feedback-votes"],
    queryFn: async () => {
      const { data } = await supabase.from("feedback_votes").select("feedback_id, user_id");
      return data ?? [];
    },
  });
  const voteCount = useMemo(() => {
    const m = new Map<string, number>();
    votes.forEach((v: any) => m.set(v.feedback_id, (m.get(v.feedback_id) ?? 0) + 1));
    return m;
  }, [votes]);
  const myVotes = useMemo(() => new Set(votes.filter((v: any) => v.user_id === user?.id).map((v: any) => v.feedback_id)), [votes, user?.id]);

  const toggleVote = useMutation({
    mutationFn: async (feedbackId: string) => {
      if (!user) throw new Error("Nicht angemeldet");
      if (myVotes.has(feedbackId)) {
        const { error } = await supabase.from("feedback_votes").delete().eq("feedback_id", feedbackId).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("feedback_votes").insert({ feedback_id: feedbackId, user_id: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback-votes"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["feedback-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email");
      return data ?? [];
    },
  });
  const profileById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
          <p className="text-sm text-muted-foreground">Ideen, Fehlermeldungen und Fragen — mit Status-Tracking und Kommentaren.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <MessageSquarePlus className="h-4 w-4" /> Neues Feedback
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Tabs value={filterStatus} onValueChange={setFilterStatus}>
          <TabsList>
            <TabsTrigger value="all">Alle</TabsTrigger>
            {ACTIVE_STATUSES.map(s => <TabsTrigger key={s.value} value={s.value}>{s.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          Noch kein Feedback vorhanden.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {items.map((it: any) => {
            const tm = typeMeta(it.type);
            const sm = statusMeta(it.status);
            const author = profileById.get(it.created_by);
            const Icon = tm.icon;
            return (
              <Card key={it.id} className="cursor-pointer transition-colors hover:bg-muted/30" onClick={() => setOpenId(it.id)}>
                <CardContent className="flex items-start gap-4 p-4">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleVote.mutate(it.id); }}
                    className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border transition-colors ${
                      myVotes.has(it.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-muted"
                    }`}
                    title={myVotes.has(it.id) ? "Stimme zurückziehen" : "Hochstimmen"}
                  >
                    <ChevronUp className="h-4 w-4" />
                    <span className="text-xs font-semibold">{voteCount.get(it.id) ?? 0}</span>
                  </button>
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tm.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{it.title}</h3>
                      <Badge variant="secondary" className={sm.color}>{sm.label}</Badge>
                      {it.attachments?.length > 0 && (
                        <Badge variant="outline" className="gap-1 text-xs">
                          <Paperclip className="h-3 w-3" />{it.attachments.length}
                        </Badge>
                      )}
                    </div>
                    {it.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{it.description}</p>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground">
                      {author?.full_name || author?.email || "Unbekannt"} · {new Date(it.created_at).toLocaleString("de-DE")}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateFeedbackDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        userId={user?.id ?? null}
        profiles={profiles as any}
        onCreated={() => qc.invalidateQueries({ queryKey: ["feedback"] })}
      />
      <FeedbackDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function CreateFeedbackDialog({
  open, onOpenChange, userId, profiles, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; userId: string | null; profiles: Array<{ id: string; full_name: string | null; email: string | null }>; onCreated: () => void }) {
  const isSuperadmin = useIsSuperadmin();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<string>("idea");
  const [priority, setPriority] = useState<string>("medium");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [authorId, setAuthorId] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setTitle(""); setDescription(""); setType("idea"); setPriority("medium");
      setFiles([]); setAuthorId(""); setCreatedAt("");
    }
  }, [open]);

  const submit = async () => {
    if (!title.trim() || !userId) { toast.error("Titel erforderlich"); return; }
    setSubmitting(true);
    try {
      const effectiveAuthor = isSuperadmin && authorId ? authorId : userId;
      const attachments = files.length ? await uploadFiles(files, userId) : [];
      const payload: any = {
        title: title.trim(),
        description: description.trim() || null,
        type: type as any,
        priority: priority as any,
        attachments: attachments as any,
        page_url: typeof window !== "undefined" ? window.location.href : null,
        created_by: effectiveAuthor,
      };
      if (isSuperadmin && createdAt) {
        payload.created_at = new Date(createdAt).toISOString();
      }
      const { error } = await supabase.from("feedback").insert(payload);
      if (error) throw error;
      toast.success("Feedback erstellt");
      onOpenChange(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message ?? "Fehler beim Speichern");
    } finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Neues Feedback</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Typ</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priorität</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Titel</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Kurze Zusammenfassung" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Beschreibung</label>
            <Textarea rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="Beschreibe Idee oder Fehler im Detail" />
          </div>
          <FileDropzone files={files} setFiles={setFiles} />
          {isSuperadmin && (
            <div className="rounded-md border border-dashed bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                Systemowner: Feedback im Namen eines Mitarbeiters erfassen (z.B. nachträglich aus E-Mail)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Mitarbeiter</label>
                  <Select value={authorId || "self"} onValueChange={(v) => setAuthorId(v === "self" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self">Ich selbst</SelectItem>
                      {profiles.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name || p.email || p.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Datum (optional)</label>
                  <Input type="datetime-local" value={createdAt} onChange={e => setCreatedAt(e.target.value)} />
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileDropzone({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onPaste = (e: ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgs = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
    if (imgs.length) setFiles([...files, ...imgs]);
  };
  useEffect(() => {
    window.addEventListener("paste", onPaste as any);
    return () => window.removeEventListener("paste", onPaste as any);
  });

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">Anhänge (Screenshots per Strg+V einfügen)</label>
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const dropped = Array.from(e.dataTransfer.files); if (dropped.length) setFiles([...files, ...dropped]); }}
        className="mt-1 cursor-pointer rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground hover:bg-muted/30"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="mx-auto mb-1 h-4 w-4" />
        Dateien anhängen oder hierher ziehen
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={e => { const list = Array.from(e.target.files ?? []); if (list.length) setFiles([...files, ...list]); e.target.value = ""; }} />
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs">
              {f.type.startsWith("image/") ? <ImageIcon className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
              <span className="max-w-[160px] truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const isSuperadmin = useIsSuperadmin();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);

  const { data: item } = useQuery({
    queryKey: ["feedback", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("feedback").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["feedback-comments", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("feedback_comments").select("*").eq("feedback_id", id!).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["feedback-profiles"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const profileById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles]);

  const setStatusMut = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("feedback").update({
        status: status as any,
        resolved_at: ["done", "rejected", "updated", "duplicate"].includes(status) ? new Date().toISOString() : null,
      }).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["feedback"] }); toast.success("Status aktualisiert"); },
    onError: (e: any) => toast.error(e.message),
  });

  const setPriorityMut = useMutation({
    mutationFn: async (priority: string) => {
      const { error } = await supabase.from("feedback").update({ priority: priority as any }).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback"] }),
  });

  const postComment = async () => {
    if (!comment.trim() && files.length === 0) return;
    if (!user) return;
    setPosting(true);
    try {
      const attachments = files.length ? await uploadFiles(files, user.id) : [];
      const { error } = await supabase.from("feedback_comments").insert({
        feedback_id: id!, author_id: user.id, body: comment.trim() || "(Anhang)", attachments: attachments as any,
      });
      if (error) throw error;
      setComment(""); setFiles([]);
      qc.invalidateQueries({ queryKey: ["feedback-comments", id] });
    } catch (e: any) { toast.error(e.message); }
    finally { setPosting(false); }
  };

  if (!id) return null;
  const sm = item ? statusMeta(item.status) : null;
  const tm = item ? typeMeta(item.type) : null;
  const author = item?.created_by ? profileById.get(item.created_by) : null;
  const Icon = tm?.icon ?? MessageSquarePlus;

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {item && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tm?.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-left">{item.title}</DialogTitle>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {author?.full_name || author?.email || "Unbekannt"} · {new Date(item.created_at).toLocaleString("de-DE")}
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Status {!isSuperadmin && <span className="ml-1">(nur Systemowner)</span>}
                </label>
                {isSuperadmin ? (
                  <Select value={item.status} onValueChange={(v) => setStatusMut.mutate(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ACTIVE_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : sm ? (
                  <div className="flex h-9 items-center">
                    <Badge variant="secondary" className={sm.color}>{sm.label}</Badge>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Priorität {!isSuperadmin && <span className="ml-1">(nur Systemowner)</span>}
                </label>
                {isSuperadmin ? (
                  <Select value={item.priority} onValueChange={(v) => setPriorityMut.mutate(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center text-sm capitalize">
                    {PRIORITIES.find(p => p.value === item.priority)?.label ?? item.priority}
                  </div>
                )}
              </div>
            </div>

            {item.description && (
              <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap">{item.description}</div>
            )}

            {Array.isArray(item.attachments) && item.attachments.length > 0 && (
              <AttachmentGrid attachments={item.attachments as unknown as Attachment[]} />
            )}

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Kommentare ({comments.length})</h4>
              <div className="space-y-3">
                {comments.map((c: any) => {
                  const a = profileById.get(c.author_id);
                  return (
                    <div key={c.id} className="rounded-md border p-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{a?.full_name || a?.email || "Unbekannt"}</span>
                        <span>{new Date(c.created_at).toLocaleString("de-DE")}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                      {c.attachments?.length > 0 && <AttachmentGrid attachments={c.attachments as Attachment[]} />}
                    </div>
                  );
                })}
                {comments.length === 0 && <p className="text-sm text-muted-foreground">Noch keine Kommentare.</p>}
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="Kommentar schreiben…" />
                <FileDropzone files={files} setFiles={setFiles} />
                <div className="flex justify-end">
                  <Button onClick={postComment} disabled={posting} className="gap-2">
                    {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Senden
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AttachmentGrid({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter(a => a.mime?.startsWith("image/"));
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<number>>(new Set());

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {attachments.map((a, i) => a.mime?.startsWith("image/") ? (
          <button key={i} type="button" className="block cursor-zoom-in"
            onClick={(e) => { e.stopPropagation(); setViewerIdx(images.indexOf(a)); }}>
            {broken.has(i) ? (
              <span className="flex h-24 w-24 items-center justify-center rounded-md border bg-muted/30 text-[10px] text-muted-foreground">
                Bild nicht ladbar
              </span>
            ) : (
              <img src={a.url} alt={a.name}
                onError={() => setBroken(prev => new Set(prev).add(i))}
                className="h-24 w-24 rounded-md border object-cover transition hover:opacity-80" />
            )}
          </button>
        ) : (
          <a key={i} href={a.url} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs hover:bg-muted">
            <Paperclip className="h-3 w-3" /> {a.name}
          </a>
        ))}
      </div>

      <Dialog open={viewerIdx !== null} onOpenChange={(o) => !o && setViewerIdx(null)}>
        <DialogContent className="max-w-4xl" onClick={(e) => e.stopPropagation()}>
          {viewerIdx !== null && images[viewerIdx] && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate text-sm font-medium">
                  {images[viewerIdx].name} · Bild {viewerIdx + 1} von {images.length}
                </DialogTitle>
              </DialogHeader>
              <div className="relative flex h-[70vh] w-full items-center justify-center overflow-hidden rounded-md border bg-muted">
                <img src={images[viewerIdx].url} alt={images[viewerIdx].name}
                  className="max-h-full max-w-full object-contain" />
                {images.length > 1 && (
                  <>
                    <Button size="icon" variant="secondary"
                      className="absolute left-2 top-1/2 -translate-y-1/2 shadow-md"
                      disabled={viewerIdx === 0}
                      onClick={() => setViewerIdx(Math.max(0, viewerIdx - 1))}>
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <Button size="icon" variant="secondary"
                      className="absolute right-2 top-1/2 -translate-y-1/2 shadow-md"
                      disabled={viewerIdx === images.length - 1}
                      onClick={() => setViewerIdx(Math.min(images.length - 1, viewerIdx + 1))}>
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </>
                )}
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" asChild>
                  <a href={images[viewerIdx].url} target="_blank" rel="noreferrer">In neuem Tab öffnen</a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
