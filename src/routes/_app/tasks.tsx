import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, CheckCircle2, Circle, Clock, AlertCircle, Search, Trash2, ExternalLink, CheckSquare, Pin, LayoutGrid, Columns3, List} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { formatDate, formatDateTime } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { deleteToTrash } from "@/lib/trash";

export const Route = createFileRoute("/_app/tasks")({ component: TasksPage });

const STATUSES = ["open","in_progress","waiting","done","cancelled"] as const;
const PRIORITIES = ["low","normal","high","urgent"] as const;
const RELATED_TYPES = ["client","property","mandate","reservation","lead"] as const;

const SUBJECT_PRESETS: string[] = [
  "Notartermin planen",
  "Notartermin durchführen",
  "Kundenordner erstellen",
  "Besichtigung organisieren",
  "Besichtigung durchführen",
  "Exposé erstellen",
  "Exposé versenden",
  "Inserat schalten",
  "Inserat aktualisieren",
  "Fotos / Drohnenaufnahmen organisieren",
  "Grundriss erstellen / aktualisieren",
  "Energieausweis anfordern",
  "Grundbuchauszug anfordern",
  "Auszug aus Liegenschaftskataster anfordern",
  "Verkaufsunterlagen zusammenstellen",
  "Kaufvertragsentwurf prüfen",
  "Kaufvertrag unterzeichnen",
  "Reservationsvereinbarung erstellen",
  "Mietvertrag aufsetzen",
  "Mietvertrag unterzeichnen",
  "Übergabeprotokoll erstellen",
  "Schlüsselübergabe vereinbaren",
  "Objektbewertung durchführen",
  "Markt- und Lageanalyse erstellen",
  "Finanzierungsbestätigung einholen",
  "Selbstauskunft anfordern",
  "Bonitätsprüfung durchführen",
  "Kunde kontaktieren / Rückruf",
  "Termin mit Eigentümer vereinbaren",
  "Termin mit Käufer vereinbaren",
  "Maklervertrag aufsetzen",
  "Maklervertrag unterzeichnen",
  "Provisionsrechnung erstellen",
  "Handwerker / Gutachter beauftragen",
  "Renovationsangebot einholen",
  "Objektübergabe vorbereiten",
  "Nachfassen / Follow-up",
];

const PRIORITY_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  low: "outline", normal: "secondary", high: "destructive", urgent: "destructive",
};

