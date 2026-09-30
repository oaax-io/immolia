import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Calendar as CalIcon, MapPin, Clock, ChevronLeft, ChevronRight, Trash2, CheckSquare, Video, Link2, Copy, Flag, CalendarDays, CalendarRange, CalendarClock, List as ListIcon, ChevronsUpDown, Check, X, Mail, UserPlus, SlidersHorizontal } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { MicrosoftSyncButton } from "@/components/appointments/MicrosoftSyncDialog";
import { OutlookEventDialog } from "@/components/appointments/OutlookEventDialog";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useTranslation } from "react-i18next";
import { VideoCallDialog } from "@/components/video/VideoCallDialog";
import { holidayMap, holidaysForCanton, dateKey, type Holiday } from "@/lib/swiss-holidays";
import { ApptHover, TaskHover, HolidayHover } from "@/components/appointments/CalendarHover";
import { deleteToTrash } from "@/lib/trash";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_app/appointments")({
  head: () => ({ meta: [
    { title: "Termine | Immolia" },
    { name: "description", content: "Termine und Kalender in Immolia verwalten." },
    { property: "og:title", content: "Termine | Immolia" },
    { property: "og:description", content: "Termine und Kalender in Immolia verwalten." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AppointmentsPage,
});

const TYPES = ["viewing", "meeting", "call", "other"] as const;
const STATUSES = ["scheduled", "completed", "cancelled"] as const;
const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  scheduled: "default", completed: "secondary", cancelled: "outline",
};

const emptyForm = {
  title: "", appointment_type: "viewing", status: "scheduled",
  starts_at: "", ends_at: "",
  location: "", notes: "",
  client_id: "", property_id: "", assigned_to: "",
  extra_assignee_ids: [] as string[], external_invitees: [] as string[],
  repeat: "none", repeat_until: "",
  is_online: false, meeting_url: "",
};

function roomOf(a: any) {
  return a?.meeting_url || `termin-${a?.id}`;
}

function useApptLabels() {
  const { t } = useTranslation();
  return {
    types: {
      viewing: t("appointments.types.viewing"),
      meeting: t("appointments.types.meeting"),
      call: t("appointments.types.call"),
      other: t("appointments.types.other"),
    } as Record<string, string>,
    statuses: {
      scheduled: t("appointments.status.scheduled"),
      completed: t("appointments.status.completed"),
      cancelled: t("appointments.status.cancelled"),
    } as Record<string, string>,
  };
}

/* -------------------- Holiday hook -------------------- */

function useHolidays() {
  const canton = (typeof window !== "undefined" && localStorage.getItem("cal.canton")) || "ZH";
  const y = new Date().getFullYear();
  const map = useMemo(() => holidayMap([y - 1, y, y + 1, y + 2], canton, true), [canton, y]);
  return { canton, showUnpaid: true, map };
}

/* -------------------- Layer filter -------------------- */

type LayerKey = "holidays" | "birthdays" | "tasks" | "all" | "mine" | "online" | "busy";
const LAYERS: { key: LayerKey; label: string; dot: string }[] = [
  { key: "holidays", label: "Feiertage", dot: "bg-rose-500" },
  { key: "birthdays", label: "Geburtstage Kunden", dot: "bg-amber-500" },
  { key: "tasks", label: "Aufgaben", dot: "bg-emerald-500" },
  { key: "all", label: "Alle Termine", dot: "bg-primary" },
  { key: "mine", label: "Meine Termine", dot: "bg-sky-500" },
  { key: "online", label: "Online-Meetings", dot: "bg-violet-500" },
  { key: "busy", label: "Outlook-Belegungen", dot: "bg-muted-foreground" },
];
const DEFAULT_LAYERS: LayerKey[] = ["holidays", "birthdays", "tasks", "all", "busy"];

function useLayers() {
  const [layers, setLayers] = useState<LayerKey[]>(DEFAULT_LAYERS);
  useEffect(() => {
    try { const s = localStorage.getItem("cal.layers"); if (s) setLayers(JSON.parse(s)); } catch { /* ignore */ }
  }, []);
  const toggle = (k: LayerKey) => setLayers((prev) => {
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
    localStorage.setItem("cal.layers", JSON.stringify(next));
    return next;
  });
  return { layers, toggle, has: (k: LayerKey) => layers.includes(k) };
}

function LayerPanel({ layers, toggle }: { layers: LayerKey[]; toggle: (k: LayerKey) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Kalender-Ebenen einblenden">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Einblenden</p>
        <div className="space-y-0.5">
          {LAYERS.map((l) => {
            const on = layers.includes(l.key);
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => toggle(l.key)}
                aria-pressed={on}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] ${on ? l.dot : "border border-muted-foreground/40"}`}>
                  {on && <Check className="h-3 w-3 text-primary-foreground" />}
                </span>
                {l.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------- Page -------------------- */

function AppointmentsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...emptyForm });
  const [view, setView] = useState<"month" | "week" | "day" | "list">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const changeView = (v: string) => { setView(v as any); setAnchor(new Date()); };
  const holidays = useHolidays();
  const layer = useLayers();

  const { data: birthdays = [] } = useQuery({
    queryKey: ["client-birthdays"],
    queryFn: async () => (await supabase
      .from("client_self_disclosures")
      .select("client_id, birth_date, first_name, last_name, clients(full_name)")
      .not("birth_date", "is", null)).data ?? [],
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", "with-due"],
    queryFn: async () => (await supabase
      .from("tasks")
      .select("id, title, description, due_date, status, priority, related_type, related_id, assigned_to")
      .not("due_date", "is", null)).data ?? [],
  });

  const { data: appts = [] } = useQuery({
    queryKey: ["appointments"],
    queryFn: async () => (await supabase.from("appointments")
      .select("*, clients(id, full_name), properties(id, title)")
      .order("starts_at")).data ?? [],
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").order("full_name")).data ?? [],
  });
  const { data: properties = [] } = useQuery({
    queryKey: ["properties-min"],
    queryFn: async () => (await supabase.from("properties").select("id, title").order("title")).data ?? [],
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email, avatar_url").eq("is_active", true)).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error(t("appointments.toasts.titleRequired"));
      if (!form.starts_at) throw new Error(t("appointments.toasts.startRequired"));
      const start0 = new Date(form.starts_at);
      const end0 = form.ends_at ? new Date(form.ends_at) : new Date(start0.getTime() + 60 * 60 * 1000);
      const step = (d: Date): Date => {
        const n = new Date(d);
        if (form.repeat === "daily") n.setDate(n.getDate() + 1);
        else if (form.repeat === "weekly") n.setDate(n.getDate() + 7);
        else if (form.repeat === "biweekly") n.setDate(n.getDate() + 14);
        else if (form.repeat === "monthly") n.setMonth(n.getMonth() + 1);
        return n;
      };
      const until = form.repeat !== "none" && form.repeat_until ? new Date(`${form.repeat_until}T23:59:59`) : null;
      const occurrences: { s: Date; e: Date }[] = [{ s: start0, e: end0 }];
      if (until) {
        let s = step(start0), e = step(end0);
        while (s <= until && occurrences.length < 52) {
          occurrences.push({ s, e });
          s = step(s); e = step(e);
        }
      }
      const rows = occurrences.map(({ s, e }) => ({
        owner_id: user!.id,
        title: form.title.trim(),
        appointment_type: form.appointment_type as any,
        status: form.status as any,
        starts_at: s.toISOString(),
        ends_at: e.toISOString(),
        location: form.location || null,
        notes: form.notes || null,
        client_id: form.client_id || null,
        property_id: form.property_id || null,
        assigned_to: form.assigned_to || user!.id,
        extra_assignee_ids: form.extra_assignee_ids?.length ? form.extra_assignee_ids : null,
        external_invitees: form.external_invitees?.length ? form.external_invitees : null,
        is_online: form.is_online,
        meeting_url: form.is_online ? (form.meeting_url || `meet-${Math.random().toString(36).slice(2, 10)}`) : null,
      }));
      const { error } = await supabase.from("appointments").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t("appointments.toasts.created")); qc.invalidateQueries({ queryKey: ["appointments"] }); setForm({ ...emptyForm }); setOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { data, error } = await supabase.from("appointments").update(patch).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Der Termin konnte nicht geändert werden. Bitte prüfe deine Berechtigung.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appointments"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteToTrash("appointments", id);
    },
    onSuccess: () => { toast.success(t("appointments.toasts.deleted")); qc.invalidateQueries({ queryKey: ["appointments"] }); setEditId(null); },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["appointments"] }); },
  });

  const editing = appts.find((a: any) => a.id === editId);
  const selected = appts.find((a: any) => a.id === detailId);

  const { data: busyBlocks = [] } = useQuery({
    queryKey: ["calendar-busy-blocks"],
    enabled: layer.has("busy"),
    queryFn: async () => (await supabase.from("calendar_busy_blocks").select("id, user_id, provider_event_id, subject, is_private, is_cancelled, starts_at, ends_at, is_all_day")
      .gte("ends_at", new Date(Date.now() - 45 * 86400_000).toISOString()).order("starts_at").limit(2000)).data ?? [],
  });
  const visibleAppts = useMemo(() => {
    const base = layer.has("all") ? appts : appts.filter((a: any) =>
      (layer.has("mine") && user && (a.assigned_to === user.id || a.owner_id === user.id || (a.extra_assignee_ids ?? []).includes(user.id))) ||
      (layer.has("online") && a.is_online));
    if (!layer.has("busy")) return base;
    // Externe Outlook-Termine nur als „Beschäftigt“, ohne Inhalte
    const busy = (busyBlocks as any[]).map((b) => ({ id: `busy:${b.id}`, title: b.is_private || !b.subject ? "Beschäftigt (Outlook)" : `${b.is_cancelled ? "Abgesagt: " : ""}${b.subject}`, _pe: b.provider_event_id, starts_at: b.starts_at, ends_at: b.ends_at,
      owner_id: b.user_id, assigned_to: b.user_id, status: "scheduled", appointment_type: "other", location: null, _busy: true }));
    return [...base, ...busy];
  }, [appts, layer.layers, user, busyBlocks]);
  const [outlookId, setOutlookId] = useState<string | null>(null);
  const openAppt = (id: string) => {
    if (!id.startsWith("busy:")) return setDetailId(id);
    const b = (busyBlocks as any[]).find((x) => `busy:${x.id}` === id);
    if (b && b.user_id === user?.id) setOutlookId(b.provider_event_id);
  };
  const visibleTasks = layer.has("tasks") ? tasks : [];

  const calendarMarks = useMemo(() => {
    const map: Record<string, Holiday[]> = {};
    if (layer.has("holidays")) for (const [k, v] of Object.entries(holidays.map)) map[k] = v.map((h) => ({ ...h, paid: true }));
    if (layer.has("birthdays")) {
      const y = new Date().getFullYear();
      const seen = new Set<string>();
      for (const b of birthdays as any[]) {
        if (!b.birth_date || seen.has(b.client_id)) continue;
        seen.add(b.client_id);
        const name = b.clients?.full_name || [b.first_name, b.last_name].filter(Boolean).join(" ") || "Kunde";
        const md = String(b.birth_date).slice(5, 10);
        for (const yy of [y - 1, y, y + 1, y + 2]) {
          const key = `${yy}-${md}`;
          (map[key] ??= []).push({ date: key, name: `🎂 ${name}`, paid: false, scope: "national", cantons: [] });
        }
      }
    }
    return map;
  }, [holidays.map, birthdays, layer.layers]);

  const startNew = (preset?: Partial<typeof emptyForm>) => {
    const f: any = { ...emptyForm, mode: "time", duration: 60, ...preset };
    if (f.starts_at && !f.ends_at) {
      const d = new Date(f.starts_at);
      f.starts_at = localInput(d);
      f.ends_at = localInput(new Date(d.getTime() + 3600000));
    }
    setForm(f);
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <CalIcon className="h-8 w-8 text-[#6F6B94]" />
            {t("pages.appointments.title")}
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => startNew({ is_online: true, appointment_type: "meeting", title: "Online-Meeting" })}>
              <Video className="mr-1 h-4 w-4" />Online-Meeting
            </Button>
            <Button onClick={() => startNew()}><Plus className="mr-1 h-4 w-4" />{t("appointments.new")}</Button>
          </div>
        }
      />

      <OutlookEventDialog providerEventId={outlookId} onClose={() => setOutlookId(null)} employees={employees as any} currentUserId={user?.id} />
      <AppointmentDetailDialog
        appt={selected}
        employees={employees}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        onEdit={() => { setEditId(detailId); setDetailId(null); }}
        onCancel={() => { if (selected) update.mutate({ id: selected.id, patch: { status: "cancelled" } }, { onSuccess: () => toast.success("Termin abgesagt.") }); }}
        onMove={(starts_at, ends_at) => { if (selected) update.mutate({ id: selected.id, patch: { starts_at, ends_at } }, { onSuccess: () => toast.success("Termin verschoben.") }); }}
        saving={update.isPending}
      />
      <AppointmentDialog
        open={open}
        onOpenChange={setOpen}
        title={form.is_online ? "Online-Meeting planen" : t("appointments.new")}
        form={form}
        setForm={setForm}
        clients={clients}
        properties={properties}
        employees={employees}
        appts={appts}
        currentUserId={user?.id}
        onSubmit={() => create.mutate()}
        submitting={create.isPending}
      />

      <Tabs value={view} onValueChange={changeView} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 shadow-sm">
          {view !== "list" && <ToolbarNav view={view} anchor={anchor} setAnchor={setAnchor} />}
          <div className="ml-auto flex items-center gap-2">
            <TabsList className="h-9 rounded-lg bg-primary/15 p-1">
              <TabsTrigger value="month" className="gap-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                <CalendarDays className="h-4 w-4" />{t("appointments.tabs.month", { defaultValue: "Monat" })}
              </TabsTrigger>
              <TabsTrigger value="week" className="gap-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                <CalendarRange className="h-4 w-4" />{t("appointments.tabs.week", { defaultValue: "Woche" })}
              </TabsTrigger>
              <TabsTrigger value="day" className="gap-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                <CalendarClock className="h-4 w-4" />Tag
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">
                <ListIcon className="h-4 w-4" />{t("appointments.tabs.list")}
              </TabsTrigger>
            </TabsList>
            <MicrosoftSyncButton />
            <LayerPanel layers={layer.layers} toggle={layer.toggle} />
          </div>
        </div>


        <TabsContent value="month">
          <MonthView appts={visibleAppts} tasks={visibleTasks} employees={employees} holidays={calendarMarks} onOpen={openAppt} onCreateAt={(iso) => startNew({ starts_at: iso })} anchor={anchor} />
        </TabsContent>

        <TabsContent value="week">
          <WeekView appts={visibleAppts} tasks={visibleTasks} employees={employees} holidays={calendarMarks} onOpen={openAppt} onCreateAt={(iso) => startNew({ starts_at: iso })} anchor={anchor} />
        </TabsContent>

        <TabsContent value="day">
          <DayView appts={visibleAppts} tasks={visibleTasks} employees={employees} holidays={calendarMarks} onOpen={openAppt} onCreateAt={(iso) => startNew({ starts_at: iso })} anchor={anchor} />
        </TabsContent>

        <TabsContent value="list">
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div>
              <ListView
                appts={visibleAppts.filter((a: any) => !a._busy)}
                tasks={visibleTasks}
                employees={employees}
                onOpen={openAppt}
                onStatus={(id, status) => update.mutate({ id, patch: { status } })}
              />
            </div>

            {layer.has("holidays") && <HolidayList canton={holidays.canton} showUnpaid={holidays.showUnpaid} />}
          </div>
        </TabsContent>
      </Tabs>

      <AppointmentEditDialog
        appt={editing}
        appts={appts}
        currentUserId={user?.id}
        open={!!editId}
        onClose={() => setEditId(null)}
        clients={clients}
        properties={properties}
        employees={employees}
        onSave={(patch: any) => editing && update.mutate({ id: editing.id, patch }, { onSuccess: () => { toast.success(t("appointments.toasts.updated")); setEditId(null); } })}
        onDelete={async () => { if (editing && await confirm({ title: t("appointments.confirmDelete.title"), description: t("appointments.confirmDelete.description"), confirmText: t("appointments.confirmDelete.confirm") })) remove.mutate(editing.id); }}
      />
    </>
  );
}

function AppointmentDetailDialog({ appt, employees, open, onClose, onEdit, onCancel, onMove, saving }: {
  appt: any; employees: any[]; open: boolean; onClose: () => void; onEdit: () => void;
  onCancel: () => void; onMove: (start: string, end: string) => void; saving: boolean;
}) {
  const labels = useApptLabels();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveStart, setMoveStart] = useState("");
  const assignee = employees.find((e) => e.id === appt?.assigned_to);
  const extras = employees.filter((e) => (appt?.extra_assignee_ids ?? []).includes(e.id));
  useEffect(() => { setMoving(false); setMoveStart(appt?.starts_at ? localInput(new Date(appt.starts_at)) : ""); }, [appt?.id, appt?.starts_at]);
  const move = () => {
    if (!appt || !moveStart) return;
    const start = new Date(moveStart);
    if (Number.isNaN(start.getTime())) return;
    const duration = appt.ends_at ? new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime() : 3600000;
    if (duration <= 0) return;
    onMove(start.toISOString(), new Date(start.getTime() + duration).toISOString());
    setMoving(false);
  };
  return (
    <>
      <Dialog open={open && !!appt} onOpenChange={(value) => { if (!value) onClose(); }}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto">
          <DialogHeader className="pr-7">
            <DialogTitle className="break-words text-xl">{appt?.title}</DialogTitle>
            <DialogDescription>{appt && labels.types[appt.appointment_type]} · Immolia</DialogDescription>
          </DialogHeader>
          {appt && <div className="space-y-4 text-sm">
            <Badge variant={STATUS_VARIANTS[appt.status]}>{labels.statuses[appt.status]}</Badge>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">Beginn</p><p className="font-medium">{formatDateTime(appt.starts_at)}</p></div>
              <div><p className="text-xs text-muted-foreground">Ende</p><p className="font-medium">{appt.ends_at ? formatDateTime(appt.ends_at) : "–"}</p></div>
              {appt.location && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Ort</p><p className="break-words">{appt.location}</p></div>}
              {appt.clients?.full_name && <div><p className="text-xs text-muted-foreground">Kunde</p><p>{appt.clients.full_name}</p></div>}
              {appt.properties?.title && <div><p className="text-xs text-muted-foreground">Immobilie</p><p>{appt.properties.title}</p></div>}
              {(assignee || extras.length > 0) && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Zuständig</p><p>{[assignee, ...extras].filter(Boolean).map((e) => e.full_name || e.email).join(", ")}</p></div>}
              {appt.external_invitees?.length > 0 && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Externe Gäste</p><p className="break-words">{appt.external_invitees.join(", ")}</p></div>}
              {appt.notes && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Notizen</p><p className="whitespace-pre-wrap break-words">{appt.notes}</p></div>}
              {appt.is_online && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Online-Meeting</p><p className="break-all">{roomOf(appt)}</p></div>}
            </div>
            {moving && <div className="space-y-2 border-t pt-4">
              <Label htmlFor="move-start">Neuer Beginn</Label>
              <Input id="move-start" type="datetime-local" value={moveStart} onChange={(e) => setMoveStart(e.target.value)} />
              <p className="text-xs text-muted-foreground">Die bisherige Dauer bleibt erhalten.</p>
              <div className="flex gap-2"><Button onClick={move} disabled={!moveStart || saving}>Verschiebung speichern</Button><Button variant="ghost" onClick={() => setMoving(false)}>Zurück</Button></div>
            </div>}
          </div>}
          <DialogFooter className="flex-wrap gap-2 border-t pt-4 sm:justify-between">
            <Button variant="outline" onClick={onEdit}>Bearbeiten</Button>
            <div className="flex flex-wrap gap-2">
              {appt?.status !== "cancelled" && <><Button variant="outline" onClick={() => setMoving(true)} disabled={saving}>Verschieben</Button><Button variant="destructive" onClick={() => setConfirmCancel(true)} disabled={saving}>Absagen</Button></>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Termin absagen?</AlertDialogTitle><AlertDialogDescription>Der Termin bleibt als abgesagt im Kalender sichtbar.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Zurück</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={() => { onCancel(); setConfirmCancel(false); }}>Termin absagen</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* -------------------- Shared helpers -------------------- */

function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function HolidayChip({ h }: { h: Holiday }) {
  return (
    <span
      title={h.name}
      className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
        h.paid ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      }`}
    >
      <Flag className="h-3 w-3 shrink-0" />
      <span className="truncate">{h.name}</span>
    </span>
  );
}

function HolidayList({ canton, showUnpaid }: { canton: string; showUnpaid: boolean }) {
  const y = new Date().getFullYear();
  const today = dateKey(new Date());
  const items = [...holidaysForCanton(y, canton, showUnpaid), ...holidaysForCanton(y + 1, canton, showUnpaid)]
    .filter((h) => h.date >= today)
    .slice(0, 14);
  return (
    <Card className="h-fit">
      <CardContent className="p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Flag className="h-4 w-4 text-rose-500" /> Nächste Feiertage ({canton})</h3>
        <div className="space-y-2">
          {items.map((h) => (
            <div key={h.date + h.name} className="flex items-start justify-between gap-2 border-b pb-2 last:border-0">
              <div>
                <p className="text-sm font-medium">{h.name}</p>
                <p className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("de-CH", { weekday: "short", day: "2-digit", month: "long" }).format(new Date(h.date))}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------- Views -------------------- */

function ListView({
  appts, tasks = [], employees, onOpen, onStatus,
}: { appts: any[]; tasks?: any[]; employees: any[]; onOpen: (id: string) => void; onStatus: (id: string, s: string) => void }) {
  const { t } = useTranslation();
  const now = Date.now();
  const upcoming = appts.filter((a) => new Date(a.starts_at).getTime() >= now);
  const past = appts.filter((a) => new Date(a.starts_at).getTime() < now).reverse();
  const upcomingTasks = tasks
    .filter((tk) => tk.status !== "done" && tk.status !== "cancelled")
    .sort((a, b) => +new Date(a.due_date) - +new Date(b.due_date));

  return (
    <>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("appointments.sections.upcoming")}</h2>
      {upcoming.length === 0 ? (
        <EmptyState title={t("appointments.empty.title")} description={t("appointments.empty.description")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {upcoming.map((a) => <ApptCard key={a.id} a={a} employees={employees} onOpen={onOpen} onStatus={onStatus} />)}
        </div>
      )}

      {upcomingTasks.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <CheckSquare className="h-4 w-4 text-amber-500" /> Aufgaben mit Fälligkeitsdatum
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {upcomingTasks.map((tk) => (
              <TaskHover key={tk.id} task={tk} assignee={employees.find((e: any) => e.id === tk.assigned_to)}>
                <Link to="/tasks" className="flex items-center gap-2 rounded-xl border border-l-4 border-l-amber-500 bg-amber-50/40 p-3 text-sm transition hover:bg-accent dark:bg-amber-950/20">
                  <CheckSquare className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1 truncate font-medium">{tk.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(tk.due_date)}</span>
                </Link>
              </TaskHover>
            ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">{t("appointments.sections.past")}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {past.slice(0, 12).map((a) => <ApptCard key={a.id} a={a} employees={employees} dim onOpen={onOpen} onStatus={onStatus} />)}
          </div>
        </>
      )}
    </>
  );
}


function ApptCard({
  a, employees, dim, onOpen, onStatus,
}: { a: any; employees: any[]; dim?: boolean; onOpen: (id: string) => void; onStatus: (id: string, s: string) => void }) {
  const { t } = useTranslation();
  const labels = useApptLabels();
  const assignee = employees.find((e) => e.id === a.assigned_to);
  const [callOpen, setCallOpen] = useState(false);
  return (
    <>
      <VideoCallDialog open={callOpen} onOpenChange={setCallOpen} room={roomOf(a)} title={a.title} />
      <Card className={`cursor-pointer transition hover:shadow-soft ${dim ? "opacity-70" : ""} ${a.is_online ? "border-l-4 border-l-primary" : ""}`} onClick={() => onOpen(a.id)}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary">{labels.types[a.appointment_type]}</Badge>
              {a.is_online && <Badge className="gap-1"><Video className="h-3 w-3" />Online</Badge>}
            </div>
            <Badge variant={STATUS_VARIANTS[a.status]}>{labels.statuses[a.status]}</Badge>
          </div>
          <h3 className="mt-2 line-clamp-1 font-semibold">{a.title}</h3>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p className="flex items-center gap-1"><CalIcon className="h-3 w-3" />{formatDateTime(a.starts_at)}</p>
            {a.ends_at && <p className="flex items-center gap-1"><Clock className="h-3 w-3" />{t("appointments.card.until")} {formatDateTime(a.ends_at)}</p>}
            {a.location && !a.is_online && <p className="flex items-center gap-1"><MapPin className="h-3 w-3" />{a.location}</p>}
            {a.is_online && <p className="flex items-center gap-1"><Link2 className="h-3 w-3" />Raum: {roomOf(a)}</p>}
            {a.clients?.full_name && <p>{t("appointments.card.client")}: {a.clients.full_name}</p>}
            {a.properties?.title && <p>{t("appointments.card.property")}: {a.properties.title}</p>}
            {assignee && <p>{t("appointments.card.assignee")}: {assignee.full_name || assignee.email}</p>}
          </div>
          <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Select value={a.status} onValueChange={(v) => onStatus(a.id, v)}>
              <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{labels.statuses[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            {a.is_online && (
              <Button size="sm" variant="ghost" className="h-8" title="Meeting-Link kopieren"
                onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/meet/${roomOf(a)}`); toast.success("Link kopiert"); }}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" variant={a.is_online ? "default" : "outline"} className="h-8" onClick={() => setCallOpen(true)}>
              <Video className="mr-1 h-3.5 w-3.5" /> {a.is_online ? "Beitreten" : "Video"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ToolbarNav({ view, anchor, setAnchor }: { view: "month" | "week" | "day"; anchor: Date; setAnchor: (d: Date) => void }) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith("fr") ? "fr-CH" : "de-CH";
  const step = view === "month" ? 0 : view === "week" ? 7 : 1;
  const shift = (dir: 1 | -1) => {
    const d = new Date(anchor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else d.setTime(d.getTime() + dir * step * 86400000);
    setAnchor(d);
  };
  let label: string;
  if (view === "month") {
    label = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(anchor);
  } else if (view === "week") {
    const s = startOfWeek(anchor);
    const e = new Date(s.getTime() + 6 * 86400000);
    label = `${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(s)} – ${new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(e)}`;
  } else {
    label = new Intl.DateTimeFormat(locale, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(anchor);
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">Heute</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={de}
            selected={anchor}
            onSelect={(d) => { if (d) setAnchor(d); }}
            initialFocus
          />
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setAnchor(new Date())}>Zu heute springen</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
      <p className="ml-1 whitespace-nowrap text-sm font-semibold">{label}</p>
    </div>
  );
}

function WeekView({ appts, tasks = [], employees = [], holidays, onOpen, onCreateAt, anchor }: { appts: any[]; tasks?: any[]; employees?: any[]; holidays: Record<string, Holiday[]>; onOpen: (id: string) => void; onCreateAt: (iso: string) => void; anchor: Date }) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith("fr") ? "fr-CH" : "de-CH";
  const weekStart = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 86400000));
  const byDay = useMemo(() => {
    const map: Record<string, { appts: any[]; tasks: any[] }> = {};
    days.forEach((d) => { map[d.toDateString()] = { appts: [], tasks: [] }; });
    for (const a of appts) {
      const key = new Date(a.starts_at).toDateString();
      if (key in map) map[key].appts.push(a);
    }
    for (const tk of tasks) {
      const key = new Date(tk.due_date).toDateString();
      if (key in map) map[key].tasks.push(tk);
    }
    return map;
  }, [appts, tasks, weekStart]);

  return (
    <div>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const isToday = d.toDateString() === new Date().toDateString();
          const hol = holidays[dateKey(d)] ?? [];
          const paidHol = hol.some((h) => h.paid);
          const items = byDay[d.toDateString()] ?? { appts: [], tasks: [] };
          const total = items.appts.length + items.tasks.length;
          return (
            <div
              key={d.toISOString()}
              className={`group rounded-xl border p-3 ${paidHol ? "bg-rose-50/60 dark:bg-rose-950/20" : "bg-card"} ${isToday ? "ring-2 ring-primary/30" : ""}`}
            >
              <div className="mb-2 flex items-center gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)}
                </p>
                {hol.length > 0 && (
                  <HolidayHover holidays={hol}>
                    <span
                      className={`flex min-w-0 flex-1 cursor-default items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium ${paidHol ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
                    >
                      <Flag className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{hol[0].name}{hol.length > 1 ? ` +${hol.length - 1}` : ""}</span>
                    </span>
                  </HolidayHover>
                )}
                <p className={`ml-auto text-lg font-bold ${isToday ? "text-primary" : ""}`}>{d.getDate()}</p>
              </div>
              <div className="space-y-1.5">

                {total === 0 && hol.length === 0 && (
                  <button
                    onClick={() => { const dt = new Date(d); dt.setHours(9, 0, 0, 0); onCreateAt(localInput(dt)); }}
                    className="w-full rounded-md border border-dashed py-2 text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100"
                  >+ Termin</button>
                )}
                {items.appts.map((a) => (
                  <ApptHover key={a.id} appt={a} assignee={employees.find((e: any) => e.id === a.assigned_to)} room={roomOf(a)}>
                    <button
                      onClick={() => onOpen(a.id)}
                      className={`block w-full rounded-md border p-2 text-left text-xs transition hover:bg-accent ${a.is_online ? "border-l-4 border-l-primary bg-primary/5" : "bg-accent/30"}`}
                    >
                      <p className="flex items-center gap-1 font-medium text-primary">
                        {a.is_online && <Video className="h-3 w-3" />}
                        {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(a.starts_at))}
                      </p>
                      <p className="line-clamp-2 font-medium">{a.title}</p>
                      {a.location && !a.is_online && <p className="line-clamp-1 text-muted-foreground">{a.location}</p>}
                    </button>
                  </ApptHover>
                ))}
                {items.tasks.map((tk: any) => (
                  <TaskHover key={tk.id} task={tk} assignee={employees.find((e: any) => e.id === tk.assigned_to)}>
                    <Link
                      to="/tasks"
                      className={`block w-full rounded-md border border-l-4 p-2 text-left text-xs transition hover:bg-accent ${tk.status === "done" ? "border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20" : "border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20"}`}
                    >
                      <p className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                        <CheckSquare className="h-3 w-3" />
                        {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(tk.due_date))}
                      </p>
                      <p className={`line-clamp-2 font-medium ${tk.status === "done" ? "line-through text-muted-foreground" : ""}`}>{tk.title}</p>
                    </Link>
                  </TaskHover>
                ))}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

const DAY_START = 7;
const DAY_END = 21;

function DayView({ appts, tasks = [], employees = [], holidays, onOpen, onCreateAt, anchor }: { appts: any[]; tasks?: any[]; employees?: any[]; holidays: Record<string, Holiday[]>; onOpen: (id: string) => void; onCreateAt: (iso: string) => void; anchor: Date }) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith("fr") ? "fr-CH" : "de-CH";
  const day = useMemo(() => { const d = new Date(anchor); d.setHours(0, 0, 0, 0); return d; }, [anchor]);
  const key = day.toDateString();
  const dayAppts = appts.filter((a) => new Date(a.starts_at).toDateString() === key);
  const dayTasks = tasks.filter((tk) => new Date(tk.due_date).toDateString() === key);
  const hol = holidays[dateKey(day)] ?? [];
  const hours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);

  return (
    <div>
      {hol.length > 0 && (
        <div className="mb-3 space-y-1">
          {hol.map((h) => (
            <HolidayHover key={h.name} holidays={[h]}><span className="block"><HolidayChip h={h} /></span></HolidayHover>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        {hours.map((h) => {
          const slotAppts = dayAppts.filter((a) => new Date(a.starts_at).getHours() === h);
          const slotTasks = dayTasks.filter((tk) => new Date(tk.due_date).getHours() === h);
          return (
            <div key={h} className="group flex gap-3 border-b px-3 py-1.5 last:border-0 hover:bg-muted/40">
              <div className="w-14 shrink-0 pt-1 text-xs font-medium text-muted-foreground">{String(h).padStart(2, "0")}:00</div>
              <div className="flex-1 space-y-1 py-0.5">
                {slotAppts.length === 0 && slotTasks.length === 0 && (
                  <button
                    onClick={() => { const dt = new Date(day); dt.setHours(h, 0, 0, 0); onCreateAt(localInput(dt)); }}
                    className="text-xs text-muted-foreground opacity-0 transition group-hover:opacity-100"
                  >+ Termin um {String(h).padStart(2, "0")}:00</button>
                )}
                {slotAppts.map((a) => (
                  <ApptHover key={a.id} appt={a} assignee={employees.find((e: any) => e.id === a.assigned_to)} room={roomOf(a)}>
                    <button onClick={() => onOpen(a.id)}
                      className={`flex w-full items-center gap-2 rounded-md border-l-4 px-2 py-1.5 text-left text-sm transition hover:opacity-90 ${a.is_online ? "border-l-primary bg-primary/10" : "border-l-accent-foreground/40 bg-accent/40"}`}>
                      {a.is_online && <Video className="h-3.5 w-3.5 text-primary" />}
                      <span className="font-medium">{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(a.starts_at))}</span>
                      <span className="truncate">{a.title}</span>
                    </button>
                  </ApptHover>
                ))}
                {slotTasks.map((tk: any) => (
                  <TaskHover key={tk.id} task={tk} assignee={employees.find((e: any) => e.id === tk.assigned_to)}>
                    <Link to="/tasks" className="flex w-full items-center gap-2 rounded-md border-l-4 border-l-amber-500 bg-amber-500/10 px-2 py-1.5 text-sm text-amber-700 dark:text-amber-400">
                      <CheckSquare className="h-3.5 w-3.5" /> <span className="truncate">{tk.title}</span>
                    </Link>
                  </TaskHover>
                ))}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({ appts, tasks, employees = [], holidays, onOpen, onCreateAt, anchor }: { appts: any[]; tasks: any[]; employees?: any[]; holidays: Record<string, Holiday[]>; onOpen: (id: string) => void; onCreateAt: (iso: string) => void; anchor: Date }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("fr") ? "fr-CH" : "de-CH";

  const { gridStart, gridDays, monthIdx } = useMemo(() => {
    const first = new Date(anchor); first.setDate(1); first.setHours(0, 0, 0, 0);
    const dow = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(first.getDate() - dow);
    return {
      gridStart: start,
      gridDays: Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86400000)),
      monthIdx: first.getMonth(),
    };
  }, [anchor]);

  const byDay = useMemo(() => {
    const map: Record<string, { appts: any[]; tasks: any[] }> = {};
    gridDays.forEach((d) => { map[d.toDateString()] = { appts: [], tasks: [] }; });
    for (const a of appts) {
      const key = new Date(a.starts_at).toDateString();
      if (key in map) map[key].appts.push(a);
    }
    for (const tk of tasks) {
      const key = new Date(tk.due_date).toDateString();
      if (key in map) map[key].tasks.push(tk);
    }
    return map;
  }, [appts, tasks, gridDays]);

  const todayKey = new Date().toDateString();
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(gridStart.getTime() + i * 86400000);
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  });

  return (
    <div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border">
        {weekdays.map((w) => (
          <div key={w} className="bg-muted/50 px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">{w}</div>
        ))}
        {gridDays.map((d) => {
          const inMonth = d.getMonth() === monthIdx;
          const isToday = d.toDateString() === todayKey;
          const isWeekend = [0, 6].includes(d.getDay());
          const hol = holidays[dateKey(d)] ?? [];
          const paidHol = hol.some((h) => h.paid);
          const items = byDay[d.toDateString()] ?? { appts: [], tasks: [] };
          const all = [
            ...items.appts.map((a) => ({ kind: "appt" as const, id: a.id, time: a.starts_at, title: a.title, status: a.status, online: a.is_online, ref: a })),
            ...items.tasks.map((tk) => ({ kind: "task" as const, id: tk.id, time: tk.due_date, title: tk.title, status: tk.status, online: false, ref: tk })),
          ].sort((a, b) => +new Date(a.time) - +new Date(b.time));
          return (
            <div
              key={d.toISOString()}
              className={`group relative min-h-[110px] p-1.5 ${paidHol ? "bg-rose-50 dark:bg-rose-950/25" : isWeekend ? "bg-muted/30" : "bg-card"} ${inMonth ? "" : "opacity-50"} ${isToday ? "ring-2 ring-inset ring-primary/40" : ""}`}
            >
              <div className="mb-1 flex items-center gap-1">
                <button
                  onClick={() => { const dt = new Date(d); dt.setHours(9, 0, 0, 0); onCreateAt(localInput(dt)); }}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-accent group-hover:opacity-100"
                  title="Termin anlegen"
                ><Plus className="h-3 w-3" /></button>
                {hol.length > 0 && (
                  <HolidayHover holidays={hol}>
                    <span
                      className={`flex min-w-0 flex-1 cursor-default items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium ${hol.some((h) => h.paid) ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
                    >
                      <Flag className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{hol[0].name}{hol.length > 1 ? ` +${hol.length - 1}` : ""}</span>
                    </span>
                  </HolidayHover>
                )}
                <span className={`ml-auto text-xs font-semibold ${isToday ? "text-primary" : paidHol ? "text-rose-600 dark:text-rose-300" : ""}`}>{d.getDate()}</span>
              </div>
              <div className="space-y-1">
                {all.slice(0, hol.length ? 2 : 3).map((it) => (

                  it.kind === "appt" ? (
                    <ApptHover key={`a-${it.id}`} appt={it.ref} assignee={employees.find((e: any) => e.id === it.ref.assigned_to)} room={roomOf(it.ref)}>
                      <button
                        onClick={() => onOpen(it.id)}
                        className="flex w-full items-center gap-1 truncate rounded border-l-2 border-l-primary bg-primary/10 px-1.5 py-0.5 text-left text-[11px] font-medium text-primary hover:bg-primary/20"
                      >
                        {it.online && <Video className="h-3 w-3 shrink-0" />}
                        <span className="truncate">
                          {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(it.time))} {it.title}
                        </span>
                      </button>
                    </ApptHover>
                  ) : (
                    <TaskHover key={`t-${it.id}`} task={it.ref} assignee={employees.find((e: any) => e.id === it.ref.assigned_to)}>
                      <Link
                        to="/tasks"
                        className={`flex w-full items-center gap-1 truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[11px] font-medium hover:opacity-80 ${it.status === "done" ? "border-l-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 line-through" : "border-l-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}
                      >
                        <CheckSquare className="h-3 w-3 shrink-0" />
                        <span className="truncate">{it.title}</span>
                      </Link>
                    </TaskHover>
                  )
                ))}

                {all.length > (hol.length ? 2 : 3) && (
                  <p className="px-1 text-[10px] text-muted-foreground">+{all.length - (hol.length ? 2 : 3)} {t("appointments.month.more", { defaultValue: "weitere" })}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------- Forms -------------------- */

const DURATIONS = [
  { m: 15, l: "15 Min" }, { m: 30, l: "30 Min" }, { m: 60, l: "1 Std" },
  { m: 90, l: "1.5 Std" }, { m: 120, l: "2 Std" }, { m: 180, l: "3 Std" },
];

function addMin(local: string, min: number) {
  return localInput(new Date(new Date(local).getTime() + min * 60000));
}

function deriveTiming(starts: string, ends: string) {
  if (!starts) return { mode: "time", duration: 60, repeat: "none", repeat_until: "" };
  const s = new Date(starts), e = ends ? new Date(ends) : null;
  const diff = e ? Math.round((e.getTime() - s.getTime()) / 60000) : 60;
  const midnight = s.getHours() === 0 && s.getMinutes() === 0 && e && e.getHours() === 0 && e.getMinutes() === 0;
  if (midnight && diff === 1440) return { mode: "time", duration: -1, repeat: "none", repeat_until: "" };
  if (midnight && diff === 2880) return { mode: "time", duration: -1, repeat: "none", repeat_until: "" };
  return { mode: "time", duration: DURATIONS.some((d) => d.m === diff) ? diff : -1, repeat: "none", repeat_until: "" };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`min-w-0 truncate rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
      {children}
    </button>
  );
}

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4), m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

function DatePickerField({ value, onChange, disabled }: { value: string; onChange: (date: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button variant="outline" className={`w-full justify-start font-normal ${!value ? "text-muted-foreground" : ""}`}>
          <CalIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{value ? format(new Date(`${value}T12:00`), "EEE, dd. MMM yyyy", { locale: de }) : "Datum wählen"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected || new Date()}
          onSelect={(d) => { if (d) { onChange(format(d, "yyyy-MM-dd")); setOpen(false); } }}
          locale={de}
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (time: string) => void; disabled?: boolean }) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full font-normal">
        <SelectValue placeholder="Uhrzeit" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {TIME_OPTIONS.map((tm) => <SelectItem key={tm} value={tm}>{tm}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function initialsOf(name?: string, email?: string) {
  const src = (name || email || "?").trim();
  return src.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function useTriggerWidth(open: boolean) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [w, setW] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (open && ref.current) setW(ref.current.offsetWidth);
  }, [open]);
  return { ref, style: w ? { width: w } : undefined };
}

function SearchPicker({
  value, onChange, options, placeholder, emptyLabel,
}: { value: string; onChange: (v: string) => void; options: { id: string; label: string }[]; placeholder: string; emptyLabel: string }) {
  const [open, setOpen] = useState(false);
  const { ref: triggerRef, style: popStyle } = useTriggerWidth(open);
  const current = options.find((o) => o.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} type="button" variant="outline" className="h-9 w-full justify-between px-3 font-normal">
          <span className={`truncate ${current ? "" : "text-muted-foreground"}`}>{current?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={popStyle}>
        <Command>
          <CommandInput placeholder="Suchen…" />
          <CommandList className="max-h-64">
            <CommandEmpty>Keine Treffer</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none__" onSelect={() => { onChange(""); setOpen(false); }}>
                <span className="text-muted-foreground">{emptyLabel}</span>
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o.id} value={`${o.label} ${o.id}`} onSelect={() => { onChange(o.id); setOpen(false); }}>
                  <Check className={`mr-2 h-3.5 w-3.5 ${o.id === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AssigneeMultiPicker({
  employees, primary, extraIds, onChange,
}: { employees: any[]; primary: string; extraIds: string[]; onChange: (primary: string, extra: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const { ref: triggerRef, style: popStyle } = useTriggerWidth(open);
  const selected = [primary, ...extraIds].filter(Boolean);
  const toggle = (id: string) => {
    let next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    onChange(next[0] ?? "", next.slice(1));
  };
  const selectedEmps = selected.map((id) => employees.find((e: any) => e.id === id)).filter(Boolean);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={triggerRef} type="button" variant="outline" className="h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal">
          {selectedEmps.length ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {selectedEmps.map((e: any) => (
                <span key={e.id} className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">
                  <Avatar className="h-4 w-4"><AvatarImage src={e.avatar_url ?? undefined} /><AvatarFallback className="text-[8px]">{initialsOf(e.full_name, e.email)}</AvatarFallback></Avatar>
                  <span className="max-w-28 truncate">{e.full_name || e.email}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">Personen wählen…</span>
          )}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={popStyle}>
        <Command>
          <CommandInput placeholder="Suchen…" />
          <CommandList className="max-h-64">
            <CommandEmpty>Keine Treffer</CommandEmpty>
            <CommandGroup>
              {employees.map((e: any) => {
                const sel = selected.includes(e.id);
                return (
                  <CommandItem key={e.id} value={`${e.full_name || ""} ${e.email || ""} ${e.id}`} onSelect={() => toggle(e.id)} className={sel ? "bg-primary/15" : ""}>
                    <span className={`mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${sel ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 bg-background"}`}>
                      {sel && <Check className="h-3 w-3" />}
                    </span>
                    <Avatar className="mr-2 h-5 w-5"><AvatarImage src={e.avatar_url ?? undefined} /><AvatarFallback className="text-[9px]">{initialsOf(e.full_name, e.email)}</AvatarFallback></Avatar>
                    <span className={`truncate ${sel ? "font-medium" : ""}`}>{e.full_name || e.email}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ExternalInvitees({ emails, onChange }: { emails: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast.error("Bitte eine gültige E-Mail-Adresse eingeben."); return; }
    if (emails.includes(v)) { setDraft(""); return; }
    onChange([...emails, v]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="name@beispiel.ch"
          className="h-9"
        />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={add}>
          <UserPlus className="mr-1 h-3.5 w-3.5" />Hinzufügen
        </Button>
      </div>
      {emails.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {emails.map((m) => (
            <span key={m} className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
              <Mail className="h-3 w-3 text-muted-foreground" />
              {m}
              <button type="button" onClick={() => onChange(emails.filter((e) => e !== m))} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AppointmentForm({
  form, setForm, clients, properties, employees, appts = [], currentUserId, selfId,
}: { form: any; setForm: (f: any) => void; clients: any[]; properties: any[]; employees: any[]; appts?: any[]; currentUserId?: string; selfId?: string }) {
  const { t } = useTranslation();
  const labels = useApptLabels();
  const duration: number = form.duration ?? 60;

  const setStartDate = (date: string) => {
    if (!date) return;
    const time = form.starts_at?.slice(11, 16) || "09:00";
    const s = `${date}T${time}`;
    setForm({ ...form, starts_at: s, ends_at: duration > 0 ? addMin(s, duration) : (form.ends_at || addMin(s, 60)) });
  };
  const setStartTime = (time: string) => {
    if (!time || !form.starts_at) return;
    const s = `${form.starts_at.slice(0, 10)}T${time}`;
    setForm({ ...form, starts_at: s, ends_at: duration > 0 ? addMin(s, duration) : (form.ends_at || addMin(s, 60)) });
  };
  const setEndDate = (date: string) => {
    if (!date || !form.ends_at) return;
    setForm({ ...form, ends_at: `${date}T${form.ends_at.slice(11, 16) || "10:00"}` });
  };
  const setEndTime = (time: string) => {
    if (!time || !form.ends_at) return;
    setForm({ ...form, ends_at: `${form.ends_at.slice(0, 10)}T${time}` });
  };
  const setDuration = (m: number) => {
    setForm({ ...form, duration: m, ends_at: form.starts_at && m > 0 ? addMin(form.starts_at, m) : form.ends_at });
  };
  const REPEATS = [
    { v: "none", l: "Keine" },
    { v: "daily", l: "Täglich" },
    { v: "weekly", l: "Wöchentlich" },
    { v: "biweekly", l: "2-wöchentlich" },
    { v: "monthly", l: "Monatlich" },
  ];

  const conflicts = useMemo(() => {
    if (!form.starts_at) return [];
    const s = new Date(form.starts_at).getTime();
    const e = form.ends_at ? new Date(form.ends_at).getTime() : s + 3600000;
    if (!(e > s)) return [];
    const who = form.assigned_to || currentUserId;
    return appts.filter((a: any) => {
      if (a.id === selfId || a.status === "cancelled") return false;
      if (who && (a.assigned_to || a.owner_id) !== who) return false;
      const as = new Date(a.starts_at).getTime();
      const ae = a.ends_at ? new Date(a.ends_at).getTime() : as + 3600000;
      return as < e && ae > s;
    });
  }, [form.starts_at, form.ends_at, form.assigned_to, appts, currentUserId, selfId]);

  const endInvalid = form.starts_at && form.ends_at && new Date(form.ends_at) <= new Date(form.starts_at);

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
      {/* Left: essentials */}
      <div className="space-y-4">
        <div>
          <Label>{t("appointments.form.title")} *</Label>
          <Input className="h-10 font-medium" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("appointments.form.titlePlaceholder")} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("appointments.form.type")}</Label>
            <Select value={form.appointment_type} onValueChange={(v) => setForm({ ...form, appointment_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map(ty => <SelectItem key={ty} value={ty}>{labels.types[ty]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("appointments.form.status")}</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{labels.statuses[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <Section title="Zeitpunkt">
          <div className="space-y-3">
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-3">
                  <Label>{t("appointments.form.start")} *</Label>
                  <DatePickerField
                    value={form.starts_at ? form.starts_at.slice(0, 10) : ""}
                    onChange={setStartDate}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Uhrzeit</Label>
                  <TimeSelect
                    value={form.starts_at?.slice(11, 16) || ""}
                    onChange={setStartTime}
                  />
                </div>
              </div>
              <div>
                <Label>Dauer</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {DURATIONS.map((d) => <Chip key={d.m} active={duration === d.m} onClick={() => setDuration(d.m)}>{d.l}</Chip>)}
                  <Chip active={duration === -1} onClick={() => setForm({ ...form, duration: -1 })}>Individuell</Chip>
                </div>
              </div>
              <div>
                <Label>{t("appointments.form.end")}</Label>
                <div className="grid grid-cols-5 gap-2">
                  <div className="col-span-3">
                    <DatePickerField
                      value={form.ends_at ? form.ends_at.slice(0, 10) : ""}
                      onChange={setEndDate}
                      disabled={duration !== -1}
                    />
                  </div>
                  <div className="col-span-2">
                    <TimeSelect
                      value={form.ends_at?.slice(11, 16) || ""}
                      onChange={setEndTime}
                      disabled={duration !== -1}
                    />
                  </div>
                </div>
                {endInvalid && <p className="mt-1 text-xs text-destructive">Ende muss nach dem Beginn liegen.</p>}
              </div>
            </div>
            <div>
              <Label>Serientermin</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {REPEATS.map((r) => (
                  <Chip key={r.v} active={(form.repeat ?? "none") === r.v} onClick={() => setForm({ ...form, repeat: r.v, repeat_until: r.v === "none" ? "" : form.repeat_until })}>{r.l}</Chip>
                ))}
              </div>
              {form.repeat && form.repeat !== "none" && (
                <div className="mt-2">
                  <Label>Wiederholen bis</Label>
                  <DatePickerField
                    value={form.repeat_until || ""}
                    onChange={(d) => setForm({ ...form, repeat_until: d })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Es werden alle Termine der Serie bis zu diesem Datum erstellt (max. 52).</p>
                </div>
              )}
            </div>
          {conflicts.length > 0 && (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-destructive">
                <Flag className="h-3.5 w-3.5" />Terminkollision: {conflicts.length} überschneidende{conflicts.length === 1 ? "r Termin" : " Termine"}
              </p>
              <ul className="mt-1.5 space-y-0.5 text-foreground/80">
                {conflicts.slice(0, 4).map((c: any) => (
                  <li key={c.id} className="truncate">• {c.title} – {formatDateTime(c.starts_at)}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <div>
          <Label>{t("appointments.form.notes")}</Label>
          <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>

      {/* Right: location & assignment */}
      <div className="space-y-4 rounded-lg bg-muted/40 p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground">Videoraum wird automatisch erstellt</p>
            </div>
            <Switch checked={!!form.is_online} onCheckedChange={(v) => setForm({ ...form, is_online: v })} />
          </div>
          {form.is_online ? (
            <div>
              <Label>Raumname (optional)</Label>
              <Input value={form.meeting_url} onChange={(e) => setForm({ ...form, meeting_url: e.target.value.replace(/\s+/g, "-").toLowerCase() })} placeholder="wird automatisch generiert" />
            </div>
          ) : (
            <div>
              <Label>{t("appointments.form.location")}</Label>
              <AddressAutocomplete
                value={form.location}
                onChange={(v) => setForm({ ...form, location: v })}
                onSelect={(s) => setForm({ ...form, location: s.label })}
                placeholder={t("appointments.form.locationPlaceholder")}
              />
            </div>
          )}
        </div>

        <Section title="Zuweisung">
          <div className="space-y-3">
            <div>
              <Label>{t("appointments.form.assignee")}</Label>
              <AssigneeMultiPicker
                employees={employees}
                primary={form.assigned_to}
                extraIds={form.extra_assignee_ids ?? []}
                onChange={(p, extra) => setForm({ ...form, assigned_to: p, extra_assignee_ids: extra })}
              />
            </div>
            <div>
              <Label>{t("appointments.form.client")}</Label>
              <SearchPicker
                value={form.client_id}
                onChange={(v) => setForm({ ...form, client_id: v })}
                options={clients.map((c: any) => ({ id: c.id, label: c.full_name }))}
                placeholder={t("appointments.form.clientPlaceholder")}
                emptyLabel={t("appointments.form.clientNone")}
              />
            </div>
            <div>
              <Label>{t("appointments.form.property")}</Label>
              <SearchPicker
                value={form.property_id}
                onChange={(v) => setForm({ ...form, property_id: v })}
                options={properties.map((p: any) => ({ id: p.id, label: p.title }))}
                placeholder={t("appointments.form.propertyPlaceholder")}
                emptyLabel={t("appointments.form.propertyNone")}
              />
            </div>
            <div>
              <Label>Externe Gäste (E-Mail)</Label>
              <ExternalInvitees
                emails={form.external_invitees ?? []}
                onChange={(v) => setForm({ ...form, external_invitees: v })}
              />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function AppointmentDialog({
  open, onOpenChange, title, form, setForm, clients, properties, employees, onSubmit, submitting, appts, currentUserId,
}: any) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-full max-w-3xl overflow-hidden p-0">
        <div className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-2 text-xl"><CalIcon className="h-5 w-5 text-primary" />{title}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <AppointmentForm form={form} setForm={setForm} clients={clients} properties={properties} employees={employees} appts={appts} currentUserId={currentUserId} />
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("appointments.actions.cancel")}</Button>
            <Button onClick={onSubmit} disabled={submitting}>{t("appointments.actions.save")}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentEditDialog({
  appt, open, onClose, clients, properties, employees, onSave, onDelete, appts, currentUserId,
}: any) {
  const { t } = useTranslation();
  const [form, setForm] = useState<any>({ ...emptyForm });
  const [callOpen, setCallOpen] = useState(false);

  useEffect(() => {
    if (appt) {
      setForm({
        title: appt.title ?? "",
        appointment_type: appt.appointment_type ?? "viewing",
        status: appt.status ?? "scheduled",
        starts_at: appt.starts_at ? localInput(new Date(appt.starts_at)) : "",
        ends_at: appt.ends_at ? localInput(new Date(appt.ends_at)) : "",
        location: appt.location ?? "",
        notes: appt.notes ?? "",
        client_id: appt.client_id ?? "",
        property_id: appt.property_id ?? "",
        assigned_to: appt.assigned_to ?? "",
        extra_assignee_ids: appt.extra_assignee_ids ?? [],
        external_invitees: appt.external_invitees ?? [],
        is_online: !!appt.is_online,
        meeting_url: appt.meeting_url ?? "",
        ...deriveTiming(appt.starts_at ? localInput(new Date(appt.starts_at)) : "", appt.ends_at ? localInput(new Date(appt.ends_at)) : ""),
      });
    }
  }, [appt]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6">
          <DialogTitle>{t("appointments.edit")}</DialogTitle>
          <DialogDescription>{t("appointments.editDescription")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {appt?.is_online && (
          <>
            <VideoCallDialog open={callOpen} onOpenChange={setCallOpen} room={roomOf(appt)} title={appt.title} />
            <div className="mt-4 flex items-center gap-2 rounded-xl border bg-primary/5 p-3">
              <Button size="sm" onClick={() => setCallOpen(true)}><Video className="mr-1 h-4 w-4" />Meeting beitreten</Button>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/meet/${roomOf(appt)}`); toast.success("Link kopiert"); }}>
                <Copy className="mr-1 h-4 w-4" />Link kopieren
              </Button>
            </div>
          </>
        )}
        <div className="my-4">
          <AppointmentForm form={form} setForm={setForm} clients={clients} properties={properties} employees={employees} appts={appts} currentUserId={currentUserId} selfId={appt?.id} />
        </div>
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-2 border-t px-4 py-4 sm:px-6">
          <Button variant="outline" onClick={onDelete}><Trash2 className="mr-1 h-4 w-4" />{t("appointments.actions.delete")}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{t("appointments.actions.close")}</Button>
            <Button onClick={() => onSave({
              title: form.title.trim(),
              appointment_type: form.appointment_type,
              status: form.status,
              starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : appt.starts_at,
              ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
              location: form.location || null,
              notes: form.notes || null,
              client_id: form.client_id || null,
              property_id: form.property_id || null,
              assigned_to: form.assigned_to || null,
              extra_assignee_ids: form.extra_assignee_ids?.length ? form.extra_assignee_ids : null,
              external_invitees: form.external_invitees?.length ? form.external_invitees : null,
              is_online: form.is_online,
              meeting_url: form.is_online ? (form.meeting_url || `meet-${Math.random().toString(36).slice(2, 10)}`) : null,
            })} disabled={!form.title.trim() || !form.starts_at}>{t("appointments.actions.save")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
