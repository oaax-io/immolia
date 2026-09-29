import { UsageCostNotice, useUsagePreview, costButtonLabel, isBlocked } from "@/components/credits/UsageCostNotice";
import { tenantStoragePath } from "@/lib/tenant-storage";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Bed, Bath, Maximize, Calendar, Zap, FileText, Trash2, Pencil, Plus, ExternalLink, CheckCircle2, Circle, Image as ImageIcon, User, Building2, Layers3, Banknote, Activity, TrendingUp, Sparkles, RefreshCw, ChevronLeft, ChevronRight, UploadCloud, Download, X, Share2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { PropertyWizard, type WizardSubmit } from "@/components/properties/PropertyWizard";
import { formatCurrency, formatArea, formatDate, formatDateTime, propertyTypeLabels, propertyStatusLabels, listingTypeLabels, getPropertyStatusBadgeClass, getPropertyStatusDotClass } from "@/lib/format";
import { toast } from "sonner";
import { MatchPanel } from "@/components/matching/MatchPanel";
import { matchPropertyToClients } from "@/lib/matching";
import { GeneratedDocumentsTable } from "@/components/documents/GeneratedDocumentsTable";
import { PropertyOwnersTab } from "@/components/properties/PropertyOwnersTab";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { FinancingQuickCheckWizard } from "@/components/financing/FinancingQuickCheckWizard";
import { useAuth } from "@/lib/auth";
import { extractPropertyImagePaths } from "@/lib/property-media";
import { MacroLocationCard } from "@/components/properties/MacroLocationCard";
import { PublicShareCard } from "@/components/properties/PublicShareCard";
import { PortalPublishCard } from "@/components/properties/PortalPublishCard";
import { PropertyExposeWizardDialog } from "@/components/expose/PropertyExposeWizardDialog";
import { publishPropertyToPortal } from "@/lib/portal.functions";
import { DealDialog } from "@/components/commission/DealDialog";
import { PropertyAssigneePicker, usePropertyAssignees } from "@/components/properties/PropertyAssignees";
import type { EmployeeLite } from "@/components/clients/ClientAssignees";
import { PropertyQuickActions } from "@/components/properties/PropertyQuickActions";
import { deleteToTrash } from "@/lib/trash";
import { PropertyImageSorter } from "@/components/properties/PropertyImageSorter";


export const Route = createFileRoute("/_app/properties/$id")({ component: PropertyDetail });

const STATUSES = ["draft","preparation","available","reserved","sold","rented","archived"] as const;

function getMediaPublicUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

async function syncPropertyImagesFromMedia(propertyId: string) {
  const { data: mediaRows, error: mediaError } = await supabase
    .from("property_media")
    .select("file_url, file_type, sort_order, is_cover, created_at")
    .eq("property_id", propertyId);

  if (mediaError) throw mediaError;

  const images = extractPropertyImagePaths(mediaRows ?? []);
  const { error: propertyError } = await supabase.from("properties").update({ images }).eq("id", propertyId);
  if (propertyError) throw propertyError;

  return images;
}