const STATUS_STYLES: Record<string, { dot: string; badge: string; trigger: string; border: string }> = {
  open:        { dot: "bg-slate-400",   badge: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",       trigger: "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-200",       border: "border-l-slate-400" },
  in_progress: { dot: "bg-blue-500",    badge: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",            trigger: "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",             border: "border-l-blue-500" },
  waiting:     { dot: "bg-amber-500",   badge: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",      trigger: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",        border: "border-l-amber-500" },
  done:        { dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900", trigger: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", border: "border-l-emerald-500" },
  cancelled:   { dot: "bg-rose-500",    badge: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900",            trigger: "border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",             border: "border-l-rose-500" },
};

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("");
}

const emptyForm = {
  title: "", description: "", status: "open", priority: "normal",
  due_date: "", assigned_to: "", related_type: "none", related_id: "",
};

function useTaskLabels() {
  const { t } = useTranslation();
  return {
    status: Object.fromEntries(STATUSES.map(s => [s, t(`tasks.status.${s}`)])) as Record<string, string>,
    priority: Object.fromEntries(PRIORITIES.map(p => [p, t(`tasks.priority.${p}`)])) as Record<string, string>,
    related: Object.fromEntries(RELATED_TYPES.map(r => [r, t(`tasks.related.${r}`)])) as Record<string, string>,
  };
}

function TasksPage() {
  const { t } = useTranslation();
  const labels = useTaskLabels();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [waitingFor, setWaitingFor] = useState<{ id: string; title: string } | null>(null);
  const [waitingComment, setWaitingComment] = useState("");
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("active");
  const [fPriority, setFPriority] = useState("all");
  const [fAssignee, setFAssignee] = useState("all");
  const [fDue, setFDue] = useState("all");
  const [form, setForm] = useState({ ...emptyForm });
  const [view, setView] = useState<"cards" | "kanban" | "list">(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem("tasks-view") : null;
    return v === "cards" || v === "kanban" ? v : "list";
  });
  const changeView = (v: "cards" | "kanban" | "list") => {
    setView(v);
    try { window.localStorage.setItem("tasks-view", v); } catch { /* ignore */ }
  };


  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email").eq("is_active", true)).data ?? [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").order("full_name")).data ?? [],
  });
  const { data: properties = [] } = useQuery({
    queryKey: ["properties-min"],
    queryFn: async () => (await supabase.from("properties").select("id, title").order("title")).data ?? [],
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["leads-min"],
    queryFn: async () => (await supabase.from("leads").select("id, full_name").order("full_name")).data ?? [],
  });
  const { data: mandates = [] } = useQuery({
    queryKey: ["mandates-min"],
    queryFn: async () => (await supabase.from("mandates").select("id, status, properties(title)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: reservations = [] } = useQuery({
    queryKey: ["reservations-min"],
    queryFn: async () => (await supabase.from("reservations").select("id, status, properties(title)").order("created_at", { ascending: false })).data ?? [],
  });

  const optionsFor = (type: string) => {
    switch (type) {
      case "client": return clients.map((c: any) => ({ id: c.id, label: c.full_name }));
      case "property": return properties.map((p: any) => ({ id: p.id, label: p.title }));
      case "lead": return leads.map((l: any) => ({ id: l.id, label: l.full_name }));
      case "mandate": return mandates.map((m: any) => ({ id: m.id, label: `${m.properties?.title ?? labels.related.mandate} · ${m.status}` }));
      case "reservation": return reservations.map((r: any) => ({ id: r.id, label: `${r.properties?.title ?? labels.related.reservation} · ${r.status}` }));
      default: return [];
    }
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error(t("tasks.toasts.titleRequired"));
      const payload: any = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        priority: form.priority,
        due_date: form.due_date ? new Date(`${form.due_date}T12:00:00`).toISOString() : null,
        created_by: user?.id ?? null,
        assigned_to: form.assigned_to || user?.id || null,
        related_type: form.related_type !== "none" ? form.related_type : null,
        related_id: form.related_type !== "none" && form.related_id ? form.related_id : null,
      };
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("tasks.toasts.created"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setForm({ ...emptyForm });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteToTrash("tasks", id);
    },
    onSuccess: () => {
      toast.success(t("tasks.toasts.deleted"));
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setDetailId(null);
    },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["tasks"] }); },
  });

  // Live updates: toast when somebody else changes tasks
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("tasks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        const row: any = payload.new ?? payload.old;
        const actor = (row as any)?.updated_by ?? null;
        if (actor && actor === user.id) {
          qc.invalidateQueries({ queryKey: ["tasks"] });
          return;
        }
        const title = (payload.new as any)?.title ?? (payload.old as any)?.title ?? t("tasks.title");
        if (payload.eventType === "INSERT") toast.info(`${t("tasks.toasts.created")}: ${title}`);
        else if (payload.eventType === "UPDATE") {
          const oldRow: any = payload.old; const newRow: any = payload.new;
          if (oldRow?.assigned_to !== newRow?.assigned_to && newRow?.assigned_to === user.id) {
            toast.info(`${t("tasks.toasts.assignedToYou", { defaultValue: "Aufgabe dir zugewiesen" })}: ${title}`);
          } else if (oldRow?.status !== newRow?.status) {
            toast.info(`${title} → ${t(`tasks.status.${newRow?.status}`)}`);
          } else {
            toast.message(`${t("tasks.toasts.updated")}: ${title}`);
          }
        } else if (payload.eventType === "DELETE") toast.message(`${t("tasks.toasts.deleted")}: ${title}`);
        qc.invalidateQueries({ queryKey: ["tasks"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc, t]);


  const now = Date.now();
  const filtered = useMemo(() => tasks.filter((tk: any) => {
    if (search && !`${tk.title} ${tk.description ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (fStatus === "active" && (tk.status === "done" || tk.status === "cancelled")) return false;
    if (fStatus !== "all" && fStatus !== "active" && tk.status !== fStatus) return false;
    if (fPriority !== "all" && tk.priority !== fPriority) return false;
    if (fAssignee === "me" && tk.assigned_to !== user?.id) return false;
    if (fAssignee !== "all" && fAssignee !== "me" && tk.assigned_to !== fAssignee) return false;
    if (fDue !== "all") {
      if (!tk.due_date) return fDue === "none";
      const due = new Date(tk.due_date).getTime();
      const startToday = new Date(); startToday.setHours(0,0,0,0);
      const endToday = startToday.getTime() + 86400000;
      const endWeek = startToday.getTime() + 7 * 86400000;
      if (fDue === "overdue" && (due >= now || tk.status === "done" || tk.status === "cancelled")) return false;
      if (fDue === "today" && (due < startToday.getTime() || due >= endToday)) return false;
      if (fDue === "week" && (due < startToday.getTime() || due >= endWeek)) return false;
      if (fDue === "none") return false;
    }
    return true;
  }), [tasks, search, fStatus, fPriority, fAssignee, fDue, now, user?.id]);

  const sorted = useMemo(
    () => [...filtered].sort((a: any, b: any) => Number(b.is_pinned ?? false) - Number(a.is_pinned ?? false)),
    [filtered],
  );

  const togglePin = (tk: any) =>
    update.mutate({ id: tk.id, patch: { is_pinned: !tk.is_pinned } });

  const detailTask = tasks.find((tk: any) => tk.id === detailId);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <CheckSquare className="h-8 w-8 text-[#6F6B94]" />
            {t("pages.tasks.title")}
          </span>
        }
        action={<Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />{t("tasks.new")}</Button>}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("tasks.new")}</DialogTitle>
            <DialogDescription>{t("tasks.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <TaskForm form={form} setForm={setForm} employees={employees} optionsFor={optionsFor} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("tasks.actions.cancel")}</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>{t("tasks.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("tasks.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t("tasks.filters.active")}</SelectItem>
            <SelectItem value="all">{t("tasks.filters.allStatus")}</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{labels.status[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fPriority} onValueChange={setFPriority}>
          <SelectTrigger><SelectValue placeholder={t("tasks.filters.priority")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tasks.filters.allPriorities")}</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{labels.priority[p]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fAssignee} onValueChange={setFAssignee}>
          <SelectTrigger><SelectValue placeholder={t("tasks.filters.assignee")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tasks.filters.allEmployees")}</SelectItem>
            <SelectItem value="me">{t("tasks.filters.assignedToMe")}</SelectItem>
            {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fDue} onValueChange={setFDue}>
          <SelectTrigger><SelectValue placeholder={t("tasks.filters.due")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("tasks.filters.allDue")}</SelectItem>
            <SelectItem value="overdue">{t("tasks.filters.overdue")}</SelectItem>
            <SelectItem value="today">{t("tasks.filters.today")}</SelectItem>
            <SelectItem value="week">{t("tasks.filters.week")}</SelectItem>
            <SelectItem value="none">{t("tasks.filters.none")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4 flex items-center justify-end gap-1">
        {([
          { v: "cards" as const, icon: LayoutGrid, label: "Karten" },
          { v: "kanban" as const, icon: Columns3, label: "Kanban" },
          { v: "list" as const, icon: List, label: "Liste" },
        ]).map(({ v, icon: VIcon, label }) => (
          <Button
            key={v}
            type="button"
            variant={view === v ? "secondary" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => changeView(v)}
          >
            <VIcon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">{t("tasks.loading")}</div>
      ) : sorted.length === 0 ? (
        <EmptyState
          title={tasks.length === 0 ? t("tasks.empty.none") : t("tasks.empty.noResults")}
          description={tasks.length === 0
            ? t("tasks.empty.noneDescription")
            : t("tasks.empty.noResultsDescription")}
          action={tasks.length === 0 ? <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />{t("tasks.createButton")}</Button> : undefined}
        />
      ) : view === "kanban" ? (
        <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-2 xl:grid-cols-4">
          {(["open", "in_progress", "waiting", "done"] as const).map((status) => {
            const col = sorted.filter((tk: any) => tk.status === status);
            const sStyle = STATUS_STYLES[status];
            return (
              <div key={status} className="flex min-w-[240px] flex-col rounded-md border bg-muted/30">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <span className={`h-2 w-2 rounded-full ${sStyle.dot}`} />
                  <span className="text-sm font-semibold">{labels.status[status]}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{col.length}</span>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {col.length === 0 ? (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">—</div>
                  ) : col.map((tk: any) => (
                    <TaskCard key={tk.id} tk={tk} now={now} employees={employees} labels={labels} onOpen={() => { setDetailId(tk.id); setMode("view"); }} onToggleDone={() => update.mutate({ id: tk.id, patch: { status: tk.status === "done" ? "open" : "done" } })} onTogglePin={() => togglePin(tk)} compact />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === "list" ? (
        <div className="overflow-hidden rounded-md border">
          {sorted.map((tk: any, i: number) => {
            const overdue = tk.due_date && new Date(tk.due_date).getTime() < now && tk.status !== "done" && tk.status !== "cancelled";
            const assignee = employees.find((e: any) => e.id === tk.assigned_to);
            const assigneeName = (assignee as any)?.full_name || (assignee as any)?.email;
            const sStyle = STATUS_STYLES[tk.status] ?? STATUS_STYLES.open;
            return (
              <div
                key={tk.id}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition hover:bg-muted/50 ${i > 0 ? "border-t" : ""} ${tk.is_pinned ? "bg-primary/[0.03]" : ""}`}
                onClick={() => { setDetailId(tk.id); setMode("view"); }}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); togglePin(tk); }}
                  className={`shrink-0 ${tk.is_pinned ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                  title={tk.is_pinned ? "Nicht mehr anpinnen" : "Anpinnen"}
                >
                  <Pin className={`h-3.5 w-3.5 ${tk.is_pinned ? "fill-current" : ""}`} />
                </button>
                <span className={`min-w-0 flex-1 truncate ${tk.status === "done" ? "text-muted-foreground line-through" : "font-medium"}`}>{tk.title}</span>
                <Badge variant="outline" className={`hidden shrink-0 border px-1.5 py-0 text-[10px] sm:inline-flex ${sStyle.badge}`}>{labels.status[tk.status] ?? tk.status}</Badge>
                {(tk.priority === "high" || tk.priority === "urgent") && (
                  <Badge variant={PRIORITY_VARIANTS[tk.priority]} className="shrink-0 px-1.5 py-0 text-[10px]">{labels.priority[tk.priority] ?? tk.priority}</Badge>
                )}
                {assignee && (
                  <span className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary sm:flex" title={assigneeName}>{initials(assigneeName)}</span>
                )}
                <span className={`w-20 shrink-0 text-right text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                  {tk.due_date ? formatDate(tk.due_date) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((tk: any) => (
            <TaskCard key={tk.id} tk={tk} now={now} employees={employees} labels={labels} onOpen={() => { setDetailId(tk.id); setMode("view"); }} onToggleDone={() => update.mutate({ id: tk.id, patch: { status: tk.status === "done" ? "open" : "done" } })} onTogglePin={() => togglePin(tk)} />
          ))}
        </div>
      )}

      <TaskDetailDialog
        task={detailTask}
        open={!!detailId}
        mode={mode}
        setMode={setMode}
        onClose={() => setDetailId(null)}
        employees={employees}
        optionsFor={optionsFor}
        onSave={(patch) => update.mutate({ id: detailTask!.id, patch }, { onSuccess: () => { toast.success(t("tasks.toasts.updated")); setDetailId(null); } })}
        onDelete={async () => { if (await confirm({ title: t("tasks.confirmDelete.title"), confirmText: t("tasks.confirmDelete.confirm") })) remove.mutate(detailTask!.id); }}
        onRequestWaiting={(task) => { setWaitingComment(""); setWaitingFor({ id: task.id, title: task.title }); }}
      />

      <Dialog open={!!waitingFor} onOpenChange={(o) => { if (!o) setWaitingFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aufgabe auf Pendent setzen</DialogTitle>
            <DialogDescription>
              {waitingFor?.title ? `„${waitingFor.title}" – ` : ""}Bitte gib einen Kommentar an, warum die Aufgabe pendent ist.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            autoFocus
            placeholder="Kommentar zum Pendent-Status…"
            value={waitingComment}
            onChange={(e) => setWaitingComment(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaitingFor(null)}>{t("tasks.actions.cancel")}</Button>
            <Button
              disabled={!waitingComment.trim() || update.isPending}
              onClick={() => {
                if (!waitingFor) return;
                const current = tasks.find((x: any) => x.id === waitingFor.id);
                const stamp = new Date().toLocaleString("de-CH");
                const existing = (current?.description ?? "").trim();
                const entry = `— ${stamp} — Pendent: ${waitingComment.trim()}`;
                const newDesc = existing ? `${existing}\n\n${entry}` : entry;
                update.mutate(
                  { id: waitingFor.id, patch: { status: "waiting", description: newDesc } },
                  { onSuccess: () => { toast.success("Aufgabe auf Pendent gesetzt"); setWaitingFor(null); setDetailId(null); } },
                );
              }}
            >Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


function TaskCard({
  tk, now, employees, labels, onOpen, onToggleDone, onTogglePin, compact = false,
}: {
  tk: any; now: number; employees: any[];
  labels: { status: Record<string, string>; priority: Record<string, string>; related: Record<string, string> };
  onOpen: () => void; onToggleDone: () => void; onTogglePin: () => void; compact?: boolean;
}) {
  const overdue = tk.due_date && new Date(tk.due_date).getTime() < now && tk.status !== "done" && tk.status !== "cancelled";
  const Icon = tk.status === "done" ? CheckCircle2 : tk.status === "in_progress" ? Clock : tk.priority === "urgent" ? AlertCircle : Circle;
  const assignee = employees.find((e: any) => e.id === tk.assigned_to);
  const assigneeName = (assignee as any)?.full_name || (assignee as any)?.email;
  const sStyle = STATUS_STYLES[tk.status] ?? STATUS_STYLES.open;
  return (
    <div
      title={tk.title}
      className={`group cursor-pointer rounded-md border border-border/70 border-l-[3px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition hover:border-border hover:shadow-md ${overdue ? "border-l-destructive bg-destructive/[0.04]" : sStyle.border} ${tk.is_pinned ? "ring-1 ring-primary/20" : ""}`}
      onClick={onOpen}
    >
      <div className={`flex items-center gap-2 ${compact ? "px-2.5 py-2" : "px-3 py-2.5"}`}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleDone(); }}
          className="shrink-0"
        >
          <Icon className={`h-4 w-4 ${tk.status === "done" ? "text-success" : overdue ? "text-destructive" : "text-muted-foreground"}`} />
        </button>
        <span className={`min-w-0 flex-1 truncate text-sm ${tk.status === "done" ? "text-muted-foreground line-through" : "font-medium"}`}>{tk.title}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`shrink-0 transition ${tk.is_pinned ? "text-primary" : "text-muted-foreground/30 opacity-0 hover:text-muted-foreground group-hover:opacity-100"}`}
          title={tk.is_pinned ? "Nicht mehr anpinnen" : "Anpinnen"}
        >
          <Pin className={`h-3.5 w-3.5 ${tk.is_pinned ? "fill-current" : ""}`} />
        </button>
        {(tk.priority === "high" || tk.priority === "urgent") && (
          <Badge variant={PRIORITY_VARIANTS[tk.priority]} className="shrink-0 px-1.5 py-0 text-[10px]">
            {labels.priority[tk.priority] ?? tk.priority}
          </Badge>
        )}
        {assignee && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary"
            title={assigneeName}
          >
            {initials(assigneeName)}
          </span>
        )}
        {tk.due_date && (
          <span className={`flex shrink-0 items-center gap-1 text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}>
            <Clock className="h-3 w-3" />
            {formatDate(tk.due_date)}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskForm({
  form, setForm, employees, optionsFor,
}: { form: any; setForm: (f: any) => void; employees: any[]; optionsFor: (t: string) => { id: string; label: string }[] }) {
  const { t } = useTranslation();
  const labels = useTaskLabels();
  return (
    <div className="space-y-3">
      <div>
        <Label>Betreff-Vorlage</Label>
        <Select value={SUBJECT_PRESETS.includes(form.title) ? form.title : ""} onValueChange={(v) => setForm({ ...form, title: v })}>
          <SelectTrigger><SelectValue placeholder="Vorlage auswählen (optional)" /></SelectTrigger>
          <SelectContent className="max-h-72">
            {SUBJECT_PRESETS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div><Label>{t("tasks.form.title")} *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
      <div><Label>{t("tasks.form.description")}</Label><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>{t("tasks.form.status")}</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{labels.status[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("tasks.form.priority")}</Label>
          <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{labels.priority[p]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("tasks.form.dueDate")}</Label>
          <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>{t("tasks.form.assignee")}</Label>
          <Select value={form.assigned_to || "none"} onValueChange={(v) => setForm({ ...form, assigned_to: v === "none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("tasks.form.noAssignee")}</SelectItem>
              {employees.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("tasks.form.relation")}</Label>
          <Select value={form.related_type} onValueChange={(v) => setForm({ ...form, related_type: v, related_id: "" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("tasks.form.noRelation")}</SelectItem>
              {RELATED_TYPES.map(r => <SelectItem key={r} value={r}>{labels.related[r]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("tasks.form.linkTo")}</Label>
          <Select value={form.related_id || "none"} onValueChange={(v) => setForm({ ...form, related_id: v === "none" ? "" : v })} disabled={form.related_type === "none"}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {optionsFor(form.related_type).map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function TaskDetailDialog({
  task, open, mode, setMode, onClose, employees, optionsFor, onSave, onDelete, onRequestWaiting,
}: {
  task: any; open: boolean; mode: "view" | "edit"; setMode: (m: "view" | "edit") => void;
  onClose: () => void;
  employees: any[]; optionsFor: (t: string) => { id: string; label: string }[];
  onSave: (patch: any) => void; onDelete: () => void;
  onRequestWaiting: (task: any) => void;
}) {
  const { t } = useTranslation();
  const labels = useTaskLabels();
  const [form, setForm] = useState<any>({ ...emptyForm });

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title ?? "",
        description: task.description ?? "",
        status: task.status ?? "open",
        priority: task.priority ?? "normal",
        due_date: task.due_date ? new Date(task.due_date).toISOString().slice(0, 10) : "",
        assigned_to: task.assigned_to ?? "",
        related_type: task.related_type ?? "none",
        related_id: task.related_id ?? "",
      });
    }
  }, [task]);

  const relatedHref = useMemo(() => {
    if (!task?.related_id || !task?.related_type) return null;
    if (task.related_type === "client") return `/clients/${task.related_id}`;
    if (task.related_type === "property") return `/properties/${task.related_id}`;
    if (task.related_type === "lead") return `/leads/${task.related_id}`;
    return null;
  }, [task]);

  const assignee = employees.find((e: any) => e.id === task?.assigned_to);
  const assigneeName = (assignee as any)?.full_name || (assignee as any)?.email;
  const relatedLabel = task?.related_id ? optionsFor(task?.related_type ?? "none").find(o => o.id === task.related_id)?.label : null;
  const sStyle = STATUS_STYLES[task?.status] ?? STATUS_STYLES.open;
  const overdue = !!task?.due_date && new Date(task.due_date).getTime() < Date.now() && task?.status !== "done" && task?.status !== "cancelled";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        {mode === "view" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${sStyle.dot}`} />
                {task?.title}
              </DialogTitle>
              <DialogDescription>
                {overdue ? `${t("tasks.overdue")} · ` : ""}
                {labels.status[task?.status] ?? task?.status} · {labels.priority[task?.priority] ?? task?.priority}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("tasks.form.status")}</Label>
                  <p>{labels.status[task?.status] ?? task?.status ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("tasks.form.priority")}</Label>
                  <p>{labels.priority[task?.priority] ?? task?.priority ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("tasks.form.dueDate")}</Label>
                  <p className={overdue ? "font-medium text-destructive" : ""}>{task?.due_date ? formatDate(task.due_date) : "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("tasks.form.assignee")}</Label>
                  <p>{assigneeName ?? "—"}</p>
                </div>
                {task?.related_type && (
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground">{t("tasks.form.relation")}</Label>
                    <p>{labels.related[task.related_type] ?? task.related_type}: {relatedLabel ?? "—"}</p>
                  </div>
                )}
              </div>
              {task?.description && (
                <div>
                  <Label className="text-xs text-muted-foreground">{t("tasks.form.description")}</Label>
                  <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3">{task.description}</p>
                </div>
              )}
            </div>
            <DialogFooter className="flex-row justify-between gap-2">
              <Button variant="outline" onClick={onDelete}><Trash2 className="mr-1 h-4 w-4" />{t("tasks.actions.delete")}</Button>
              <div className="flex gap-2">
                {relatedHref && (
                  <Button variant="outline" asChild>
                    <Link to={relatedHref as any}><ExternalLink className="mr-1 h-4 w-4" />{t("tasks.openRelated")}</Link>
                  </Button>
                )}
                <Button onClick={() => setMode("edit")}>{t("tasks.edit")}</Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("tasks.edit")}</DialogTitle>
              <DialogDescription>{t("tasks.editDescription")}</DialogDescription>
            </DialogHeader>
            <TaskForm form={form} setForm={setForm} employees={employees} optionsFor={optionsFor} />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setMode("view")}>{t("tasks.actions.cancel")}</Button>
              <Button onClick={() => {
                if (form.status === "waiting" && task?.status !== "waiting") {
                  onRequestWaiting(task);
                  return;
                }
                onSave({
                  title: form.title.trim(),
                  description: form.description.trim() || null,
                  status: form.status,
                  priority: form.priority,
                  due_date: form.due_date ? new Date(`${form.due_date}T12:00:00`).toISOString() : null,
                  assigned_to: form.assigned_to || null,
                  related_type: form.related_type !== "none" ? form.related_type : null,
                  related_id: form.related_type !== "none" && form.related_id ? form.related_id : null,
                });
              }} disabled={!form.title.trim()}>{t("tasks.actions.save")}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
