import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Search, Mail, Phone, Target, LayoutGrid, List as ListIcon, Columns3, Archive, ArchiveRestore, Trash2, UserCog, MoreHorizontal, X, Link2, CornerDownRight, Users, ShoppingBag, Home, Banknote, CheckCircle2, Ban, Crown, Check, ChevronDown } from "lucide-react";
import { ClientKanban } from "@/components/clients/ClientKanban";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getBackendErrorMessage, isBackendUnavailableError, unwrapServerResult } from "@/lib/backend-errors";
import { toast } from "sonner";
import { clientTypeLabels, formatCurrency } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { getClients } from "@/lib/crm.functions";
import { ClientWizard } from "@/components/clients/ClientWizard";

import { ClientDetailDialog } from "@/components/clients/ClientDetailDialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useTranslation } from "react-i18next";
import { AssigneeAvatars, AssigneePicker, initials, useClientAssignees } from "@/components/clients/ClientAssignees";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ClientPinButton, useClientPins } from "@/components/clients/ClientPin";
import { deleteToTrash } from "@/lib/trash";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/clients/")({ component: ClientsPage });

const TYPES = ["buyer","seller","owner","tenant","landlord","investor","other"] as const;

const clientTypeBadgeClass: Record<string, string> = {
  buyer:     "bg-cyan-500/15 text-cyan-700 border-cyan-500/30 dark:text-cyan-300",
  seller:    "bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-300",
  owner:     "bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-300",
  tenant:    "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300",
  landlord:  "bg-pink-500/15 text-pink-700 border-pink-500/30 dark:text-pink-300",
  investor:  "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300",
  other:     "bg-stone-500/15 text-stone-700 border-stone-500/30 dark:text-stone-300",
};
function typeBadge(t: string) {
  return clientTypeBadgeClass[t] ?? clientTypeBadgeClass.other;
}
function BudgetBar({
  min,
  max,
  compact,
}: {
  min?: number | string | null;
  max?: number | string | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const nMin = min != null && min !== "" ? Number(min) : 0;
  const nMax = max != null && max !== "" ? Number(max) : 0;
  const hasMin = nMin > 0;
  const hasMax = nMax > 0;
  if (!hasMin && !hasMax) return <span className="text-muted-foreground">—</span>;
  const scale = nMax > 0 ? nMax : nMin;
  const leftPct = hasMin && hasMax ? Math.min(98, Math.max(0, Math.round((nMin / scale) * 100))) : 0;
  const fillPct = hasMax ? Math.max(2, 100 - leftPct) : 100;
  const label =
    hasMin && hasMax
      ? t("clients.card.budgetRange", { min: formatCurrency(nMin), max: formatCurrency(nMax) })
      : hasMax
        ? t("clients.card.budgetUpTo", { amount: formatCurrency(nMax) })
        : t("clients.card.budgetFrom", { amount: formatCurrency(nMin) });
  return (
    <div className={compact ? "w-36" : "w-full"}>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        {hasMin && hasMax ? (
          <div className="absolute top-0 h-full bg-primary/25" style={{ left: 0, width: `${leftPct}%` }} />
        ) : null}
        <div
          className="absolute top-0 h-full rounded-full bg-primary"
          style={{ left: `${leftPct}%`, width: `${fillPct}%` }}
        />
      </div>
      <p className={`mt-1 truncate font-medium text-foreground/80 ${compact ? "text-[11px]" : "text-xs"}`}>
        {label}
      </p>
    </div>
  );
}

const PROP_TYPES = ["apartment","house","commercial","land","other"] as const;
const FINANCING_OPTIONS = ["unklar", "in Prüfung", "Vorabbestätigung", "bestätigt", "abgelehnt"];

const CLIENT_STATUSES = [
  { value: "entwurf",       dot: "bg-slate-400",   badge: "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300" },
  { value: "pendent",       dot: "bg-amber-500",   badge: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300" },
  { value: "vollstaendig",  dot: "bg-blue-500",    badge: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300" },
  { value: "finanzierung",  dot: "bg-violet-500",  badge: "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300" },
  { value: "abgeschlossen", dot: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" },
  { value: "abgelehnt",     dot: "bg-red-500",     badge: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300" },
  { value: "storniert",     dot: "bg-zinc-500",    badge: "bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300" },
] as const;
const statusMap = new Map<string, (typeof CLIENT_STATUSES)[number]>(CLIENT_STATUSES.map((s) => [s.value, s]));

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";
const NO_FIN = "__none__";

function usePersistedState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch { /* ignore */ }
  }, [key, state]);
  return [state, setState] as const;
}


type ViewMode = "grid" | "list" | "kanban";

function ClientsPage() {
  const { t } = useTranslation();
  const statusLabel = (v: string) => t(`clients.status.${v}`, { defaultValue: v });
  const qc = useQueryClient();
  const [search, setSearch] = usePersistedState("clients:filter:search", "");
  const [typeFilters, setTypeFilters] = usePersistedState<string[]>("clients:filter:types", []);
  const [assignedFilters, setAssignedFilters] = usePersistedState<string[]>("clients:filter:assigned", []);
  const [financingFilter, setFinancingFilter] = usePersistedState("clients:filter:financing", ALL);
  const [statusFilter, setStatusFilter] = usePersistedState("clients:filter:status", ALL);
  const [archivedFilter, setArchivedFilter] = usePersistedState<"active" | "archived" | "all">("clients:filter:archived", "active");

  const [view, setView] = usePersistedState<ViewMode>("clients:filter:view", "list");
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error(t("clients.errors.notLoggedIn"));
      const result = await getClients({ headers: { authorization: `Bearer ${accessToken}` } });
      return unwrapServerResult(result);
    },
  });

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email, avatar_url").eq("is_active", true).order("full_name");
      return data ?? [];
    },
  });

  const clients = clientsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const employeeMap = useMemo(() => new Map(employees.map((e: any) => [e.id, e])), [employees]) as Map<string, any>;

  const assigneesQuery = useClientAssignees();
  const assigneesByClient = useMemo(() => {
    const m = new Map<string, string[]>();
    (assigneesQuery.data ?? []).forEach((r: any) => {
      const arr = m.get(r.client_id) ?? [];
      arr.push(r.user_id);
      m.set(r.client_id, arr);
    });
    return m;
  }, [assigneesQuery.data]);
  const assigneeIdsFor = (c: any): string[] => {
    const list = assigneesByClient.get(c.id);
    if (list && list.length) return list;
    const eff = c.assigned_to ?? c.owner_id;
    return eff && employeeMap.get(eff) ? [eff] : [];
  };

  const pinsMap = useClientPins();



  const disclosuresQuery = useQuery({
    queryKey: ["clients_disclosures_contact"],
    queryFn: async () => {
      const { data } = await supabase
        .from("client_self_disclosures")
        .select("client_id,email,phone,mobile,street,street_number,postal_code,city");
      return data ?? [];
    },
  });
  const disclosureMap = useMemo(() => {
    const m = new Map<string, any>();
    (disclosuresQuery.data ?? []).forEach((d: any) => { m.set(d.client_id, d); });
    return m;
  }, [disclosuresQuery.data]);

  const clientNameMap = useMemo(() => {
    const m = new Map<string, string>();
    clients.forEach((c: any) => m.set(c.id, c.full_name));
    return m;
  }, [clients]);
  const clientInfoMap = useMemo(() => {
    const m = new Map<string, any>();
    clients.forEach((c: any) => m.set(c.id, c));
    return m;
  }, [clients]);

  const showError = clientsQuery.error && !isBackendUnavailableError(clientsQuery.error);
  const queryErrorMessage = showError ? getBackendErrorMessage(clientsQuery.error) : null;


  const filtered = useMemo(() => {
    const list = clients.filter((c: any) => {
      if (archivedFilter === "active" && c.is_archived) return false;
      if (archivedFilter === "archived" && !c.is_archived) return false;
      if (typeFilters.length && !typeFilters.includes(c.client_type)) return false;
      if (assignedFilters.length) {
        const list = assigneesByClient.get(c.id) ?? [];
        const eff = c.assigned_to ?? c.owner_id;
        const all = list.length ? list : (eff ? [eff] : []);
        // ODER-Verknüpfung: nicht zugewiesen ODER einem der gewählten Mitarbeitenden zugewiesen.
        const wantUnassigned = assignedFilters.includes(UNASSIGNED);
        const matchesUnassigned = wantUnassigned && all.length === 0;
        const matchesEmployee = assignedFilters.some((f) => f !== UNASSIGNED && all.includes(f));
        if (!matchesUnassigned && !matchesEmployee) return false;
      }
      if (financingFilter !== ALL) {
        if (financingFilter === NO_FIN && c.financing_status) return false;
        if (financingFilter !== NO_FIN && c.financing_status !== financingFilter) return false;
      }
      if (statusFilter !== ALL && c.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!c.full_name?.toLowerCase().includes(q) && !c.email?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    // Sortierung: angepinnte zuoberst, danach neueste zuerst
    return list.sort((a: any, b: any) => {
      const pa = pinsMap.has(a.id) ? 0 : 1;
      const pb = pinsMap.has(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ca = a.created_at ?? "";
      const cb = b.created_at ?? "";
      if (ca !== cb) return ca > cb ? -1 : 1;
      return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    });
  }, [clients, archivedFilter, typeFilters, assignedFilters, financingFilter, statusFilter, search, assigneesByClient, pinsMap]);


  // Pagination
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, typeFilters, assignedFilters, financingFilter, statusFilter, archivedFilter, pageSize, view]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((c: any) => selected.has(c.id));
  const toggleAll = () => setSelected((prev) => {
    if (allFilteredSelected) {
      const next = new Set(prev);
      filtered.forEach((c: any) => next.delete(c.id));
      return next;
    }
    const next = new Set(prev);
    filtered.forEach((c: any) => next.add(c.id));
    return next;
  });
  const clearSelection = () => setSelected(new Set());

  const assign = useMutation({
    mutationFn: async (assignedTo: string | null) => {
      const ids = Array.from(selected);
      if (!ids.length) return;
      const { error } = await supabase.from("clients").update({ assigned_to: assignedTo }).in("id", ids);
      if (error) throw error;
      if (assignedTo) {
        await supabase.from("client_assignees").upsert(
          ids.map((id) => ({ client_id: id, user_id: assignedTo })),
          { onConflict: "client_id,user_id" },
        );
      } else {
        await supabase.from("client_assignees").delete().in("client_id", ids);
      }
    },
    onSuccess: () => {
      toast.success(t("clients.toast.assigned"));
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client_assignees"] });
      clearSelection();
    },
    onError: (e: unknown) => toast.error(getBackendErrorMessage(e)),
  });

  const archive = useMutation({
    mutationFn: async (archive: boolean) => {
      const ids = Array.from(selected);
      if (!ids.length) return;
      const { error } = await supabase.from("clients").update({
        is_archived: archive,
        archived_at: archive ? new Date().toISOString() : null,
      }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, archived) => {
      toast.success(archived ? t("clients.toast.archived") : t("clients.toast.restored"));
      qc.invalidateQueries({ queryKey: ["clients"] });
      clearSelection();
    },
    onError: (e: unknown) => toast.error(getBackendErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      if (!ids.length) return;
      await deleteToTrash("clients", ids);
    },
    onSuccess: () => {
      toast.success(t("clients.toast.deleted"));
      qc.invalidateQueries({ queryKey: ["clients"] });
      clearSelection();
      setConfirmDelete(false);
    },
    onError: (e: unknown) => toast.error(getBackendErrorMessage(e)),
  });

  const selectionCount = selected.size;

  const baseList = useMemo(
    () => clients.filter((c: any) => (archivedFilter === "active" ? !c.is_archived : archivedFilter === "archived" ? c.is_archived : true)),
    [clients, archivedFilter],
  );

  const statTiles = useMemo(() => {
    const countType = (v: string) => baseList.filter((c: any) => c.client_type === v).length;
    const countStatus = (v: string) => baseList.filter((c: any) => c.status === v).length;
    const toggleType = (v: string) => setTypeFilters((prev: string[]) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
    const toggleStatus = (v: string) => setStatusFilter((prev: string) => (prev === v ? ALL : v));
    return [
      {
        key: "total", label: t("clients.stats.total", { defaultValue: "Kunden gesamt" }),
        value: baseList.length, hint: t("clients.stats.shown", { defaultValue: "{{n}} sichtbar", n: filtered.length }),
        icon: Users, iconClass: "bg-primary/15 text-primary", glow: "bg-primary",
        active: typeFilters.length === 0 && statusFilter === ALL,
        onClick: () => { setTypeFilters([]); setStatusFilter(ALL); },
      },
      {
        key: "buyer", label: clientTypeLabels.buyer, value: countType("buyer"),
        icon: ShoppingBag, iconClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300", glow: "bg-cyan-500",
        active: typeFilters.includes("buyer"), onClick: () => toggleType("buyer"),
      },
      {
        key: "seller", label: clientTypeLabels.seller, value: countType("seller"),
        icon: Home, iconClass: "bg-teal-500/15 text-teal-600 dark:text-teal-300", glow: "bg-teal-500",
        active: typeFilters.includes("seller"), onClick: () => toggleType("seller"),
      },
      {
        key: "finanzierung", label: statusLabel("finanzierung"), value: countStatus("finanzierung"),
        icon: Banknote, iconClass: "bg-violet-500/15 text-violet-600 dark:text-violet-300", glow: "bg-violet-500",
        active: statusFilter === "finanzierung", onClick: () => toggleStatus("finanzierung"),
      },
      {
        key: "abgeschlossen", label: statusLabel("abgeschlossen"), value: countStatus("abgeschlossen"),
        icon: CheckCircle2, iconClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", glow: "bg-emerald-500",
        active: statusFilter === "abgeschlossen", onClick: () => toggleStatus("abgeschlossen"),
      },
      {
        key: "storniert", label: statusLabel("storniert"), value: countStatus("storniert"),
        icon: Ban, iconClass: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300", glow: "bg-zinc-500",
        active: statusFilter === "storniert", onClick: () => toggleStatus("storniert"),
      },
    ];
  }, [baseList, filtered.length, typeFilters, statusFilter, t]);


  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <Users className="h-8 w-8 text-[#6F6B94]" />
            {t("pages.clients.title")}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
              <TabsList className="h-9 rounded-lg bg-primary/15 p-1">
                <TabsTrigger value="grid" className="gap-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"><LayoutGrid className="h-4 w-4" />{t("clients.tabs.grid")}</TabsTrigger>
                <TabsTrigger value="list" className="gap-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"><ListIcon className="h-4 w-4" />{t("clients.tabs.list")}</TabsTrigger>
                <TabsTrigger value="kanban" className="gap-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"><Columns3 className="h-4 w-4" />Kanban</TabsTrigger>
              </TabsList>

            </Tabs>
            
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />{t("clients.new")}
            </Button>
          </div>
        }
      />

      <ClientWizard open={open} onOpenChange={setOpen} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("clients.filters.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <FilterMultiSelect
          options={TYPES.map((tt) => ({ value: tt, label: clientTypeLabels[tt] }))}
          selected={typeFilters}
          onChange={setTypeFilters}
          placeholder={t("clients.filters.type")}
        />
        <FilterMultiSelect
          options={[
            { value: UNASSIGNED, label: t("clients.filters.unassigned") },
            ...employees.map((e: any) => ({ value: e.id, label: e.full_name ?? e.email, avatar_url: e.avatar_url })),
          ]}
          selected={assignedFilters}
          onChange={setAssignedFilters}
          placeholder={t("clients.filters.allEmployees")}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder={t("clients.filters.status")}>
              {statusFilter !== ALL && statusMap.get(statusFilter) ? (
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${statusMap.get(statusFilter)!.dot}`} />
                  {statusLabel(statusFilter)}
                </span>
              ) : t("clients.filters.allStatus")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("clients.filters.allStatus")}</SelectItem>
            {CLIENT_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                  {statusLabel(s.value)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={archivedFilter} onValueChange={(v) => setArchivedFilter(v as typeof archivedFilter)}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t("clients.filters.active")}</SelectItem>
            <SelectItem value="archived">{t("clients.filters.archivedOnly")}</SelectItem>
            <SelectItem value="all">{t("clients.filters.all")}</SelectItem>
          </SelectContent>
        </Select>
        {(typeFilters.length > 0 || assignedFilters.length > 0 || financingFilter !== ALL || statusFilter !== ALL || search) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setTypeFilters([]); setAssignedFilters([]); setFinancingFilter(ALL); setStatusFilter(ALL); }}>
            {t("clients.filters.reset")}
          </Button>
        )}

      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {statTiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={tile.onClick}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:shadow-sm ${tile.active ? "border-primary/60 bg-primary/10 text-primary" : "border-border/70 bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${tile.iconClass}`}>
              <tile.icon className="h-3 w-3" />
            </span>
            <span>{tile.label}</span>
            <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">{tile.value}</span>
          </button>
        ))}
      </div>



      {selectionCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-accent/40 p-3">
          <span className="text-sm font-medium">{t("clients.bulk.selected", { count: selectionCount })}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline"><UserCog className="mr-1 h-4 w-4" />{t("clients.bulk.assign")}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                <DropdownMenuLabel>{t("clients.bulk.employees")}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => assign.mutate(null)}>
                  <X className="mr-2 h-4 w-4" />{t("clients.bulk.removeAssign")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {employees.map((e: any) => (
                  <DropdownMenuItem key={e.id} onClick={() => assign.mutate(e.id)}>
                    <Avatar className="mr-2 h-5 w-5 text-[9px]">
                      {e.avatar_url ? <AvatarImage src={e.avatar_url} alt={e.full_name ?? ""} /> : null}
                      <AvatarFallback className="bg-primary/10 text-primary">{initials(e)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{e.full_name ?? e.email}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {archivedFilter === "archived" ? (
              <Button size="sm" variant="outline" onClick={() => archive.mutate(false)}>
                <ArchiveRestore className="mr-1 h-4 w-4" />{t("clients.bulk.restore")}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => archive.mutate(true)}>
                <Archive className="mr-1 h-4 w-4" />{t("clients.bulk.archive")}
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-1 h-4 w-4" />{t("clients.bulk.delete")}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="mr-1 h-4 w-4" />{t("clients.bulk.clear")}
            </Button>
          </div>
        </div>
      )}

      {showError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {queryErrorMessage}
        </div>
      ) : null}

      {!clientsQuery.error && clientsQuery.isLoading ? (
        <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">{t("clients.loading")}</div>
      ) : null}

      {filtered.length === 0 && !clientsQuery.error && !clientsQuery.isLoading ? (
        <EmptyState title={t("clients.emptyTitle")} description={t("clients.emptyDescription")} />
      ) : view === "kanban" ? (
        <ClientKanban clients={filtered} disclosureIds={new Set(disclosureMap.keys())} onOpen={setDetailId} />
      ) : view === "grid" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {paginated.map((c: any) => {
            const isSel = selected.has(c.id);
            return (
              <Card key={c.id} className={`transition hover:shadow-glow ${isSel ? "ring-2 ring-primary" : ""}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggleOne(c.id)}
                        aria-label={t("clients.row.select")}
                        className="mt-1"
                      />
                      <ClientPinButton clientId={c.id} color={pinsMap.get(c.id)} size="xs" />
                      <button type="button" onClick={() => setDetailId(c.id)} className="flex-1 min-w-0 text-left">
                        <p className="flex items-center gap-1.5 font-semibold hover:text-primary truncate">
                          <span className="truncate">{c.full_name}</span>
                          {c.is_family_head && <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-label="Hauptmitglied" />}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(() => {
                            const s = statusMap.get(c.status ?? "entwurf") ?? statusMap.get("entwurf")!;
                            return (
                              <Badge variant="outline" className={s.badge}>
                                <span className={`mr-1.5 h-2 w-2 rounded-full ${s.dot}`} />
                                {statusLabel(s.value)}
                              </Badge>
                            );
                          })()}
                          <Badge variant="outline" className={typeBadge(c.client_type)}>{clientTypeLabels[c.client_type as keyof typeof clientTypeLabels]}</Badge>
                          {c.is_archived && <Badge variant="outline">{t("clients.archived")}</Badge>}

                          {assigneeIdsFor(c).length > 0 && (
                            <AssigneeAvatars ids={assigneeIdsFor(c)} employeeMap={employeeMap} size="xs" />
                          )}
                        </div>
                      </button>
                    </div>
                    <Link to="/matching" search={{ clientId: c.id, view: "client" as const, profileId: "" }} className="rounded-lg border p-2 text-primary transition hover:bg-accent" title={t("clients.row.matching")}>
                      <Target className="h-4 w-4" />
                    </Link>
                  </div>
                  <button type="button" onClick={() => setDetailId(c.id)} className="block w-full text-left">
                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      {c.email && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" />{c.email}</p>}
                      {c.phone && <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" />{c.phone}</p>}
                    </div>


                    {(c.budget_min || c.budget_max || c.preferred_cities?.length || c.rooms_min) && (
                      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs space-y-2">
                        {(c.budget_min || c.budget_max) && <BudgetBar min={c.budget_min} max={c.budget_max} />}
                        {c.preferred_cities?.length ? <p>{t("clients.card.cities", { list: c.preferred_cities.join(", ") })}</p> : null}
                        {c.rooms_min ? <p>{t("clients.card.roomsFrom", { n: c.rooms_min })}</p> : null}
                      </div>
                    )}
                  </button>

                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAll} aria-label={t("clients.row.selectAll")} />
                </TableHead>
                <TableHead>{t("clients.columns.name")}</TableHead>
                <TableHead>{t("clients.columns.status")}</TableHead>
                <TableHead>{t("clients.columns.type")}</TableHead>
                <TableHead className="w-44">{t("clients.columns.budget")}</TableHead>


                <TableHead>{t("clients.columns.assignedTo")}</TableHead>
                
                
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((c: any) => {
                const disc = disclosureMap.get(c.id);
                const email = c.email || disc?.email;
                const phone = c.phone || disc?.mobile || disc?.phone;
                const addr = [
                  [disc?.street, disc?.street_number].filter(Boolean).join(" "),
                  [disc?.postal_code, disc?.city].filter(Boolean).join(" "),
                ].filter(Boolean).join(", ") || [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
                const plzOrt = [disc?.postal_code ?? c.postal_code, disc?.city ?? c.city].filter(Boolean).join(" ");
                const isPartner = false;

                return (
                  <TableRow
                    key={c.id}
                    data-state={selected.has(c.id) ? "selected" : undefined}
                    className={isPartner ? "bg-muted/30" : undefined}
                  >
                    <TableCell>
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleOne(c.id)} aria-label={t("clients.row.select")} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isPartner && (
                          <CornerDownRight className="h-4 w-4 shrink-0 text-muted-foreground ml-3" aria-hidden />
                        )}
                        <ClientPinButton clientId={c.id} color={pinsMap.get(c.id)} />
                        <HoverCard openDelay={150} closeDelay={100}>
                          <HoverCardTrigger asChild>
                            <button type="button" onClick={() => setDetailId(c.id)} className="flex items-center gap-1.5 font-medium hover:text-primary text-left">
                              {c.full_name}
                              {c.is_family_head && <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-label="Hauptmitglied" />}
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80 text-sm" align="start">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold truncate">{c.full_name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {clientTypeLabels[c.client_type as keyof typeof clientTypeLabels]}
                                </p>
                              </div>
                              {(() => {
                                const s = statusMap.get(c.status ?? "entwurf") ?? statusMap.get("entwurf")!;
                                return (
                                  <Badge variant="outline" className={s.badge}>
                                    <span className={`mr-1.5 h-2 w-2 rounded-full ${s.dot}`} />
                                    {statusLabel(s.value)}
                                  </Badge>
                                );
                              })()}
                            </div>
                            <div className="mt-3 space-y-1.5 text-xs">
                              <p className="flex items-center gap-2">
                                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                {phone ? <a href={`tel:${phone}`} className="hover:text-primary">{phone}</a> : <span className="text-muted-foreground">—</span>}
                              </p>
                              <p className="flex items-center gap-2">
                                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                {email ? <a href={`mailto:${email}`} className="hover:text-primary break-all">{email}</a> : <span className="text-muted-foreground">—</span>}
                              </p>
                              <p className="flex items-center gap-2">
                                <Home className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span>{addr || plzOrt || <span className="text-muted-foreground">—</span>}</span>
                              </p>
                            </div>
                            {(c.budget_min || c.budget_max || c.financing_status) && (
                              <div className="mt-3 rounded-lg bg-muted/40 p-2 text-xs space-y-1.5">
                                {(c.budget_min || c.budget_max) && <BudgetBar min={c.budget_min} max={c.budget_max} />}
                                {c.financing_status ? <p className="text-muted-foreground">{c.financing_status}</p> : null}
                              </div>
                            )}


                          </HoverCardContent>
                        </HoverCard>
                        {c.is_archived && <Badge variant="outline" className="ml-1">{t("clients.archived")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const s = statusMap.get(c.status ?? "entwurf") ?? statusMap.get("entwurf")!;
                        return (
                          <Badge variant="outline" className={s.badge}>
                            <span className={`mr-1.5 h-2 w-2 rounded-full ${s.dot}`} />
                            {statusLabel(s.value)}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={typeBadge(c.client_type)}>{clientTypeLabels[c.client_type as keyof typeof clientTypeLabels]}</Badge>
                    </TableCell>
                    <TableCell>
                      <BudgetBar min={c.budget_min} max={c.budget_max} compact />
                    </TableCell>

                    <TableCell className="text-sm">
                      <AssigneePicker
                        clientId={c.id}
                        assignedIds={assigneeIdsFor(c)}
                        employees={employees as any}
                        employeeMap={employeeMap}
                      />
                    </TableCell>
                    
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailId(c.id)}>{t("clients.row.open")}</DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to="/matching" search={{ clientId: c.id, view: "client" as const, profileId: "" }}>{t("clients.row.matching")}</Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {c.is_archived ? (
                            <DropdownMenuItem onClick={() => { setSelected(new Set([c.id])); archive.mutate(false); }}>
                              <ArchiveRestore className="mr-2 h-4 w-4" />{t("clients.row.restore")}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => { setSelected(new Set([c.id])); archive.mutate(true); }}>
                              <Archive className="mr-2 h-4 w-4" />{t("clients.row.archive")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => { setSelected(new Set([c.id])); setConfirmDelete(true); }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />{t("clients.row.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {filtered.length > 0 && view !== "kanban" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>
              {t("clients.pagination.showing", { from: (currentPage - 1) * pageSize + 1, to: Math.min(currentPage * pageSize, filtered.length), total: filtered.length })}
            </span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="20">{t("clients.pagination.perPage", { n: 20 })}</SelectItem>
                <SelectItem value="50">{t("clients.pagination.perPage", { n: 50 })}</SelectItem>
                <SelectItem value="100">{t("clients.pagination.perPage", { n: 100 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t("clients.pagination.prev")}</Button>
            <span>{t("clients.pagination.page", { current: currentPage, total: totalPages })}</span>
            <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>{t("clients.pagination.next")}</Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clients.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("clients.deleteDialog.description", { count: selectionCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("clients.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClientDetailDialog
        clientId={detailId}
        open={!!detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        clientIds={filtered.map((c: any) => c.id)}
        onNavigate={(nextId) => setDetailId(nextId)}
      />
    </>
  );
}

type FilterOption = { value: string; label: string; avatar_url?: string | null };

function FilterMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { t } = useTranslation();

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} ${t("common.selected", { defaultValue: "ausgewählt" })}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between font-normal"
        >
          <span className="inline-flex items-center gap-2 truncate">
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("common.search", { defaultValue: "Suchen…" })}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{t("common.noResults", { defaultValue: "Keine Treffer" })}</CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => {
                const active = selected.includes(o.value);
                return (
                  <CommandItem key={o.value} value={o.value} onSelect={() => toggle(o.value)}>
                    <span className={cn("flex h-4 w-4 items-center justify-center rounded-sm border", active ? "bg-primary border-primary" : "opacity-50")}>
                      {active && <Check className="h-3 w-3 text-primary-foreground" />}
                    </span>
                    {o.avatar_url !== undefined && (
                      <Avatar className="h-5 w-5 text-[9px]">
                        {o.avatar_url ? <AvatarImage src={o.avatar_url} alt={o.label} /> : null}
                        <AvatarFallback className="bg-primary/10 text-primary">{initials({ full_name: o.label } as any)}</AvatarFallback>
                      </Avatar>
                    )}
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs"
              onClick={() => onChange([])}
            >
              <X className="mr-1 h-3 w-3" />
              {t("common.clear", { defaultValue: "Leeren" })}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