function PropertyDetail() {
  const confirm = useConfirm();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [financingOpen, setFinancingOpen] = useState(false);
  const [exposeOpen, setExposeOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);

  const [tab, setTab] = useState("overview");
  const [ownersOpen, setOwnersOpen] = useState(false);


  const { data: p, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("properties").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email, avatar_url").eq("is_active", true);
      return data ?? [];
    },
  });
  const employeeMap = useMemo(() => new Map(employees.map((e: any) => [e.id, e])), [employees]);
  const { data: propertyAssignees = [] } = usePropertyAssignees();
  const assignedIds = useMemo(() => propertyAssignees.filter((r: any) => r.property_id === id).map((r: any) => r.user_id), [propertyAssignees, id]);

  const { data: statusFlags } = useQuery({
    queryKey: ["property_status_flags", id],
    queryFn: async () => {
      const [m, n] = await Promise.all([
        supabase.from("mandates").select("id,status").eq("property_id", id).in("status", ["active", "signed"]).limit(1),
        supabase.from("nda_agreements").select("id").eq("property_id", id).limit(1),
      ]);
      return {
        hasActiveMandate: (m.data?.length ?? 0) > 0,
        hasNda: (n.data?.length ?? 0) > 0,
      };
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ["property_units", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("properties")
        .select("id,title,unit_number,unit_type,unit_floor,unit_status,rooms,living_area,price,rent,listing_type,status,property_type")
        .eq("parent_property_id", id)
        .order("unit_number", { ascending: true });
      return data ?? [];
    },
    enabled: !!id && !!p && !p.is_unit,
  });

  const { data: parent } = useQuery({
    queryKey: ["property_parent", p?.parent_property_id],
    queryFn: async () => {
      if (!p?.parent_property_id) return null;
      const { data } = await supabase.from("properties").select("id,title,address,city").eq("id", p.parent_property_id).single();
      return data;
    },
    enabled: !!p?.is_unit && !!p?.parent_property_id,
  });

  const { data: currentOwners = [] } = useQuery({
    queryKey: ["property_current_owners", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("property_ownerships")
        .select("client_id, ownership_type, client:clients!property_ownerships_client_id_fkey(id, full_name)")
        .eq("property_id", id)
        .is("end_date", null);
      return (data ?? []) as unknown as Array<{
        client_id: string;
        ownership_type: string;
        client: { id: string; full_name: string } | null;
      }>;
    },
    enabled: !!id,
  });

  const { data: counts } = useQuery({
    queryKey: ["property_counts", id, p?.updated_at],
    queryFn: async () => {
      const head = { count: "exact" as const, head: true };
      const [storedMatches, allClients, d, a, md] = await Promise.all([
        supabase.from("matches").select("property_id, client_id").eq("property_id", id),
        supabase.from("clients").select("*"),
        supabase.from("documents").select("id", head).eq("related_type", "property").eq("related_id", id),
        supabase.from("appointments").select("id", head).eq("property_id", id),
        supabase.from("mandates").select("id", head).eq("property_id", id),
      ]);
      // Live-Matches berechnen (entspricht MatchPanel: score >= 40)
      const computed = p ? matchPropertyToClients(p as any, (allClients.data ?? []) as any[], 40) : [];
      const ids = new Set<string>(computed.map((c) => c.client.id));
      (storedMatches.data ?? []).forEach((m: any) => ids.add(m.client_id));
      return {
        matches: ids.size,
        documents: d.count ?? 0,
        appointments: a.count ?? 0,
        mandates: md.count ?? 0,
      };
    },
    enabled: !!id && !!p,
  });

  const { data: activities = [] } = useQuery({
    queryKey: ["property_activities", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_logs")
        .select("id, action, created_at, actor_id, metadata")
        .eq("related_type", "property")
        .eq("related_id", id)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
    enabled: !!id,
  });

  const update = useMutation({
    mutationFn: async (payload: WizardSubmit) => {
      const newOwnerId =
        (payload.property as any)?.owner_client_id ??
        (payload.property as any)?.seller_client_id ??
        null;
      const prevOwnerId = p?.owner_client_id ?? p?.seller_client_id ?? null;

      // Diff berechnen: nur Felder die sich tatsächlich geändert haben
      const next = (payload.property ?? {}) as Record<string, any>;
      const prev = (p ?? {}) as Record<string, any>;
      const changes: Record<string, { from: any; to: any }> = {};
      const norm = (v: any) => {
        if (v === undefined) return null;
        if (Array.isArray(v)) return JSON.stringify(v);
        return v;
      };
      for (const k of Object.keys(next)) {
        if (norm(next[k]) !== norm(prev[k])) {
          changes[k] = { from: prev[k] ?? null, to: next[k] ?? null };
        }
      }

      const { error } = await supabase.from("properties").update(payload.property as any).eq("id", id);
      if (error) throw error;

      // Eigentümer-Historie synchron halten
      if (newOwnerId && newOwnerId !== prevOwnerId) {
        const today = new Date().toISOString().slice(0, 10);
        // Alte aktive Eigentümer schließen
        await supabase
          .from("property_ownerships")
          .update({ end_date: today, ownership_type: "former_owner" })
          .eq("property_id", id)
          .is("end_date", null);
        await supabase
          .from("client_roles")
          .update({ status: "completed", end_date: today, role_type: "former_owner" })
          .eq("related_type", "property")
          .eq("related_id", id)
          .eq("role_type", "owner")
          .eq("status", "active");
        // Neuen Eigentümer setzen
        await supabase.from("property_ownerships").insert({
          property_id: id,
          client_id: newOwnerId,
          ownership_type: "owner",
          start_date: today,
          source: "manual",
          is_primary_contact: true,
        });
        await supabase.from("client_roles").insert({
          client_id: newOwnerId,
          role_type: "owner",
          related_type: "property",
          related_id: id,
          status: "active",
          start_date: today,
        });
      } else if (newOwnerId && prevOwnerId && newOwnerId === prevOwnerId) {
        // Sicherstellen, dass mindestens ein aktiver Eintrag existiert
        const { data: existing } = await supabase
          .from("property_ownerships")
          .select("id")
          .eq("property_id", id)
          .is("end_date", null)
          .limit(1);
        if (!existing || existing.length === 0) {
          const today = new Date().toISOString().slice(0, 10);
          await supabase.from("property_ownerships").insert({
            property_id: id,
            client_id: newOwnerId,
            ownership_type: "owner",
            start_date: today,
            source: "manual",
            is_primary_contact: true,
          });
        }
      }

      const { data: previousMedia, error: previousMediaError } = await supabase
        .from("property_media")
        .select("file_url")
        .eq("property_id", id);
      if (previousMediaError) throw previousMediaError;

      const previousPaths = new Set((previousMedia ?? []).map((row) => row.file_url).filter(Boolean));
      const nextPaths = new Set(payload.media.map((m) => m.file_url).filter(Boolean));
      const removedPaths = [...previousPaths].filter((path) => !nextPaths.has(path));

      const { data: deletedMedia, error: deleteMediaError } = await supabase.from("property_media").delete().eq("property_id", id).select("id");
      if (deleteMediaError) throw deleteMediaError;
      // Teilweise abgelehnte Löschung würde beim Neuanlegen Duplikate erzeugen → abbrechen.
      if ((deletedMedia?.length ?? 0) !== (previousMedia?.length ?? 0)) throw new Error("Keine Berechtigung, alle Bilder dieses Objekts zu ersetzen.");

      if (payload.media.length > 0) {
        const mediaRows = payload.media.map((m, index) => ({
          property_id: id,
          file_url: m.file_url,
          file_name: m.file_name,
          file_type: m.file_type,
          title: m.title,
          is_cover: m.is_cover,
          sort_order: index + 1,
        }));
        const { error: mediaError } = await supabase.from("property_media").insert(mediaRows as any);
        if (mediaError) throw mediaError;
      }

      if (removedPaths.length > 0) {
        const { error: removeStorageError } = await supabase.storage.from("media").remove(removedPaths);
        if (removeStorageError) throw removeStorageError;
      }

      await syncPropertyImagesFromMedia(id);

      const ownerChanged = !!(newOwnerId && newOwnerId !== prevOwnerId);
      // Nur loggen wenn es etwas zu loggen gibt
      if (Object.keys(changes).length > 0 || ownerChanged) {
        await supabase.from("activity_logs").insert({
          actor_id: user?.id ?? null,
          action: "Immobilie bearbeitet",
          related_type: "property",
          related_id: id,
          metadata: { changes, owner_changed: ownerChanged },
        });
      }

      // Bereits veröffentlichte Objekte automatisch mit dem ASIMO Portal synchronisieren
      if (p?.portal_published) {
        try {
          await publishPropertyToPortal({ data: { propertyId: id } });
        } catch (e: any) {
          toast.error(`Portal-Sync fehlgeschlagen: ${e?.message ?? "Unbekannter Fehler"}`);
        }
      }
    },
    onSuccess: () => {
      toast.success("Gespeichert");
      qc.invalidateQueries({ queryKey: ["property", id] });
      qc.invalidateQueries({ queryKey: ["property_activities", id] });
      qc.invalidateQueries({ queryKey: ["properties"] });
      qc.invalidateQueries({ queryKey: ["property_current_owners", id] });
      qc.invalidateQueries({ queryKey: ["property_ownerships", id] });
      setEditOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const prevStatus = p?.status;
      const { error } = await supabase.from("properties").update({ status: status as any }).eq("id", id);
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: user?.id ?? null,
        action: `Status geändert: ${prevStatus ?? "—"} → ${status}`,
        related_type: "property",
        related_id: id,
        metadata: { from: prevStatus, to: status },
      });
    },
    onSuccess: async (_data, status) => {
      toast.success("Status aktualisiert");
      qc.invalidateQueries({ queryKey: ["property", id] });
      qc.invalidateQueries({ queryKey: ["property_activities", id] });
      // Bei Abschluss (Verkauf/Vermietung) Provisionsbuchung anbieten,
      // sofern für dieses Objekt noch keine gebucht wurde.
      if (status === "sold" || status === "rented") {
        const { data: existing } = await supabase
          .from("commission_records")
          .select("id")
          .eq("property_id", id)
          .eq("record_type", "commission")
          .neq("status", "void")
          .maybeSingle();
        if (!existing) setDealOpen(true);
      }
    },
  });

  const del = useMutation({
    mutationFn: async () => {
      await deleteToTrash("properties", id);
    },
    onSuccess: () => { toast.success("Gelöscht"); navigate({ to: "/properties" }); },
  });

  if (isLoading || !p) return <div className="text-sm text-muted-foreground">Lädt…</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" asChild><Link to="/properties"><ArrowLeft className="mr-1 h-4 w-4" />Zurück</Link></Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setExposeOpen(true)}>
            <Share2 className="mr-1 h-4 w-4" />Veröffentlichen
          </Button>
          <Button variant="outline" onClick={() => setFinancingOpen(true)}>
            <Banknote className="mr-1 h-4 w-4" />Finanzierung starten
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="mr-1 h-4 w-4" />Bearbeiten</Button>
          <Select value={p.status} onValueChange={(v) => updateStatus.mutate(v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => (
              <SelectItem key={s} value={s}>
                <span className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${getPropertyStatusDotClass(s)}`} />
                  {propertyStatusLabels[s]}
                </span>
              </SelectItem>
            ))}</SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={async () => { if (await confirm({ title: "Immobilie löschen?", description: "Diese Aktion kann nicht rückgängig gemacht werden.", confirmText: "Löschen" })) del.mutate(); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <PropertyQuickActions propertyId={id} marketAnalysisSlot={<MarketAnalysisTab property={p} />} />

        </div>
      </div>

      <DealDialog
        open={dealOpen}
        onOpenChange={setDealOpen}
        propertyId={id}
      />

      <PropertyWizard
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        initial={p}
        onSubmit={(payload) => update.mutate(payload)}
        submitting={update.isPending}
      />

      <FinancingQuickCheckWizard
        open={financingOpen}
        onOpenChange={setFinancingOpen}
        defaultPropertyId={id}
        defaultClientId={currentOwners[0]?.client_id}
        onCreated={(dossierId) => navigate({ to: "/financing/$id", params: { id: dossierId } })}
      />

      <Dialog open={exposeOpen} onOpenChange={setExposeOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Veröffentlichen</DialogTitle>
          </DialogHeader>
          <ExposeTab propertyId={id} property={p} />
        </DialogContent>
      </Dialog>

      {/* Parent / Unit context banner */}
      {p.is_unit && parent && (
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-sm">
              <Layers3 className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">Einheit in</span>
              <span className="font-medium">{parent.title}</span>
              {parent.address && <span className="text-muted-foreground">· {[parent.address, parent.city].filter(Boolean).join(", ")}</span>}
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/properties/$id" params={{ id: parent.id }}>
                <ExternalLink className="mr-1 h-4 w-4" />Liegenschaft öffnen
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {!p.is_unit && units.length > 0 && (
        <Card className="mb-4 border-primary/20 bg-muted/30">
          <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="font-medium">{units.length} Einheit{units.length === 1 ? "" : "en"}</span>
            <span className="text-muted-foreground">in dieser Liegenschaft</span>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 aspect-[16/10] overflow-hidden rounded-2xl">
          <PropertyImageGallery propertyId={id} images={p.images ?? []} title={p.title} />
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={getPropertyStatusBadgeClass(p.status)}>{propertyStatusLabels[p.status as keyof typeof propertyStatusLabels]}</Badge>
            <Badge variant="secondary">{propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels]}</Badge>
            <Badge variant="outline">{listingTypeLabels[p.listing_type as keyof typeof listingTypeLabels]}</Badge>
            {p.status === "reserved" && <Badge className="bg-amber-500 hover:bg-amber-500">Aktive Reservation</Badge>}
            {statusFlags?.hasActiveMandate && <Badge className="bg-emerald-600 hover:bg-emerald-600">Aktives Mandat</Badge>}
            {statusFlags?.hasNda && <Badge variant="outline" className="border-primary/50 text-primary">NDA vorhanden</Badge>}
          </div>
          {(p.reference_no || p.parcel_no) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs font-semibold tracking-wide text-primary">
              {p.reference_no && <span>{p.reference_no}</span>}
              {p.parcel_no && <span className="inline-flex items-center gap-1 text-muted-foreground"><MapPin className="h-3 w-3" />Parzelle {p.parcel_no}</span>}
            </div>
          )}
          <h1 className="font-display text-2xl font-bold leading-tight">{p.title}</h1>

          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />{[p.address, p.postal_code, p.city].filter(Boolean).join(", ") || "—"}
          </p>
          <Card><CardContent className="p-4">
            <p className="text-xs uppercase text-muted-foreground">{p.listing_type === "rent" ? "Miete / Monat" : "Kaufpreis"}</p>
            <p className="font-display text-3xl font-bold text-gradient-brand">
              {formatCurrency(p.listing_type === "rent" ? (p.rent ? Number(p.rent) : null) : (p.price ? Number(p.price) : null))}
            </p>
            {p.living_area && p.price && p.listing_type !== "rent" && (
              <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(Number(p.price) / Number(p.living_area))} / m²</p>
            )}
          </CardContent></Card>
          <Card><CardContent className="p-4 text-sm">
            <p className="flex items-center gap-2 text-muted-foreground"><User className="h-4 w-4" />Zuständig</p>
            <div className="mt-1 flex items-center gap-2">
              <PropertyAssigneePicker
                propertyId={id}
                assignedIds={assignedIds}
                employees={employees as EmployeeLite[]}
                employeeMap={employeeMap as Map<string, EmployeeLite>}
                size="sm"
              />
              <span className="truncate text-sm">
                {assignedIds.length === 0
                  ? <span className="italic text-muted-foreground">Niemand zugewiesen</span>
                  : assignedIds.map((uid: string) => (employeeMap.get(uid) as any)?.full_name || (employeeMap.get(uid) as any)?.email).filter(Boolean).join(", ")}
              </span>
            </div>
          </CardContent></Card>
          <Card>
            <CardContent className="p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-muted-foreground"><User className="h-4 w-4" />Eigentümer</p>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOwnersOpen(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Verwalten
                </Button>
              </div>
              {currentOwners.length === 0 ? (
                <p className="mt-1 italic text-muted-foreground">Noch kein Eigentümer hinterlegt</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {currentOwners.map((o) => (
                    <li key={o.client_id} className="font-medium">{o.client?.full_name ?? "—"}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Dialog open={ownersOpen} onOpenChange={setOwnersOpen}>
            <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
              <DialogHeader><DialogTitle>Eigentümer</DialogTitle></DialogHeader>
              <PropertyOwnersTab propertyId={id} legacyOwnerClientId={p.owner_client_id ?? p.seller_client_id} />
            </DialogContent>
          </Dialog>

          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setTab("marketing")} className="text-left">
              <Card className="transition hover:border-primary/50 hover:bg-primary/5">
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Matches</p>
                  <p className="font-display text-xl font-bold">{counts?.matches ?? 0}</p>
                </CardContent>
              </Card>
            </button>
            <button type="button" onClick={() => setTab("organisation")} className="text-left">
              <Card className="transition hover:border-primary/50 hover:bg-primary/5">
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Termine</p>
                  <p className="font-display text-xl font-bold">{counts?.appointments ?? 0}</p>
                </CardContent>
              </Card>
            </button>
            <button type="button" onClick={() => setTab("documents")} className="text-left">
              <Card className="transition hover:border-primary/50 hover:bg-primary/5">
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Dokumente</p>
                  <p className="font-display text-xl font-bold">{counts?.documents ?? 0}</p>
                </CardContent>
              </Card>
            </button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-primary/15 bg-primary/5 p-1">
          {[
            { v: "overview", label: "Übersicht" },
            { v: "details", label: "Details" },
            { v: "documents", label: `Dokumente${counts?.documents ? ` (${counts.documents})` : ""}` },
            ...(!p.is_unit ? [{ v: "units", label: `Einheiten${units.length ? ` (${units.length})` : ""}` }] : []),
            { v: "activity", label: "Aktivitäten" },
          ].map((t) => (
            <TabsTrigger
              key={t.v}
              value={t.v}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-soft"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0">
          <TabsContent value="overview" className="mt-0"><OverviewTab p={p} /></TabsContent>

          <TabsContent value="details" className="mt-0">
            <Accordion type="multiple" defaultValue={["facts"]} className="space-y-2">
              <AccordionItem value="facts" className="rounded-xl border px-4">
                <AccordionTrigger className="font-display text-base">Eckdaten</AccordionTrigger>
                <AccordionContent><FactsTab p={p} /></AccordionContent>
              </AccordionItem>
            </Accordion>
          </TabsContent>

          <TabsContent value="documents" className="mt-0"><DocumentsTab propertyId={id} /></TabsContent>
          {!p.is_unit && <TabsContent value="units" className="mt-0"><UnitsTab parentId={id} units={units} /></TabsContent>}
          <TabsContent value="activity" className="mt-0">
            <ActivityTab activities={activities} employees={employees} />
          </TabsContent>
        </div>
      </Tabs>

    </div>
  );
}

/* ----------------- Tabs ----------------- */

function InlineEditCard({
  title, value, propertyId, field, placeholder, tone = "default", rows = 6, aiProperty,
}: {
  title: string; value: string | null; propertyId: string; field: "description" | "internal_notes";
  placeholder?: string; tone?: "default" | "amber"; rows?: number; aiProperty?: any;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [askAi, setAskAi] = useState(false);
  const [aiTone, setAiTone] = useState<"sachlich" | "emotional" | "premium">("sachlich");
  const [aiExtra, setAiExtra] = useState("");
  useEffect(() => { setDraft(value ?? ""); }, [value]);

  const startEdit = () => { if (aiProperty) setAskAi(true); else setEditing(true); };
  const aiPreview = useUsagePreview("ai_expose_generations", !!aiProperty && askAi);

  const generate = useMutation({
    mutationFn: async () => {
      const { generatePropertyDescription } = await import("@/lib/property-ai.functions");
      const payload = {
        titel: aiProperty?.title, typ: aiProperty?.property_type, status: aiProperty?.status,
        vermarktung: aiProperty?.listing_type, strasse: aiProperty?.street, plz: aiProperty?.postal_code,
        ort: aiProperty?.city, kanton: aiProperty?.region, land: aiProperty?.country,
        zimmer: aiProperty?.rooms, schlafzimmer: aiProperty?.bedrooms, badezimmer: aiProperty?.bathrooms,
        wohnflaeche_m2: aiProperty?.living_area, grundstueck_m2: aiProperty?.plot_area,
        baujahr: aiProperty?.construction_year, etage: aiProperty?.floor,
        kaufpreis: aiProperty?.price, miete: aiProperty?.rent_price, nebenkosten: aiProperty?.extra_costs,
        ausstattung: aiProperty?.features, energie: aiProperty?.energy_class,
        bisherige_beschreibung: aiProperty?.description,
      };
      const res = await generatePropertyDescription({ data: { property: payload as any, tone: aiTone, extra: aiExtra || undefined, requestId: crypto.randomUUID() } });
      return res.text;
    },
    onSuccess: (text) => { setDraft(text); setAskAi(false); setEditing(true); toast.success("Text generiert"); qc.invalidateQueries({ queryKey: ["usage"] }); qc.invalidateQueries({ queryKey: ["credits"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Generierung fehlgeschlagen"),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("properties").update({ [field]: draft || null } as any).eq("id", propertyId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Gespeichert"); setEditing(false); qc.invalidateQueries({ queryKey: ["property", propertyId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className={tone === "amber" ? "border-amber-500/30 bg-amber-500/5" : undefined}>
      <CardContent className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className={`font-semibold ${tone === "amber" ? "text-sm text-amber-700 dark:text-amber-400" : ""}`}>{title}</h2>
          {!editing && (
            <Button size="sm" variant="ghost" onClick={startEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />Bearbeiten
            </Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <Textarea rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} />
            <div className="flex justify-end gap-2">
              {aiProperty && (
                <Button size="sm" variant="outline" onClick={() => setAskAi(true)} disabled={generate.isPending}>
                  <Sparkles className="mr-1 h-3.5 w-3.5" />Mit KI neu generieren
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => { setDraft(value ?? ""); setEditing(false); }}>Abbrechen</Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Speichern</Button>
            </div>
          </div>
        ) : value ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{value}</p>
        ) : (
          <button type="button" onClick={startEdit} className="w-full rounded-md border border-dashed p-4 text-sm text-muted-foreground hover:bg-muted/40">
            {placeholder ?? "Klicken zum Hinzufügen"}
          </button>
        )}
      </CardContent>

      {aiProperty && (
        <Dialog open={askAi} onOpenChange={(o) => { if (!generate.isPending) setAskAi(o); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Mit KI generieren?</DialogTitle>
              <DialogDescription>
                Die KI erstellt aus den Objektangaben einen Beschreibungstext. Du kannst den Text danach frei anpassen – oder direkt selbst schreiben.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Tonalität</Label>
                <Select value={aiTone} onValueChange={(v) => setAiTone(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sachlich">Sachlich & informativ</SelectItem>
                    <SelectItem value="emotional">Emotional & einladend</SelectItem>
                    <SelectItem value="premium">Premium & exklusiv</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Zusätzliche Hinweise (optional)</Label>
                <Textarea rows={3} value={aiExtra} onChange={(e) => setAiExtra(e.target.value)} placeholder="z.B. Highlights, Zielgruppe, Besonderheiten…" />
              </div>
              <UsageCostNotice usageKey="ai_expose_generations" preview={aiPreview.data} />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" onClick={() => { setAskAi(false); setEditing(true); }} disabled={generate.isPending}>
                Selbst schreiben
              </Button>
              <Button onClick={() => generate.mutate()} disabled={generate.isPending || aiPreview.isLoading || isBlocked(aiPreview.data)}>
                {generate.isPending ? <><RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />Generiere…</> : <><Sparkles className="mr-1 h-3.5 w-3.5" />{costButtonLabel("Text generieren", aiPreview.data)}</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}


function OverviewMandatesCard({ propertyId }: { propertyId: string }) {
  const { data: mandates = [] } = useQuery({
    queryKey: ["property_overview_mandates", propertyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("mandates")
        .select("id,mandate_type,status,valid_from,valid_until,commission_value,commission_model")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  return (
    <Card><CardContent className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" />Mandate</h3>
        <Button size="sm" variant="ghost" asChild><Link to="/mandates">Alle</Link></Button>
      </div>
      {mandates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kein Mandat hinterlegt.</p>
      ) : (
        <ul className="space-y-2">
          {mandates.map((m: any) => (
            <li key={m.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">{m.mandate_type || "Mandat"}</span>
                <Badge variant="secondary" className="capitalize">{m.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {m.valid_from ? formatDate(m.valid_from) : "—"} – {m.valid_until ? formatDate(m.valid_until) : "offen"}
                {m.commission_value ? ` · ${m.commission_value}${m.commission_model === "percent" ? "%" : ""}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </CardContent></Card>
  );
}

function OverviewTasksCard({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");

  const { data: tasks = [] } = useQuery({
    queryKey: ["property_overview_tasks", propertyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id,title,status,priority,due_date")
        .eq("related_type", "property")
        .eq("related_id", propertyId)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(6);
      return data ?? [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["property_overview_tasks", propertyId] });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tasks").insert({ title, related_type: "property", related_id: propertyId } as any);
      if (error) throw error;
    },
    onSuccess: () => { setTitle(""); invalidate(); toast.success("Aufgabe erstellt"); },
    onError: (e: any) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").update({ status: "done" } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Aufgabe erledigt"); },
  });

  return (
    <Card><CardContent className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-primary" />Offene Aufgaben</h3>
        <Button size="sm" variant="ghost" asChild><Link to="/tasks">Alle</Link></Button>
      </div>
      {tasks.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">Keine offenen Aufgaben.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {tasks.map((t: any) => (
            <li key={t.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <button type="button" onClick={() => complete.mutate(t.id)} title="Als erledigt markieren" className="mt-0.5 text-muted-foreground hover:text-primary">
                <Circle className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t.due_date ? formatDate(t.due_date) : "ohne Datum"}
                  {t.priority === "high" || t.priority === "urgent" ? " · Priorität hoch" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) add.mutate(); }}
          placeholder="Neue Aufgabe…"
        />
        <Button size="icon" onClick={() => add.mutate()} disabled={!title.trim() || add.isPending}><Plus className="h-4 w-4" /></Button>
      </div>
    </CardContent></Card>
  );
}

function OverviewAppointmentsCard({ propertyId }: { propertyId: string }) {
  const { data: items = [] } = useQuery({
    queryKey: ["property_overview_appointments", propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id,title,starts_at,appointment_type,status")
        .eq("property_id", propertyId)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(4);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card><CardContent className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Calendar className="h-4 w-4 text-primary" />Nächste Termine</h3>
        <Button size="sm" variant="ghost" asChild><Link to="/appointments">Alle</Link></Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine anstehenden Termine.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a: any) => (
            <li key={a.id} className="rounded-md border p-2 text-sm">
              <p className="truncate font-medium">{a.title}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(a.start_time)}</p>
            </li>
          ))}
        </ul>
      )}
    </CardContent></Card>
  );
}

function OverviewTab({ p }: { p: any }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <MacroLocationCard property={p} />

        <InlineEditCard
          title="Beschreibung"
          value={p.description}
          propertyId={p.id}
          field="description"
          placeholder="Beschreibung hinzufügen…"
          aiProperty={p}

        />

        {p.features?.length ? (
          <Card><CardContent className="p-6">
            <h2 className="mb-3 font-semibold">Ausstattung</h2>
            <div className="flex flex-wrap gap-2">
              {p.features.map((f: string) => <Badge key={f} variant="secondary">{f}</Badge>)}
            </div>
          </CardContent></Card>
        ) : null}

        <InlineEditCard
          title="Interne Notizen"
          value={p.internal_notes}
          propertyId={p.id}
          field="internal_notes"
          tone="amber"
          rows={4}
          placeholder="Nur intern sichtbar – Notiz hinzufügen…"
        />
      </div>

      <div className="space-y-4">
        <Card><CardContent className="grid grid-cols-2 gap-4 p-6">
          <Stat icon={Maximize} label="Wohnfläche" value={formatArea(p.living_area ? Number(p.living_area) : (p.area ? Number(p.area) : null))} />
          <Stat icon={Maximize} label="Grundstück" value={formatArea(p.plot_area ? Number(p.plot_area) : null)} />
          <Stat icon={Bed} label="Zimmer" value={p.rooms ? String(p.rooms) : "—"} />
          <Stat icon={Bath} label="Bäder" value={p.bathrooms ? String(p.bathrooms) : "—"} />
          <Stat icon={Calendar} label="Baujahr" value={p.year_built ? String(p.year_built) : "—"} />
          <Stat icon={Calendar} label="Renoviert" value={p.renovated_at ? String(p.renovated_at) : "—"} />
          <Stat icon={Zap} label="Energie" value={p.energy_class ?? "—"} />
        </CardContent></Card>

        <OverviewTasksCard propertyId={p.id} />
        <OverviewMandatesCard propertyId={p.id} />
        <OverviewAppointmentsCard propertyId={p.id} />

        <Card><CardContent className="p-5 text-sm">
          <h3 className="mb-1 font-semibold">Erfasst</h3>
          <p className="text-muted-foreground">{formatDateTime(p.created_at)}</p>
        </CardContent></Card>
      </div>
    </div>
  );
}


function FactsTab({ p }: { p: any }) {
  const rows: [string, any][] = [
    ["Titel", p.title],
    ["Typ", propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels]],
    ["Vermarktung", listingTypeLabels[p.listing_type as keyof typeof listingTypeLabels]],
    ["Status", propertyStatusLabels[p.status as keyof typeof propertyStatusLabels]],
    ["Kaufpreis", p.price ? formatCurrency(Number(p.price)) : "—"],
    ["Miete / Monat", p.rent ? formatCurrency(Number(p.rent)) : "—"],
    ["Wohnfläche", formatArea(p.living_area ? Number(p.living_area) : (p.area ? Number(p.area) : null))],
    ["Grundstück", formatArea(p.plot_area ? Number(p.plot_area) : null)],
    ["Zimmer", p.rooms ?? "—"],
    ["Bäder", p.bathrooms ?? "—"],
    ["Stockwerk", p.floor ?? "—"],
    ["Geschosse", p.total_floors ?? "—"],
    ["Baujahr", p.year_built ?? "—"],
    ["Renoviert", p.renovated_at ?? "—"],
    ["Energieklasse", p.energy_class ?? "—"],
    ["Adresse", p.address ?? "—"],
    ["PLZ", p.postal_code ?? "—"],
    ["Ort", p.city ?? "—"],
    ["Land", p.country ?? "—"],
  ];
  return (
    <Card><CardContent className="p-0">
      <dl className="divide-y">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-4 px-6 py-3 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="col-span-2 font-medium">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </CardContent></Card>
  );
}

function OwnerTab({ p }: { p: any }) {
  const ownerId = p.seller_client_id || p.owner_client_id;
  const { data: owner } = useQuery({
    queryKey: ["client", ownerId],
    queryFn: async () => {
      if (!ownerId) return null;
      const { data } = await supabase.from("clients").select("*").eq("id", ownerId).single();
      return data;
    },
    enabled: !!ownerId,
  });

  if (!ownerId) {
    return <EmptyState
      title="Kein Eigentümer hinterlegt"
      description="Verknüpfe einen Kunden vom Typ Verkäufer oder Vermieter mit diesem Objekt."
      action={<Button asChild variant="outline"><Link to="/clients">Zu den Kunden</Link></Button>}
    />;
  }

  if (!owner) return <div className="text-sm text-muted-foreground">Lädt…</div>;

  return (
    <Card><CardContent className="p-6 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display text-xl font-semibold">{owner.full_name}</h3>
          <p className="text-sm text-muted-foreground">{owner.email || "—"} · {owner.phone || "—"}</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/clients/$id" params={{ id: owner.id }}><ExternalLink className="mr-1 h-4 w-4" />Öffnen</Link>
        </Button>
      </div>
      {owner.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{owner.notes}</p>}
    </CardContent></Card>
  );
}

function PropertyImageGallery({ propertyId, images: fallbackImages, title }: { propertyId: string; images: string[]; title: string }) {
  const qc = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [idx, setIdx] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
  const [modalDragOver, setModalDragOver] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const { data: mediaRows } = useQuery({
    queryKey: ["property_media", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("property_media").select("*").eq("property_id", propertyId).order("sort_order");
      return data ?? [];
    },
  });

  const images = useMemo(() => {
    const fromMedia = [...new Set(extractPropertyImagePaths((mediaRows ?? []) as any[]))];
    const merged = [...fromMedia];
    for (const p of fallbackImages) if (p && !merged.includes(p)) merged.push(p);
    return merged;
  }, [mediaRows, fallbackImages]);

  const hasImages = images.length > 0;
  const MAX_PREVIEW = 12;
  const hasMore = images.length > MAX_PREVIEW;
  const slideCount = hasMore ? MAX_PREVIEW + 1 : images.length;
  const isMoreSlide = hasMore && idx >= MAX_PREVIEW;
  const current = hasImages && !isMoreSlide ? images[Math.min(idx, images.length - 1)] : null;

  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const orderList = orderDraft ?? images;

  const saveOrder = async () => {
    if (!orderDraft) return;
    setSavingOrder(true);
    try {
      const updates = await Promise.all(orderDraft.map((fileUrl, i) =>
        supabase
          .from("property_media")
          .update({ sort_order: i + 1, is_cover: i === 0 })
          .eq("property_id", propertyId)
          .eq("file_url", fileUrl),
      ));
      const failed = updates.find(({ error }) => error);
      if (failed?.error) throw failed.error;
      await syncPropertyImagesFromMedia(propertyId);
      setOrderDraft(null);
      setIdx(0);
      toast.success("Reihenfolge gespeichert");
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property_media", propertyId] });
    } catch (e: any) {
      toast.error(e.message ?? "Speichern fehlgeschlagen");
    } finally {
      setSavingOrder(false);
    }
  };


  const handleFiles = async (files: FileList | File[]): Promise<boolean> => {
    const MAX_BYTES = 25 * 1024 * 1024; // 25 MB pro Datei
    const arr = Array.from(files);
    const isImageLike = (f: File) => {
      const n = f.name.toLowerCase();
      return f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$/.test(n);
    };
    const candidates = arr.filter(isImageLike);
    if (candidates.length === 0) { toast.error("Bitte nur Bilddateien"); return false; }
    const tooBig = candidates.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length > 0) {
      toast.error(`${tooBig.length} Datei(en) über 25 MB werden übersprungen`);
    }
    const sized = candidates.filter((f) => f.size <= MAX_BYTES);
    if (sized.length === 0) { return false; }

    setUploading(true);
    try {
      const { convertUnsupportedImages } = await import("@/lib/image-convert");
      const list = await convertUnsupportedImages(sized);
      const paths: string[] = [];
      const mediaRows: any[] = [];
      const baseSort = images.length;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const path = `properties/${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("media").upload(path, f, { upsert: false, contentType: f.type || "image/jpeg" });
        if (error) {
          console.error("upload failed", f.name, error);
          toast.error(`${f.name}: ${error.message}`);
          continue;
        }
        paths.push(path);
        mediaRows.push({
          property_id: propertyId,
          file_url: path,
          file_name: f.name,
          file_type: "image",
          file_size: f.size,
          sort_order: baseSort + i + 1,
          is_cover: !hasImages && i === 0,
        });
      }
      if (paths.length === 0) { return false; }
      const { error: medErr } = await supabase.from("property_media").insert(mediaRows);
      if (medErr) throw medErr;
      await syncPropertyImagesFromMedia(propertyId);
      toast.success(`${paths.length} Bild(er) hochgeladen`);
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property_media", propertyId] });
      return true;
    } catch (e: any) {
      console.error("upload error", e);
      toast.error(e.message ?? "Upload fehlgeschlagen");
      return false;
    } finally {
      setUploading(false);
    }
  };

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); },
  };

  const setAsCover = async (i: number) => {
    if (i === 0) return;
    const coverPath = images[i];
    setIdx(0);
    const { error: resetError } = await supabase.from("property_media").update({ is_cover: false }).eq("property_id", propertyId);
    if (resetError) { toast.error(resetError.message); return; }

    const { error: coverError } = await supabase
      .from("property_media")
      .update({ is_cover: true, sort_order: 1 })
      .eq("property_id", propertyId)
      .eq("file_url", coverPath);
    if (coverError) { toast.error(coverError.message); return; }

    await syncPropertyImagesFromMedia(propertyId);
    toast.success("Als Cover gesetzt");
    qc.invalidateQueries({ queryKey: ["property", propertyId] });
    qc.invalidateQueries({ queryKey: ["property_media", propertyId] });
  };

  const addFromLibrary = async (paths: string[]): Promise<boolean> => {
    const unique = paths.filter((p) => !images.includes(p));
    if (unique.length === 0) { toast.info("Bereits hinzugefügt"); return false; }
    setUploading(true);
    try {
      const baseSort = images.length;
      const rows = unique.map((p, i) => ({
        property_id: propertyId,
        file_url: p,
        file_name: p.split("/").pop() ?? null,
        file_type: "image",
        sort_order: baseSort + i + 1,
        is_cover: !hasImages && i === 0,
      }));
      const { error: medErr } = await supabase.from("property_media").insert(rows);
      if (medErr) throw medErr;
      await syncPropertyImagesFromMedia(propertyId);
      toast.success(`${unique.length} Bild(er) aus Mediathek hinzugefügt`);
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property_media", propertyId] });
      return true;
    } catch (e: any) {
      toast.error(e.message ?? "Hinzufügen fehlgeschlagen");
      return false;
    } finally {
      setUploading(false);
    }
  };

  const deleteImage = async (i: number) => {
    const path = images[i];
    if (!path) return;

    try {
      const { error: storageError } = await supabase.storage.from("media").remove([path]);
      if (storageError) throw storageError;

      const { error: mediaDeleteError } = await supabase
        .from("property_media")
        .delete()
        .eq("property_id", propertyId)
        .eq("file_url", path);
      if (mediaDeleteError) throw mediaDeleteError;

      const nextImages = await syncPropertyImagesFromMedia(propertyId);
      setIdx((cur) => Math.max(0, Math.min(cur, nextImages.length - 1)));
      toast.success("Bild gelöscht");
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property_media", propertyId] });
    } catch (e: any) {
      toast.error(e.message ?? "Löschen fehlgeschlagen");
    }
  };

  if (!hasImages) {
    return (
      <>
        <button
          type="button"
          {...dropHandlers}
          onClick={() => setUploadOpen(true)}
          className={`group relative flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-gradient-soft text-muted-foreground transition-all ${dragOver ? "border-primary bg-primary/10 scale-[1.01] ring-4 ring-primary/20" : "border-border hover:border-primary/60 hover:bg-primary/5"}`}
        >
          <div className={`rounded-full bg-background/60 p-4 shadow-sm transition-transform ${dragOver ? "scale-110" : "group-hover:scale-105"}`}>
            <UploadCloud className={`h-8 w-8 ${dragOver ? "text-primary animate-pulse" : "text-muted-foreground group-hover:text-primary"}`} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">{uploading ? "Wird hochgeladen…" : dragOver ? "Jetzt loslassen" : "Bilder hierher ziehen"}</p>
            <p className="text-xs">oder <span className="font-medium text-primary underline-offset-2 group-hover:underline">klicken zum Hochladen</span> · JPG, PNG, WebP, HEIC · max. 25 MB</p>
          </div>
        </button>
        <UploadModal
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          uploading={uploading}
          dragOver={modalDragOver}
          setDragOver={setModalDragOver}
          onFiles={async (fs) => {
            const ok = await handleFiles(fs);
            if (ok) setUploadOpen(false);
            return ok;
          }}
          propertyId={propertyId}
          existingPaths={images}
          onPickFromLibrary={async (paths) => {
            const ok = await addFromLibrary(paths);
            if (ok) setUploadOpen(false);
            return ok;
          }}
        />
      </>
    );
  }

  return (
    <div {...dropHandlers} className={`group relative h-full w-full overflow-hidden rounded-2xl border bg-muted transition-all ${dragOver ? "ring-4 ring-primary/40 ring-offset-2" : ""}`}>
      {isMoreSlide ? (
        <div className="absolute inset-0 z-0 flex flex-col items-center justify-center gap-4 bg-gradient-soft px-6 text-center">
          <ImageIcon className="h-10 w-10 text-primary" />
          <div>
            <p className="text-lg font-semibold">Sehe weitere Bilder unter «Alle Bilder»</p>
            <p className="text-sm text-muted-foreground">
              Noch {images.length - MAX_PREVIEW} weitere Bild(er) vorhanden.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => setAllOpen(true)}>
              <ImageIcon className="mr-2 h-4 w-4" /> Alle Bilder ({images.length})
            </Button>
            <Button variant="outline" onClick={() => setIdx(0)}>
              <ChevronLeft className="mr-2 h-4 w-4" /> Zurück zum Anfang
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setZoom(1); setLightboxOpen(true); }}
          className="absolute inset-0 z-0 h-full w-full cursor-zoom-in"
          aria-label="Bild vergrössern"
        >
          <img src={getMediaPublicUrl(current!)} alt={title} className="h-full w-full object-cover" />
        </button>
      )}

      {!isMoreSlide && idx === 0 && (
        <Badge className="absolute left-3 top-3 shadow">Cover</Badge>
      )}
      {!isMoreSlide && idx !== 0 && (
        <button onClick={() => setAsCover(idx)} className="absolute left-3 top-3 rounded-md bg-background/85 px-2 py-1 text-xs font-medium shadow hover:bg-background">
          Als Cover setzen
        </button>
      )}
      {!isMoreSlide && (
        <div className="absolute right-3 top-3 rounded-md bg-background/85 px-2 py-1 text-xs font-medium shadow">
          {idx + 1} / {images.length}
        </div>
      )}
      {slideCount > 1 && (
        <>
          <button
            onClick={() => setIdx((i) => (i - 1 + slideCount) % slideCount)}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 shadow opacity-0 transition group-hover:opacity-100 hover:bg-background"
            aria-label="Vorheriges Bild"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {!isMoreSlide && (
            <button
              onClick={() => setIdx((i) => (i + 1) % slideCount)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/85 p-2 shadow opacity-0 transition group-hover:opacity-100 hover:bg-background"
              aria-label="Nächstes Bild"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {Array.from({ length: slideCount }).map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-white" : "w-1.5 bg-white/60 hover:bg-white/90"}`} aria-label={`Bild ${i + 1}`} />
            ))}
          </div>
        </>
      )}


      <label className={`absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 bg-primary/20 backdrop-blur-sm transition ${dragOver ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="rounded-full bg-background/90 p-4 shadow-lg">
          <UploadCloud className="h-8 w-8 text-primary animate-pulse" />
        </div>
        <p className="rounded-md bg-background/90 px-3 py-1 text-sm font-semibold">{uploading ? "Wird hochgeladen…" : "Bilder hier ablegen"}</p>
      </label>

      <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setDeleteIdx(idx)}
          className="flex items-center gap-1.5 rounded-md bg-destructive/90 px-2.5 py-1.5 text-xs font-medium text-destructive-foreground shadow hover:bg-destructive"
          aria-label="Bild löschen"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Löschen
        </button>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-background/85 px-2.5 py-1.5 text-xs font-medium shadow hover:bg-background"
        >
          <Plus className="h-3.5 w-3.5" />
          {uploading ? "Lädt…" : "Hinzufügen"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setAllOpen(true)}
        className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-background/90 px-3 py-1.5 text-xs font-semibold shadow hover:bg-background"
      >
        <ImageIcon className="h-3.5 w-3.5 text-primary" />
        Alle Bilder ({images.length})
      </button>

      <Dialog open={allOpen} onOpenChange={(o) => { setAllOpen(o); if (!o) setOrderDraft(null); }}>
        <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Bilder ({images.length})</DialogTitle>
            <DialogDescription>
              Bilder per Drag &amp; Drop sortieren, ansehen, Cover festlegen, löschen oder neue hochladen. Das erste Bild ist das Cover.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <PropertyImageSorter
              items={orderList}
              getUrl={getMediaPublicUrl}
              title={title}
              onReorder={(next) => setOrderDraft(next)}
              onOpen={(path) => { if (!orderDraft) { setIdx(images.indexOf(path)); setAllOpen(false); } }}
              onSetCover={(path) => setAsCover(images.indexOf(path))}
              onDelete={(path) => setDeleteIdx(images.indexOf(path))}
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t bg-background pt-4 sm:justify-between">
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <UploadCloud className="mr-2 h-4 w-4" /> Bilder hochladen
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOrderDraft(null)} disabled={!orderDraft || savingOrder}>
                Verwerfen
              </Button>
              <Button onClick={saveOrder} disabled={!orderDraft || savingOrder}>
                {savingOrder ? "Speichert…" : "Reihenfolge speichern"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>

      </Dialog>

      <Dialog open={lightboxOpen} onOpenChange={(o) => { setLightboxOpen(o); if (!o) setZoom(1); }}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] gap-0 overflow-hidden border-none bg-black/95 p-0 sm:rounded-2xl [&>button]:hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Bild {Math.min(idx, images.length - 1) + 1} von {images.length}</DialogDescription>
          </DialogHeader>
          <div className="relative flex h-[88vh] w-full items-center justify-center overflow-hidden">
            <img
              key={idx}
              src={getMediaPublicUrl(current!)}
              alt={title}
              className="max-h-full max-w-full select-none object-contain"
              style={{ transform: `scale(${zoom})`, transition: zoom === 1 ? "none" : "transform 150ms ease-out", cursor: zoom > 1 ? "grab" : "default" }}
              draggable={false}
            />

            {/* Preload adjacent images for instant navigation */}
            {images.length > 1 && (
              <div className="hidden" aria-hidden>
                <img src={getMediaPublicUrl(images[(idx + 1) % images.length])} alt="" />
                <img src={getMediaPublicUrl(images[(idx - 1 + images.length) % images.length])} alt="" />
              </div>
            )}

            {/* Top bar */}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 text-white">
              <div className="pointer-events-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setLightboxOpen(false); setZoom(1); }}
                  className="rounded-md bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20"
                  aria-label="Schliessen"
                >
                  <X className="h-4 w-4" />
                </button>
                <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium backdrop-blur">
                  {Math.min(idx, images.length - 1) + 1} / {images.length}
                </span>
              </div>
              <div className="pointer-events-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}
                  disabled={zoom <= 1}
                  className="rounded-md bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-40"
                  aria-label="Verkleinern"
                >
                  <span className="block h-4 w-4 text-lg leading-none">−</span>
                </button>
                <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-medium backdrop-blur">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
                  disabled={zoom >= 4}
                  className="rounded-md bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-40"
                  aria-label="Vergrössern"
                >
                  <Maximize className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  disabled={zoom === 1}
                  className="rounded-md bg-white/10 p-2 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-40"
                  aria-label="Zoom zurücksetzen"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Navigation */}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => { setZoom(1); setIdx((i) => (i - 1 + images.length) % images.length); }}
                  className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white shadow backdrop-blur transition hover:bg-white/25"
                  aria-label="Vorheriges Bild"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => { setZoom(1); setIdx((i) => (i + 1) % images.length); }}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white shadow backdrop-blur transition hover:bg-white/25"
                  aria-label="Nächstes Bild"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
                <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => { setZoom(1); setIdx(i); }}
                      className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"}`}
                      aria-label={`Bild ${i + 1}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        uploading={uploading}
        dragOver={modalDragOver}
        setDragOver={setModalDragOver}
        onFiles={async (fs) => {
          const ok = await handleFiles(fs);
          if (ok) setUploadOpen(false);
          return ok;
        }}
        propertyId={propertyId}
        existingPaths={images}
        onPickFromLibrary={async (paths) => {
          const ok = await addFromLibrary(paths);
          if (ok) setUploadOpen(false);
          return ok;
        }}
      />

      <AlertDialog open={deleteIdx !== null} onOpenChange={(o) => { if (!o) setDeleteIdx(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bild löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieses Bild wird endgültig entfernt. Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => { const i = deleteIdx; setDeleteIdx(null); if (i !== null) await deleteImage(i); }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UploadModal({
  open, onOpenChange, uploading, dragOver, setDragOver, onFiles,
  propertyId, existingPaths, onPickFromLibrary,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  uploading: boolean;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onFiles: (files: File[]) => boolean | Promise<boolean>;
  propertyId: string;
  existingPaths: string[];
  onPickFromLibrary: (paths: string[]) => boolean | Promise<boolean>;
}) {
  const [tab, setTab] = useState<"upload" | "library">("upload");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: library = [], isLoading } = useQuery({
    queryKey: ["media-library", "images"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_media")
        .select("id, file_url, file_name, property_id, properties:property_id(title)")
        .eq("file_type", "image")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const seen = new Set<string>();
      return (data ?? []).filter((m: any) => {
        if (!m.file_url || seen.has(m.file_url)) return false;
        seen.add(m.file_url);
        return true;
      });
    },
    enabled: open && tab === "library",
  });

  const filtered = library.filter((m: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (m.file_name?.toLowerCase().includes(q) || m.properties?.title?.toLowerCase().includes(q));
  });

  const toggle = (p: string) => {
    setSelected((s) => s.includes(p) ? s.filter((x) => x !== p) : [...s, p]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setSelected([]); setSearch(""); setTab("upload"); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bilder hinzufügen</DialogTitle>
          <DialogDescription>Neue Dateien hochladen oder aus der Mediathek auswählen.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">Hochladen</TabsTrigger>
            <TabsTrigger value="library">Aus Mediathek</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
            <button
              type="button"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files));
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-muted-foreground transition-all ${dragOver ? "border-primary bg-primary/10 scale-[1.01] ring-4 ring-primary/20" : "border-border hover:border-primary/60 hover:bg-primary/5"}`}
            >
              <div className={`rounded-full bg-background p-4 shadow-sm transition-transform ${dragOver ? "scale-110" : "group-hover:scale-105"}`}>
                <UploadCloud className={`h-8 w-8 ${dragOver ? "text-primary animate-pulse" : "text-muted-foreground group-hover:text-primary"}`} />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-foreground">
                  {uploading ? "Wird hochgeladen…" : dragOver ? "Jetzt loslassen" : "Bilder hierher ziehen"}
                </p>
                <p className="text-xs">JPG, PNG, WebP, HEIC · max. 25 MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple className="hidden" disabled={uploading}
                onChange={(e) => { if (e.target.files?.length) onFiles(Array.from(e.target.files)); e.target.value = ""; }}
              />
            </button>
            <DialogFooter className="mt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={uploading}>Abbrechen</Button>
              <Button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                <UploadCloud className="mr-2 h-4 w-4" />
                {uploading ? "Lädt…" : "Dateien auswählen"}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="library" className="mt-4">
            <Input
              placeholder="Suche nach Dateiname oder Objekt…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3"
            />
            {isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Lädt…</div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Keine Bilder gefunden</div>
            ) : (
              <div className="grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
                {filtered.map((m: any) => {
                  const isSelected = selected.includes(m.file_url);
                  const alreadyAdded = existingPaths.includes(m.file_url);
                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => !alreadyAdded && toggle(m.file_url)}
                      disabled={alreadyAdded}
                      className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition ${alreadyAdded ? "cursor-not-allowed opacity-40" : isSelected ? "border-primary ring-2 ring-primary/40" : "border-transparent hover:border-primary/50"}`}
                      title={m.file_name ?? ""}
                    >
                      <img src={getMediaPublicUrl(m.file_url)} alt={m.file_name ?? ""} className="h-full w-full object-cover" />
                      {alreadyAdded && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-[10px] font-medium">Bereits hinzugefügt</div>
                      )}
                      {isSelected && !alreadyAdded && (
                        <div className="absolute right-1 top-1 rounded-full bg-primary p-1 text-primary-foreground shadow">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <DialogFooter className="mt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={uploading}>Abbrechen</Button>
              <Button
                onClick={() => onPickFromLibrary(selected)}
                disabled={selected.length === 0 || uploading}
              >
                {selected.length > 0 ? `${selected.length} hinzufügen` : "Auswählen"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}


function MediaTab({ propertyId, cover }: { propertyId: string; cover?: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const { data: media = [] } = useQuery({
    queryKey: ["property_media", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("property_media").select("*").eq("property_id", propertyId).order("sort_order");
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("property_media").insert({ property_id: propertyId, file_url: url, title: title || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Medium hinzugefügt"); setUrl(""); setTitle(""); setOpen(false); qc.invalidateQueries({ queryKey: ["property_media", propertyId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (mid: string) => {
      const { data: deleted, error } = await supabase.from("property_media").delete().eq("id", mid).select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) throw new Error("Keine Berechtigung zum Löschen dieses Mediums.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["property_media", propertyId] }); },
    onError: (e: any) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["property_media", propertyId] }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Medium hinzufügen</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Medium hinzufügen</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
            <div><Label>Titel (optional)</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={() => add.mutate()} disabled={!url || add.isPending}>Hinzufügen</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {media.length === 0 && !cover ? (
        <EmptyState title="Noch keine Medien" description="Lade Bilder oder Pläne hoch, um das Objekt zu präsentieren." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {cover && (
            <div className="group relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted">
              <img src={cover} alt="Cover" className="h-full w-full object-cover" />
              <Badge className="absolute left-2 top-2">Cover</Badge>
            </div>
          )}
          {media.map((m: any) => (
            <div key={m.id} className="group relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted">
              {m.file_type === "image" || m.file_url?.match(/\.(jpe?g|png|webp|gif|avif|jfif)$/i) ? (
                <img src={getMediaPublicUrl(m.file_url)} alt={m.title ?? ""} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                  <a href={getMediaPublicUrl(m.file_url)} target="_blank" rel="noreferrer" className="underline">Datei öffnen</a>
                </div>
              )}
              <button onClick={() => del.mutate(m.id)} className="absolute right-2 top-2 rounded-md bg-background/80 p-1 opacity-0 transition group-hover:opacity-100">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PROPERTY_DOC_TYPES: { value: string; label: string }[] = [
  { value: "property_document", label: "Allgemeines Objektdokument" },
  { value: "contract", label: "Vertrag (Kauf-/Mietvertrag)" },
  { value: "mandate", label: "Maklermandat" },
  { value: "reservation", label: "Reservationsvereinbarung" },
  { value: "reservation_receipt", label: "Reservationsquittung" },
  { value: "nda", label: "Geheimhaltungsvereinbarung (NDA)" },
  { value: "financing", label: "Finanzierungsunterlagen" },
  { value: "media", label: "Bilder / Medien" },
  { value: "other", label: "Sonstiges" },
];

// Dokumenttyp aus Dateiname/Dateiart erraten (Vorschlag, im Dialog änderbar)
function guessPropertyDocType(file: File): string {
  const n = file.name.toLowerCase();
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) return "media";
  const rules: [RegExp, string][] = [
    [/quittung|receipt/, "reservation_receipt"],
    [/reserv/, "reservation"],
    [/nda|geheimhalt|vertraulich/, "nda"],
    [/mandat|auftrag/, "mandate"],
    [/finanz|hypo|kredit|bank|lohn|steuer/, "financing"],
    [/vertrag|kaufv|mietv|contract/, "contract"],
    [/grundriss|plan|grundbuch|kataster|energie|geak|ausweis|police|versicherung|expos/, "property_document"],
  ];
  for (const [re, t] of rules) if (re.test(n)) return t;
  return "property_document";
}
function cleanDocName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}
type PendingDoc = { id: string; file: File; name: string; docType: string };

function DocumentsTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingDoc[]>([]);
  const [notes, setNotes] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string; mime: string | null } | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => { setPending([]); setNotes(""); setProgress(null); };
  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list).map((f) => ({ id: crypto.randomUUID(), file: f, name: cleanDocName(f), docType: guessPropertyDocType(f) }));
    setPending((p) => [...p, ...arr]);
  };
  const updatePending = (id: string, patch: Partial<PendingDoc>) => setPending((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const { data: docs = [] } = useQuery({
    queryKey: ["docs", "property", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("documents").select("*").eq("related_type", "property").eq("related_id", propertyId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!pending.length) throw new Error("Bitte Dateien auswählen");
      const failed: string[] = [];
      setProgress({ done: 0, total: pending.length });
      for (const [i, d] of pending.entries()) {
        try {
          const ext = d.file.name.split(".").pop() ?? "bin";
          const path = await tenantStoragePath(`property/${propertyId}/${crypto.randomUUID()}.${ext}`);
          const { error: upErr } = await supabase.storage.from("documents").upload(path, d.file, {
            contentType: d.file.type || "application/octet-stream", upsert: false,
          });
          if (upErr) throw upErr;
          const { error } = await supabase.from("documents").insert({
            related_type: "property", related_id: propertyId,
            file_name: d.name.trim() || d.file.name, file_url: path,
            document_type: d.docType as any, mime_type: d.file.type || null,
            size_bytes: d.file.size, uploaded_by: user?.id ?? null, notes: notes.trim() || null,
          });
          if (error) throw error;
        } catch (e) {
          console.error("doc upload failed", d.file.name, e);
          failed.push(d.file.name);
        }
        setProgress({ done: i + 1, total: pending.length });
      }
      return { ok: pending.length - failed.length, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (ok) toast.success(ok === 1 ? "Dokument hochgeladen" : `${ok} Dokumente hochgeladen`);
      if (failed.length) toast.error(`Nicht hochgeladen: ${failed.join(", ")}`);
      if (!failed.length) { resetForm(); setOpen(false); }
      else { setPending((p) => p.filter((x) => failed.includes(x.file.name))); setProgress(null); }
      qc.invalidateQueries({ queryKey: ["docs", "property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property_counts", propertyId] });
    },
    onError: (e: any) => { toast.error(e.message); setProgress(null); },
  });

  const resolveDocUrl = async (d: any): Promise<string | null> => {
    const path: string = d.file_url;
    if (!path) { toast.error("Keine Datei vorhanden"); return null; }
    if (path.startsWith("http")) return path;
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast.error(error?.message ?? "Konnte Datei nicht öffnen"); return null; }
    return data.signedUrl;
  };

  const openDoc = async (d: any) => {
    const url = await resolveDocUrl(d);
    if (!url) return;
    setPreview({ name: d.file_name ?? "Dokument", url, mime: d.mime_type ?? null });
  };

  const downloadDoc = async (d: any) => {
    const url = await resolveDocUrl(d);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = d.file_name ?? "Dokument";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };


  const removeDoc = useMutation({
    mutationFn: async (d: any) => {
      if (d.file_url && !d.file_url.startsWith("http")) {
        await supabase.storage.from("documents").remove([d.file_url]);
      }
      await deleteToTrash("documents", d.id);
    },
    onSuccess: () => {
      toast.success("Dokument gelöscht");
      qc.invalidateQueries({ queryKey: ["docs", "property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property_counts", propertyId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Dokumente hochladen</Button>
      </div>
      <Dialog open={open} onOpenChange={(v) => { if (add.isPending) return; setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Dokumente hochladen</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div
              role="button" tabIndex={0}
              onClick={() => docInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") docInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <UploadCloud className="mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">{dragOver ? "Jetzt loslassen" : "Dateien hierher ziehen oder klicken"}</p>
              <p className="text-xs text-muted-foreground">Mehrere Dateien möglich. Typ und Bezeichnung werden vorgeschlagen.</p>
              <input ref={docInputRef} type="file" multiple className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {pending.length > 0 && (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {pending.map((d) => (
                  <div key={d.id} className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_200px_auto] sm:items-center">
                    <div className="min-w-0">
                      <Input value={d.name} onChange={(e) => updatePending(d.id, { name: e.target.value })} aria-label="Bezeichnung" />
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">{d.file.name} · {(d.file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <Select value={d.docType} onValueChange={(v) => updatePending(d.id, { docType: v })}>
                      <SelectTrigger aria-label="Dokumenttyp"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROPERTY_DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" aria-label="Entfernen" disabled={add.isPending}
                      onClick={() => setPending((p) => p.filter((x) => x.id !== d.id))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div><Label>Notizen (optional, für alle Dateien)</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button onClick={() => add.mutate()} disabled={!pending.length || add.isPending}>
              {add.isPending && progress ? `Lädt hoch… ${progress.done}/${progress.total}` : pending.length > 1 ? `${pending.length} Dokumente hochladen` : "Hochladen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {docs.length === 0 ? (
        <EmptyState title="Keine Dokumente" description="Lade Verträge, Pläne oder Energieausweise hoch." />
      ) : (
        <Card><CardContent className="p-0">
          <ul className="divide-y">
            {docs.map((d: any) => {
              const typeLabel = PROPERTY_DOC_TYPES.find((t) => t.value === d.document_type)?.label ?? d.document_type;
              return (
                <li key={d.id} className="flex cursor-pointer items-center justify-between gap-3 px-6 py-3 hover:bg-muted/40" onClick={() => openDoc(d)}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-2 text-[10px]">{typeLabel}</Badge>
                      {formatDateTime(d.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openDoc(d); }}>
                      <ExternalLink className="mr-1 h-3 w-3" />Öffnen
                    </Button>
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); downloadDoc(d); }}>
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); removeDoc.mutate(d); }} disabled={removeDoc.isPending}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent></Card>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle className="truncate pr-8">{preview?.name ?? "Vorschau"}</DialogTitle></DialogHeader>
          {preview && (
            preview.mime?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(preview.url) ? (
              <div className="flex h-[75vh] w-full items-center justify-center rounded-md border bg-muted/40">
                <img src={preview.url} alt={preview.name} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <iframe title="Vorschau" src={preview.url} className="h-[75vh] w-full rounded-md border bg-white" />
            )
          )}
          {preview && (
            <div className="flex items-center justify-between gap-2">
              <a href={preview.url} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm"><ExternalLink className="mr-2 h-4 w-4" />In neuem Tab öffnen</Button>
              </a>
              <a href={preview.url} download={preview.name}>
                <Button size="sm"><Download className="mr-2 h-4 w-4" />Herunterladen</Button>
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>


      <div className="pt-4">
        <h3 className="mb-3 font-display text-lg font-semibold">Generierte Dokumente</h3>
        <GeneratedDocumentsTable filterRelatedType="property" filterRelatedId={propertyId} />
      </div>
    </div>
  );
}

function ChecklistsTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const { data: lists = [] } = useQuery({
    queryKey: ["checklists", "property", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("checklists").select("*").eq("related_type", "property").eq("related_id", propertyId).order("created_at");
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("checklists").insert({ related_type: "property", related_id: propertyId, title });
      if (error) throw error;
    },
    onSuccess: () => { setTitle(""); setOpen(false); qc.invalidateQueries({ queryKey: ["checklists", "property", propertyId] }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Checkliste</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Neue Checkliste</DialogTitle></DialogHeader>
          <div><Label>Titel</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Onboarding Verkauf" /></div>
          <DialogFooter><Button onClick={() => create.mutate()} disabled={!title || create.isPending}>Erstellen</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {lists.length === 0 ? (
        <EmptyState title="Keine Checklisten" description="Strukturiere wiederkehrende Schritte wie Vorbereitung, Vermarktung, Übergabe." />
      ) : (
        <div className="space-y-4">
          {lists.map((cl: any) => <ChecklistCard key={cl.id} checklist={cl} />)}
        </div>
      )}
    </div>
  );
}

function ChecklistCard({ checklist }: { checklist: any }) {
  const qc = useQueryClient();
  const [item, setItem] = useState("");

  const { data: items = [] } = useQuery({
    queryKey: ["checklist_items", checklist.id],
    queryFn: async () => {
      const { data } = await supabase.from("checklist_items").select("*").eq("checklist_id", checklist.id).order("sort_order");
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("checklist_items").insert({ checklist_id: checklist.id, title: item, sort_order: items.length });
      if (error) throw error;
    },
    onSuccess: () => { setItem(""); qc.invalidateQueries({ queryKey: ["checklist_items", checklist.id] }); },
  });

  const toggle = useMutation({
    mutationFn: async ({ iid, done }: { iid: string; done: boolean }) => {
      const { error } = await supabase.from("checklist_items").update({ is_done: done }).eq("id", iid);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["checklist_items", checklist.id] }); },
  });

  const doneCount = items.filter((i: any) => i.is_done).length;

  return (
    <Card><CardContent className="p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{checklist.title}</h3>
        <span className="text-xs text-muted-foreground">{doneCount}/{items.length}</span>
      </div>
      <ul className="mb-3 space-y-1">
        {items.map((it: any) => (
          <li key={it.id}>
            <button onClick={() => toggle.mutate({ iid: it.id, done: !it.is_done })} className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-muted">
              {it.is_done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
              <span className={it.is_done ? "line-through text-muted-foreground" : ""}>{it.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Neuer Punkt…" onKeyDown={(e) => { if (e.key === "Enter" && item) add.mutate(); }} />
        <Button onClick={() => add.mutate()} disabled={!item || add.isPending} size="icon"><Plus className="h-4 w-4" /></Button>
      </div>
    </CardContent></Card>
  );
}

function TasksTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", "property", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("*").eq("related_type", "property").eq("related_id", propertyId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tasks").insert({ related_type: "property", related_id: propertyId, title });
      if (error) throw error;
    },
    onSuccess: () => { setTitle(""); setOpen(false); qc.invalidateQueries({ queryKey: ["tasks", "property", propertyId] }); },
  });

  const toggle = useMutation({
    mutationFn: async ({ tid, done }: { tid: string; done: boolean }) => {
      const { error } = await supabase.from("tasks").update({ status: (done ? "done" : "open") as any }).eq("id", tid);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks", "property", propertyId] }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Aufgabe</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Neue Aufgabe</DialogTitle></DialogHeader>
          <div><Label>Titel</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <DialogFooter><Button onClick={() => add.mutate()} disabled={!title || add.isPending}>Erstellen</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {tasks.length === 0 ? (
        <EmptyState title="Keine Aufgaben" description="Erstelle Aufgaben wie Fotos planen, Inserat schalten, Besichtigung vorbereiten." />
      ) : (
        <Card><CardContent className="p-0">
          <ul className="divide-y">
            {tasks.map((t: any) => (
              <li key={t.id} className="flex items-center gap-3 px-6 py-3">
                <button onClick={() => toggle.mutate({ tid: t.id, done: t.status !== "done" })}>
                  {t.status === "done" ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                </button>
                <div className="flex-1">
                  <p className={"text-sm " + (t.status === "done" ? "line-through text-muted-foreground" : "font-medium")}>{t.title}</p>
                  {t.due_date && <p className="text-xs text-muted-foreground">Fällig: {formatDate(t.due_date)}</p>}
                </div>
                <Badge variant="outline" className="text-xs">{t.priority}</Badge>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}

function AppointmentsTab({ propertyId }: { propertyId: string }) {
  const { data: appts = [] } = useQuery({
    queryKey: ["appts", "property", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("appointments").select("*").eq("property_id", propertyId).order("starts_at", { ascending: false });
      return data ?? [];
    },
  });

  if (appts.length === 0) {
    return <EmptyState
      title="Keine Termine"
      description="Plane Besichtigungen oder Beurkundungen für dieses Objekt."
      action={<Button asChild><Link to="/appointments">Zu den Terminen</Link></Button>}
    />;
  }

  return (
    <Card><CardContent className="p-0">
      <ul className="divide-y">
        {appts.map((a: any) => (
          <li key={a.id} className="px-6 py-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">{a.title}</p>
              <Badge variant="outline">{a.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{formatDateTime(a.starts_at)}{a.location ? ` · ${a.location}` : ""}</p>
          </li>
        ))}
      </ul>
    </CardContent></Card>
  );
}

function MandateTab({ propertyId }: { propertyId: string }) {
  const { data: mandates = [] } = useQuery({
    queryKey: ["mandates", "property", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("mandates").select("*").eq("property_id", propertyId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (mandates.length === 0) {
    return <EmptyState
      title="Kein Mandat hinterlegt"
      description="Lege ein Maklermandat für dieses Objekt an."
      action={<Button asChild><Link to="/mandates">Zu den Mandaten</Link></Button>}
    />;
  }

  return (
    <div className="space-y-3">
      {mandates.map((m: any) => (
        <Card key={m.id}><CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Mandat · {m.commission_model || "—"}</p>
              <p className="text-sm text-muted-foreground">Provision: {m.commission_value ?? "—"} · Gültig bis {m.valid_until ? formatDate(m.valid_until) : "—"}</p>
            </div>
            <Badge>{m.status}</Badge>
          </div>
          {m.notes && <p className="mt-2 text-sm text-muted-foreground">{m.notes}</p>}
        </CardContent></Card>
      ))}
    </div>
  );
}

function ReservationTab({ propertyId }: { propertyId: string }) {
  const { data: rs = [] } = useQuery({
    queryKey: ["reservations", "property", propertyId],
    queryFn: async () => {
      const { data } = await supabase.from("reservations").select("*").eq("property_id", propertyId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (rs.length === 0) {
    return <EmptyState
      title="Keine Reservation"
      description="Erstelle eine Reservationsvereinbarung, sobald ein Interessent das Objekt sichert."
      action={<Button asChild><Link to="/reservations">Zu den Reservationen</Link></Button>}
    />;
  }

  return (
    <div className="space-y-3">
      {rs.map((r: any) => (
        <Card key={r.id}><CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Reservation</p>
              <p className="text-sm text-muted-foreground">Gebühr: {formatCurrency(r.reservation_fee)} · Gültig bis {r.valid_until ? formatDate(r.valid_until) : "—"}</p>
            </div>
            <Badge>{r.status}</Badge>
          </div>
          {r.notes && <p className="mt-2 text-sm text-muted-foreground">{r.notes}</p>}
        </CardContent></Card>
      ))}
    </div>
  );
}

// MatchingTab replaced by <MatchPanel direction="property-to-client" />

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground"><Icon className="h-3 w-3" />{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function ExposeTab({ propertyId, property }: { propertyId: string; property: any }) {
  const { data: exposes = [], isLoading } = useQuery({
    queryKey: ["exposes", propertyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("generated_documents")
        .select("*")
        .eq("related_type", "property").eq("related_id", propertyId)
        .order("created_at", { ascending: false });
      return (data ?? []).filter((d: any) => (d.variables as any)?.kind === "expose");
    },
  });
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="space-y-4">
      <PublicShareCard property={property} />
      <PortalPublishCard property={property} />
      <Card><CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h3 className="font-display text-lg font-semibold">Exposé erstellen</h3>
          <p className="text-sm text-muted-foreground">Geführter Wizard: Vorlage, Inhalte, Galerie, Vorschau und PDF-Download.</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <FileText className="mr-1 h-4 w-4" />Exposé erstellen
        </Button>
      </CardContent></Card>

      <PropertyExposeWizardDialog
        propertyId={propertyId}
        property={property}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
      />

      <Card><CardContent className="p-6">
        <h4 className="mb-3 font-semibold">Bisher erstellte Exposés</h4>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Wird geladen…</p>
        ) : exposes.length === 0 ? (
          <EmptyState title="Noch keine Exposés" description="Starte den Wizard, um das erste Exposé zu erstellen." />
        ) : (
          <div className="space-y-2">
            {exposes.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{(d.variables as any)?.title ?? "Exposé"}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(d.created_at)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPreviewHtml(d.html_content)}>
                  <ExternalLink className="mr-1 h-3 w-3" />Ansehen
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>

      <Dialog open={!!previewHtml} onOpenChange={(o) => !o && setPreviewHtml(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>Exposé-Vorschau</DialogTitle></DialogHeader>
          {previewHtml && <iframe title="Exposé" srcDoc={previewHtml} className="h-[75vh] w-full rounded border" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnitsTab({ parentId, units }: { parentId: string; units: any[] }) {
  if (!units.length) {
    return (
      <EmptyState
        title="Noch keine Einheiten erfasst"
        description="Lege einzelne Wohnungen oder Einheiten an, die zu dieser Liegenschaft gehören."
        action={
          <Button asChild>
            <Link to="/properties" search={{ newUnitParent: parentId } as any}>
              <Plus className="mr-1 h-4 w-4" />Einheit hinzufügen
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Nr.</th>
                <th className="px-4 py-2 text-left">Bezeichnung</th>
                <th className="px-4 py-2 text-left">Typ</th>
                <th className="px-4 py-2 text-left">Etage</th>
                <th className="px-4 py-2 text-right">Zimmer</th>
                <th className="px-4 py-2 text-right">Fläche</th>
                <th className="px-4 py-2 text-right">Preis / Miete</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {units.map((u) => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{u.unit_number || "—"}</td>
                  <td className="px-4 py-2">{u.title}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.unit_type || propertyTypeLabels[u.property_type as keyof typeof propertyTypeLabels] || "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.unit_floor || "—"}</td>
                  <td className="px-4 py-2 text-right">{u.rooms ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{formatArea(u.living_area ? Number(u.living_area) : null)}</td>
                  <td className="px-4 py-2 text-right">
                    {u.listing_type === "rent"
                      ? (u.rent ? formatCurrency(Number(u.rent)) : "—")
                      : (u.price ? formatCurrency(Number(u.price)) : "—")}
                  </td>
                  <td className="px-4 py-2"><Badge variant="outline" className={getPropertyStatusBadgeClass(u.status)}>{propertyStatusLabels[u.status as keyof typeof propertyStatusLabels]}</Badge></td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/properties/$id" params={{ id: u.id }}>Öffnen<ExternalLink className="ml-1 h-3 w-3" /></Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

const FIELD_LABELS: Record<string, string> = {
  title: "Titel", property_type: "Objekttyp", listing_type: "Vermarktungsart",
  status: "Status", marketing_type: "Marketing-Typ", building_type: "Gebäudetyp",
  is_unit: "Ist Einheit", parent_property_id: "Übergeordnetes Objekt",
  owner_client_id: "Eigentümer", seller_client_id: "Verkäufer", assigned_to: "Zuständig",
  address: "Adresse", postal_code: "PLZ", city: "Ort", country: "Land",
  floor: "Etage", living_area: "Wohnfläche", area: "Fläche", usable_area: "Nutzfläche",
  plot_area: "Grundstück", rooms: "Zimmer", bathrooms: "Bäder",
  total_floors: "Etagen gesamt", year_built: "Baujahr", renovated_at: "Renoviert",
  price: "Kaufpreis", rent: "Miete", reservation_amount_default: "Reservation",
  internal_minimum_price: "Mindestpreis (intern)", heating_type: "Heizung",
  energy_source: "Energiequelle", energy_class: "Energieklasse",
  description: "Beschreibung", internal_notes: "Interne Notizen",
  features: "Ausstattung", images: "Bilder",
};

function fmtVal(v: any): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  if (Array.isArray(v)) return v.length ? `${v.length} Einträge` : "—";
  if (typeof v === "object") return "geändert";
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

function ActivityTab({ activities, employees }: { activities: any[]; employees: any[] }) {
  if (!activities.length) {
    return (
      <EmptyState
        title="Noch keine Aktivitäten"
        description="Hier erscheinen alle Bearbeitungen, Statusänderungen und Ereignisse zu dieser Immobilie."
      />
    );
  }
  const empMap = new Map(employees.map((e: any) => [e.id, e.full_name || e.email]));
  return (
    <Card>
      <CardContent className="p-6">
        <ol className="relative space-y-5 border-l border-border pl-6">
          {activities.map((a) => {
            const meta = a.metadata ?? {};
            const changes: Record<string, { from: any; to: any }> = meta.changes ?? {};
            const changeKeys = Object.keys(changes);
            const ownerChanged = !!meta.owner_changed;
            const actor = a.actor_id ? empMap.get(a.actor_id) : null;
            return (
              <li key={a.id} className="relative">
                <span className="absolute -left-[31px] mt-1.5 inline-block h-3 w-3 rounded-full border-2 border-background bg-primary" />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{a.action}</p>
                  {changeKeys.length > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {changeKeys.length} Änderung{changeKeys.length === 1 ? "" : "en"}
                    </Badge>
                  )}
                  {ownerChanged && <Badge variant="outline" className="text-[10px]">Eigentümerwechsel</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(a.created_at)}
                  {actor ? ` · ${actor}` : ""}
                </p>

                {changeKeys.length > 0 && (
                  <div className="mt-2 overflow-hidden rounded-md border bg-muted/20">
                    <table className="w-full text-[12px]">
                      <tbody>
                        {changeKeys.map((k) => (
                          <tr key={k} className="border-b last:border-b-0">
                            <td className="px-3 py-1.5 font-medium text-muted-foreground w-1/3">
                              {FIELD_LABELS[k] ?? k}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className="text-muted-foreground line-through">{fmtVal(changes[k]?.from)}</span>
                              <span className="mx-2 text-muted-foreground">→</span>
                              <span className="font-medium">{fmtVal(changes[k]?.to)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {meta.from && meta.to && !changeKeys.length && (
                  <p className="mt-1 text-xs">
                    <span className="text-muted-foreground line-through">{String(meta.from)}</span>
                    <span className="mx-2">→</span>
                    <span className="font-medium">{String(meta.to)}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function fmtRange(min: number | null | undefined, max: number | null | undefined, suffix = "", currency = "") {
  const f = (n: number) => currency ? formatCurrency(n) : n.toLocaleString("de-CH", { maximumFractionDigits: 0 });
  if (min == null && max == null) return "—";
  if (min == null) return `bis ${f(max!)}${suffix}`;
  if (max == null) return `ab ${f(min)}${suffix}`;
  if (min === max) return `${f(min)}${suffix}`;
  return `${f(min)} – ${f(max)}${suffix}`;
}

const verdictMap: Record<string, { label: string; cls: string }> = {
  strong_buy: { label: "Starker Kauf", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  buy: { label: "Kaufempfehlung", cls: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
  hold: { label: "Halten / Beobachten", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  caution: { label: "Vorsicht", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30" },
  avoid: { label: "Eher vermeiden", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
};
const trendMap: Record<string, { label: string; cls: string; arrow: string }> = {
  rising: { label: "Steigend", cls: "text-emerald-600", arrow: "↗" },
  stable: { label: "Stabil", cls: "text-blue-600", arrow: "→" },
  declining: { label: "Rückläufig", cls: "text-red-600", arrow: "↘" },
  mixed: { label: "Gemischt", cls: "text-amber-600", arrow: "↔" },
};
const comparisonMap: Record<string, { label: string; cls: string }> = {
  below_market: { label: "Unter Marktwert", cls: "text-emerald-600" },
  at_market: { label: "Marktgerecht", cls: "text-blue-600" },
  above_market: { label: "Über Marktwert", cls: "text-red-600" },
  unknown: { label: "Nicht eindeutig", cls: "text-muted-foreground" },
};

function MarketAnalysisTab({ property }: { property: any }) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: history = [] } = useQuery({
    queryKey: ["market_analyses", property.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("property_market_analyses")
        .select("id, created_at, sections, model, created_by")
        .eq("property_id", property.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const current = history.find((h: any) => h.id === selectedId) ?? history[0];
  const sections: any = current?.sections;

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("property-market-analysis", {
        body: { property },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await qc.invalidateQueries({ queryKey: ["market_analyses", property.id] });
      setSelectedId((data as any).id ?? null);
      toast.success("Marktanalyse erstellt");
    } catch (e: any) {
      toast.error(e?.message ?? "Marktanalyse fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  const deleteAnalysis = async (id: string) => {
    if (!(await confirm({ title: "Analyse löschen?", description: "Diese Marktanalyse wird unwiderruflich entfernt.", confirmText: "Löschen" }))) return;
    const { error } = await supabase.from("property_market_analyses").delete().eq("id", id);
    if (error) return toast.error("Löschen fehlgeschlagen");
    if (selectedId === id) setSelectedId(null);
    qc.invalidateQueries({ queryKey: ["market_analyses", property.id] });
    toast.success("Analyse gelöscht");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg">
              <TrendingUp className="h-5 w-5 text-primary" />
              KI-Marktanalyse
            </h2>
            <p className="text-sm text-muted-foreground">
              Kaufpreis, Mietpotenzial & Lageeinschätzung – alle Versionen werden gespeichert.
            </p>
          </div>
          <Button onClick={runAnalysis} disabled={loading} className="gap-2">
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {history.length ? "Neue Analyse" : "Analyse starten"}
          </Button>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Historie</span>
              {history.map((h: any) => {
                const isActive = (current?.id === h.id);
                return (
                  <button
                    key={h.id}
                    onClick={() => setSelectedId(h.id)}
                    className={`group flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${isActive ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  >
                    <Calendar className="h-3 w-3" />
                    {formatDateTime(h.created_at)}
                    <Trash2
                      className="h-3 w-3 opacity-0 hover:text-destructive group-hover:opacity-60"
                      onClick={(e) => { e.stopPropagation(); deleteAnalysis(h.id); }}
                    />
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {!sections && !loading && (
        <Card><CardContent className="p-10 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Klicke auf <strong>Analyse starten</strong>, um eine KI-gestützte Marktbeobachtung zu erstellen.
          </p>
        </CardContent></Card>
      )}
      {loading && !sections && (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
          KI analysiert Markt, Lage und Preise…
        </CardContent></Card>
      )}

      {sections && (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.recommendation && (
            <Card className={`md:col-span-2 border-2 ${verdictMap[sections.recommendation.verdict]?.cls ?? ""}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-background/60 p-2"><CheckCircle2 className="h-5 w-5" /></div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide opacity-70">Empfehlung</p>
                    <p className="font-display text-lg">{verdictMap[sections.recommendation.verdict]?.label ?? sections.recommendation.verdict}</p>
                  </div>
                </div>
                <p className="max-w-xl text-sm">{sections.recommendation.summary}</p>
              </CardContent>
            </Card>
          )}

          {sections.location && (
            <Card>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-display text-base"><MapPin className="h-4 w-4 text-primary" />Lageanalyse</h3>
                  <Badge variant="secondary">{sections.location.score}/10</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{sections.location.summary}</p>
                {sections.location.highlights?.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {sections.location.highlights.map((h: string, i: number) => (
                      <li key={i} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span>{h}</span></li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {sections.trend && (
            <Card>
              <CardContent className="space-y-3 p-5">
                <h3 className="flex items-center gap-2 font-display text-base"><TrendingUp className="h-4 w-4 text-primary" />Markttrend</h3>
                <div className={`flex items-baseline gap-2 ${trendMap[sections.trend.direction]?.cls ?? ""}`}>
                  <span className="text-3xl">{trendMap[sections.trend.direction]?.arrow}</span>
                  <span className="font-display text-lg">{trendMap[sections.trend.direction]?.label ?? sections.trend.direction}</span>
                </div>
                <p className="text-sm text-muted-foreground">{sections.trend.outlook}</p>
              </CardContent>
            </Card>
          )}

          {sections.purchase_price && (
            <Card>
              <CardContent className="space-y-3 p-5">
                <h3 className="flex items-center gap-2 font-display text-base"><Banknote className="h-4 w-4 text-primary" />Kaufpreis</h3>
                <div className="grid grid-cols-2 gap-3">
                  <MarketStat label="Preis pro m²" value={fmtRange(sections.purchase_price.price_per_sqm_min, sections.purchase_price.price_per_sqm_max, ` ${sections.purchase_price.currency}/m²`)} />
                  <MarketStat label="Verkehrswert" value={fmtRange(sections.purchase_price.estimated_value_min, sections.purchase_price.estimated_value_max, "", sections.purchase_price.currency)} />
                </div>
                <div className={`text-sm font-medium ${comparisonMap[sections.purchase_price.comparison]?.cls ?? ""}`}>
                  {comparisonMap[sections.purchase_price.comparison]?.label}
                </div>
                <p className="text-xs text-muted-foreground">{sections.purchase_price.comment}</p>
              </CardContent>
            </Card>
          )}

          {sections.rental && (
            <Card>
              <CardContent className="space-y-3 p-5">
                <h3 className="flex items-center gap-2 font-display text-base"><Building2 className="h-4 w-4 text-primary" />Vermietungspotenzial</h3>
                <div className="grid grid-cols-2 gap-3">
                  <MarketStat label="Miete pro m²" value={fmtRange(sections.rental.rent_per_sqm_min, sections.rental.rent_per_sqm_max, " /m²")} />
                  <MarketStat label="Monatsmiete" value={fmtRange(sections.rental.monthly_rent_min, sections.rental.monthly_rent_max)} />
                  {(sections.rental.gross_yield_min != null || sections.rental.gross_yield_max != null) && (
                    <MarketStat label="Bruttorendite" value={fmtRange(sections.rental.gross_yield_min, sections.rental.gross_yield_max, " %")} className="col-span-2" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{sections.rental.comment}</p>
              </CardContent>
            </Card>
          )}

          {sections.opportunities?.length > 0 && (
            <Card className="border-emerald-500/30">
              <CardContent className="space-y-2 p-5">
                <h3 className="flex items-center gap-2 font-display text-base text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />Chancen
                </h3>
                <ul className="space-y-1.5 text-sm">
                  {sections.opportunities.map((o: string, i: number) => (
                    <li key={i} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /><span>{o}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {sections.risks?.length > 0 && (
            <Card className="border-red-500/30">
              <CardContent className="space-y-2 p-5">
                <h3 className="flex items-center gap-2 font-display text-base text-red-700 dark:text-red-400">
                  <Activity className="h-4 w-4" />Risiken
                </h3>
                <ul className="space-y-1.5 text-sm">
                  {sections.risks.map((r: string, i: number) => (
                    <li key={i} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" /><span>{r}</span></li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="md:col-span-2 px-1 text-xs text-muted-foreground">
            ⚠️ KI-generierte Einschätzung – ersetzt keine professionelle Verkehrswertermittlung.
            {current?.created_at && ` · Erstellt ${formatDateTime(current.created_at)}`}
            {current?.model && ` · ${current.model}`}
          </div>
        </div>
      )}
    </div>
  );
}

function MarketStat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-lg border bg-muted/30 p-3 ${className}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-base">{value}</p>
    </div>
  );
}
