import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, ArrowRight, Check, Plus, Trash2,
  Home, Building2, Building, Briefcase, TreePine, Car, Layers,
  Box, Boxes, Layers3, Upload, ImageIcon, Star, X, Library, MapPin, Sparkles, Loader2, FileText,
  Ruler, Coins, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { propertyStatusLabels } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { convertUnsupportedImages } from "@/lib/image-convert";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useServerFn } from "@tanstack/react-start";
import { lookupSwissParcel } from "@/lib/property-location.functions";
import { generateLocationDescription } from "@/lib/property-ai.functions";
import { FeaturePickerDialog, useFeatureOptions } from "@/components/properties/FeaturePickerDialog";
import { featureIcon } from "@/components/properties/feature-icons";
import { PropertyPhoto, propertyPhotoCandidates } from "@/components/properties/PropertyPhoto";

/* -------------------- Typen -------------------- */

type Structure = "single" | "building" | "unit_in_building";
type Marketing = "sale" | "rent" | "off_market";

const PROP_TYPES = [
  { v: "house",       icon: Home },
  { v: "mixed_use",   icon: Building2 },
  { v: "apartment",   icon: Building },
  { v: "commercial",  icon: Briefcase },
  { v: "land",        icon: TreePine },
  { v: "parking",     icon: Car },
  { v: "other",       icon: Layers },
] as const;

const STRUCTURES: { v: Structure; icon: any }[] = [
  { v: "single",            icon: Box },
  { v: "building",          icon: Boxes },
  { v: "unit_in_building",  icon: Layers3 },
];

export type WizardMedia = {
  file_url: string;
  file_name: string | null;
  file_type: string | null;
  title: string | null;
  is_cover: boolean;
  source: "upload" | "library";
  library_media_id?: string | null;
};

const STATUSES = ["draft","preparation","available","reserved","sold","rented","archived"] as const;

export type Unit = {
  unit_number: string;
  unit_type: string;
  unit_floor: string;
  rooms: string;
  living_area: string;
  price: string;
  rent: string;
  unit_status: string;
  separately_marketable: boolean;
};

export type WizardData = {
  property_type: string;
  structure: Structure;
  parent_property_id: string | null;
  title: string;
  marketing_type: Marketing;
  listing_type: "sale" | "rent";
  status: string;
  owner_client_id: string | null;
  assigned_to: string | null;
  address: string;
  postal_code: string;
  city: string;
  country: string;
  floor: string;
  location_description: string;
  latitude: number | null;
  longitude: number | null;
  parcel_no: string;
  e_grid: string;
  living_area: string;
  usable_area: string;
  plot_area: string;
  rooms: string;
  bathrooms: string;
  total_floors: string;
  year_built: string;
  renovated_at: string;
  price: string;
  rent: string;
  ancillary_costs: string;
  reservation_amount_default: string;
  internal_minimum_price: string;
  commission_model: string;
  commission_value: string;
  has_balcony: boolean;
  has_terrace: boolean;
  has_garden: boolean;
  has_lift: boolean;
  has_garage: boolean;
  has_parking: boolean;
  cellar_available: boolean;
  heating_type: string;
  energy_source: string;
  energy_class: string;
  features_extra: string;
  image_url: string;
  description: string;
  internal_notes: string;
  media: WizardMedia[];
  units: Unit[];
};

const empty: WizardData = {
  property_type: "house",
  structure: "single",
  parent_property_id: null,
  title: "",
  marketing_type: "sale",
  listing_type: "sale",
  status: "draft",
  owner_client_id: null,
  assigned_to: null,
  address: "",
  postal_code: "",
  city: "",
  country: "CH",
  floor: "",
  location_description: "",
  latitude: null,
  longitude: null,
  parcel_no: "",
  e_grid: "",
  living_area: "",
  usable_area: "",
  plot_area: "",
  rooms: "",
  bathrooms: "",
  total_floors: "",
  year_built: "",
  renovated_at: "",
  price: "",
  rent: "",
  ancillary_costs: "",
  reservation_amount_default: "",
  internal_minimum_price: "",
  commission_model: "",
  commission_value: "",
  has_balcony: false,
  has_terrace: false,
  has_garden: false,
  has_lift: false,
  has_garage: false,
  has_parking: false,
  cellar_available: false,
  heating_type: "",
  energy_source: "",
  energy_class: "",
  features_extra: "",
  image_url: "",
  description: "",
  internal_notes: "",
  media: [],
  units: [],
};

export type WizardSubmit = {
  property: Record<string, any>;
  units: Record<string, any>[];
  media: WizardMedia[];
};

function isWizardImage(m: WizardMedia): boolean {
  return !m.file_type || m.file_type === "image" || m.file_type.startsWith("image/");
}

function ensureWizardCover(list: WizardMedia[]): WizardMedia[] {
  if (list.length === 0) return list;
  const firstImage = list.findIndex(isWizardImage);
  if (list.some((m) => m.is_cover && isWizardImage(m))) {
    return list.map((m) => (isWizardImage(m) ? m : { ...m, is_cover: false }));
  }
  return list.map((m, i) => ({ ...m, is_cover: i === firstImage }));
}

function buildFeatures(d: WizardData): string[] {
  const f: string[] = [];
  if (d.has_balcony) f.push("Balkon");
  if (d.has_terrace) f.push("Terrasse");
  if (d.has_garden) f.push("Garten");
  if (d.has_lift) f.push("Lift");
  if (d.has_garage) f.push("Garage");
  if (d.has_parking) f.push("Parkplatz");
  if (d.cellar_available) f.push("Keller");
  if (d.features_extra) {
    d.features_extra.split(",").map(s => s.trim()).filter(Boolean).forEach(x => f.push(x));
  }
  return f;
}

function num(s: string): number | null {
  if (s === "" || s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function buildSubmitPayload(d: WizardData): WizardSubmit {
  const isUnit = d.structure === "unit_in_building";
  const isMfh = d.property_type === "mixed_use" || d.structure === "building";
  const listing_type: "sale" | "rent" = d.marketing_type === "rent" ? "rent" : "sale";
  const property: Record<string, any> = {
    title: d.title,
    property_type: d.property_type,
    listing_type,
    status: d.status,
    marketing_type: d.marketing_type,
    building_type: isMfh ? "multi_family" : "single",
    is_unit: isUnit,
    parent_property_id: isUnit ? d.parent_property_id : null,
    owner_client_id: d.owner_client_id,
    seller_client_id: d.owner_client_id,
    assigned_to: d.assigned_to,
    address: d.address || null,
    postal_code: d.postal_code || null,
    city: d.city || null,
    country: d.country || null,
    floor: showsSingleFloor(d) ? num(d.floor) : null,
    location_description: d.location_description || null,
    latitude: d.latitude,
    longitude: d.longitude,
    parcel_no: d.parcel_no || null,
    e_grid: d.e_grid || null,
    living_area: num(d.living_area),
    area: num(d.living_area),
    usable_area: num(d.usable_area),
    plot_area: num(d.plot_area),
    rooms: num(d.rooms),
    bathrooms: num(d.bathrooms),
    total_floors: showsTotalFloors(d) ? num(d.total_floors) : null,
    year_built: num(d.year_built),
    renovated_at: num(d.renovated_at),
    price: num(d.price),
    rent: num(d.rent),
    reservation_amount_default: num(d.reservation_amount_default),
    internal_minimum_price: num(d.internal_minimum_price),
    heating_type: d.heating_type || null,
    energy_source: d.energy_source || null,
    energy_class: d.energy_class || null,
    description: d.description || null,
    internal_notes: d.internal_notes || null,
    features: buildFeatures(d),
    images: (() => {
      const cover = d.media.find((m) => m.is_cover) ?? d.media[0];
      if (cover) return [cover.file_url];
      return d.image_url ? [d.image_url] : null;
    })(),
  };

  const units = isMfh
    ? d.units.map((u) => ({
        title: u.unit_number ? `Einheit ${u.unit_number}` : "Einheit",
        property_type: u.unit_type || "apartment",
        listing_type,
        status: u.unit_status || "draft",
        is_unit: true,
        unit_number: u.unit_number || null,
        unit_type: u.unit_type || null,
        unit_floor: u.unit_floor || null,
        unit_status: u.unit_status || null,
        rooms: num(u.rooms),
        living_area: num(u.living_area),
        area: num(u.living_area),
        price: num(u.price),
        rent: num(u.rent),
        address: d.address || null,
        postal_code: d.postal_code || null,
        city: d.city || null,
        country: d.country || null,
      }))
    : [];

  return { property, units, media: d.media };
}

/* -------------------- Wizard-Komponente -------------------- */

const STEP_KEYS = [
  "type", "structure", "basics", "address", "areas",
  "price", "equipment", "media", "units", "summary",
] as const;

const STEP_ICONS: Record<(typeof STEP_KEYS)[number], any> = {
  type: Home,
  structure: Boxes,
  basics: FileText,
  address: MapPin,
  areas: Ruler,
  price: Coins,
  equipment: Sparkles,
  media: ImageIcon,
  units: Layers3,
  summary: ClipboardCheck,
};

function hydrateFromProperty(p: any): WizardData {
  if (!p) return { ...empty };
  const features: string[] = Array.isArray(p.features) ? p.features : [];
  const known = new Set(["Balkon","Terrasse","Garten","Lift","Garage","Parkplatz","Keller"]);
  const extra = features.filter((f) => !known.has(f)).join(", ");
  const str = (v: any) => (v === null || v === undefined ? "" : String(v));
  const isUnit = !!p.is_unit;
  const isMfh = p.property_type === "mixed_use" || p.building_type === "multi_family";
  const fallbackMedia: WizardMedia[] = Array.isArray(p.images)
    ? p.images
        .filter(Boolean)
        .map((fileUrl: string, index: number) => ({
          file_url: fileUrl,
          file_name: fileUrl.split("/").pop() ?? null,
          file_type: /\.(jpe?g|png|webp|gif|avif|jfif|bmp)$/i.test(fileUrl) ? "image" : null,
          title: null,
          is_cover: index === 0,
          source: "upload" as const,
        }))
    : [];
  return {
    ...empty,
    property_type: p.property_type ?? "house",
    structure: isUnit ? "unit_in_building" : isMfh ? "building" : "single",
    parent_property_id: p.parent_property_id ?? null,
    title: p.title ?? "",
    marketing_type: (p.marketing_type as any) ?? (p.listing_type === "rent" ? "rent" : "sale"),
    listing_type: (p.listing_type as any) ?? "sale",
    status: p.status ?? "draft",
    owner_client_id: p.owner_client_id ?? p.seller_client_id ?? null,
    assigned_to: p.assigned_to ?? null,
    address: p.address ?? "",
    postal_code: p.postal_code ?? "",
    city: p.city ?? "",
    country: p.country ?? "CH",
    floor: str(p.floor),
    location_description: p.location_description ?? "",
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    parcel_no: p.parcel_no ?? "",
    e_grid: p.e_grid ?? "",
    living_area: str(p.living_area ?? p.area),
    usable_area: str(p.usable_area),
    plot_area: str(p.plot_area),
    rooms: str(p.rooms),
    bathrooms: str(p.bathrooms),
    total_floors: str(p.total_floors),
    year_built: str(p.year_built),
    renovated_at: str(p.renovated_at),
    price: str(p.price),
    rent: str(p.rent),
    ancillary_costs: "",
    reservation_amount_default: str(p.reservation_amount_default),
    internal_minimum_price: str(p.internal_minimum_price),
    commission_model: "",
    commission_value: "",
    has_balcony: features.includes("Balkon"),
    has_terrace: features.includes("Terrasse"),
    has_garden: features.includes("Garten"),
    has_lift: features.includes("Lift"),
    has_garage: features.includes("Garage"),
    has_parking: features.includes("Parkplatz"),
    cellar_available: features.includes("Keller"),
    heating_type: p.heating_type ?? "",
    energy_source: p.energy_source ?? "",
    energy_class: p.energy_class ?? "",
    features_extra: extra,
    image_url: Array.isArray(p.images) ? (propertyPhotoCandidates(p.images)[0] ?? "") : "",
    description: p.description ?? "",
    internal_notes: p.internal_notes ?? "",
    media: fallbackMedia,
    units: [],
  };
}

export function PropertyWizard({
  open, onOpenChange, onSubmit, submitting, initial, mode = "create",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (payload: WizardSubmit) => void;
  submitting?: boolean;
  initial?: any;
  mode?: "create" | "edit";
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(mode === "edit" ? 2 : 0);
  const [d, setD] = useState<WizardData>(() => initial ? hydrateFromProperty(initial) : { ...empty });

  useEffect(() => {
    if (open) { setStep(mode === "edit" ? 2 : 0); setD(initial ? hydrateFromProperty(initial) : { ...empty }); }
  }, [open, initial, mode]);

  const isMfh = d.property_type === "mixed_use" || d.structure === "building";
  const showUnitsStep = isMfh;

  const visibleSteps = useMemo(() => {
    return STEP_KEYS.map((key, idx) => ({ idx, key }))
      .filter(s => (mode !== "edit" || s.idx >= 2) && (showUnitsStep || s.idx !== 8));
  }, [mode, showUnitsStep]);

  const employees = useQuery({
    queryKey: ["wizard_employees"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, email").eq("is_active", true);
      return data ?? [];
    },
    enabled: open,
  });

  const owners = useQuery({
    queryKey: ["wizard_owner_clients"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name, email, client_type")
        .in("client_type", ["seller", "landlord", "investor", "other"])
        .order("full_name");
      return data ?? [];
    },
    enabled: open,
  });

  const buildings = useQuery({
    queryKey: ["wizard_parent_buildings"],
    queryFn: async () => {
      const { data } = await supabase.from("properties")
        .select("id, title, address, city")
        .or("property_type.eq.mixed_use,building_type.eq.multi_family")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: open && d.structure === "unit_in_building",
  });

  const existingMedia = useQuery({
    queryKey: ["wizard_existing_media", initial?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_media")
        .select("id, file_url, file_name, file_type, title, is_cover, sort_order")
        .eq("property_id", initial.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((item) => ({
        file_url: item.file_url,
        file_name: item.file_name,
        file_type: item.file_type,
        title: item.title,
        is_cover: !!item.is_cover,
        source: "upload" as const,
        library_media_id: item.id,
      }));
    },
    enabled: open && mode === "edit" && !!initial?.id,
  });

  useEffect(() => {
    if (!open || mode !== "edit") return;
    if (!existingMedia.data || existingMedia.data.length === 0) return;

    setD((prev) => ({
      ...prev,
      media: prev.media.length === existingMedia.data.length && prev.media.every((item, index) => item.file_url === existingMedia.data?.[index]?.file_url)
        ? prev.media
        : ensureWizardCover(existingMedia.data),
    }));
  }, [existingMedia.data, mode, open]);

  const canProceed = (() => {
    if (step === 2) return !!d.title;
    if (step === 9) return !!d.title && (!!d.address || !!d.city);
    return true;
  })();

  const goNext = () => {
    let next = step + 1;
    if (next === 8 && !showUnitsStep) next = 9;
    if (next > 9) return;
    setStep(next);
  };
  const goBack = () => {
    let prev = step - 1;
    if (prev === 8 && !showUnitsStep) prev = 7;
    if (prev < 0) return;
    setStep(prev);
  };

  const finish = () => {
    onSubmit(buildSubmitPayload(d));
  };

  const update = (patch: Partial<WizardData>) => setD((p) => ({ ...p, ...patch }));

  const currentStepKey = STEP_KEYS[step];

  const stepContent = (idx: number) => {
    switch (idx) {
      case 0: return <Step1Type d={d} update={update} />;
      case 1: return <Step2Structure d={d} update={update} buildings={buildings.data ?? []} />;
      case 2: return mode === "edit"
        ? <EditBasics d={d} update={update} buildings={buildings.data ?? []} owners={owners.data ?? []} employees={employees.data ?? []} />
        : <Step3Basics d={d} update={update} owners={owners.data ?? []} employees={employees.data ?? []} />;
      case 3: return <Step4Address d={d} update={update} />;
      case 4: return <Step5Areas d={d} update={update} />;
      case 5: return <Step6Price d={d} update={update} />;
      case 6: return <Step7Equipment d={d} update={update} />;
      case 7: return <Step8Media d={d} update={update} />;
      case 8: return showUnitsStep ? <Step9Units d={d} update={update} /> : null;
      default: return <Step10Summary d={d} owners={owners.data ?? []} employees={employees.data ?? []} />;
    }
  };

  if (mode === "edit") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[95dvh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0"
          style={{ display: "flex", flexDirection: "column" }}
        >
          <DialogHeader className="shrink-0 border-b p-6 pb-4">
            <DialogTitle className="font-display text-xl">{t("propertyWizard.titleEdit")}</DialogTitle>
            <DialogDescription>{d.title || t("propertyWizard.titleEdit")}</DialogDescription>
          </DialogHeader>

          <Tabs
            value={String(step)}
            onValueChange={(v) => setStep(Number(v))}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <div className="shrink-0 border-b px-4 py-2">
              <TabsList className="flex h-auto w-full flex-wrap gap-1 bg-transparent p-0">
                {visibleSteps.map((s) => (
                  <TabsTrigger
                    key={s.idx}
                    value={String(s.idx)}
                    className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                  >
                    {t(`propertyWizard.steps.${s.key}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {stepContent(step)}
            </div>
          </Tabs>

          <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-2 border-t bg-background p-4">
            <div className="hidden text-xs text-muted-foreground md:block">
              {t("propertyWizard.mandatoryHint")}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                {t("common.cancel", { defaultValue: "Abbrechen" })}
              </Button>
              <Button onClick={finish} disabled={!d.title || submitting}>
                <Check className="mr-1 h-4 w-4" /> {t("propertyWizard.nav.saveEdit")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[95dvh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0"
        style={{ display: "flex", flexDirection: "column" }}
      >
        <DialogHeader className="shrink-0 border-b p-6 pb-4">
          <DialogTitle className="font-display text-xl">{t("propertyWizard.titleNew")}</DialogTitle>
          <DialogDescription>
            {t("propertyWizard.stepProgress", {
              current: visibleSteps.findIndex(s => s.idx === step) + 1,
              total: visibleSteps.length,
              label: t(`propertyWizard.steps.${currentStepKey}`),
            })}
          </DialogDescription>
          <div className="mt-4">
            <div className="flex items-center">
              {visibleSteps.map((s, i) => {
                const isActive = s.idx === step;
                const isDone = s.idx < step;
                const Icon = STEP_ICONS[s.key] ?? Home;
                const label = t(`propertyWizard.steps.${s.key}`);
                return (
                  <div key={s.idx} className="flex min-w-0 flex-1 items-center last:flex-none">
                    {i > 0 && (
                      <div
                        className={cn(
                          "h-0.5 min-w-1.5 flex-1 rounded-full transition-colors",
                          isDone || isActive ? "bg-primary/50" : "bg-border"
                        )}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setStep(s.idx)}
                      title={label}
                      aria-label={label}
                      aria-current={isActive ? "step" : undefined}
                      className={cn(
                        "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-all duration-200",
                        "hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                          : isDone
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-muted/50 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      )}
                    >
                      {isDone && !isActive
                        ? <Check className="size-3.5" />
                        : <Icon className={cn("transition-all", isActive ? "size-4" : "size-3.5")} />}
                      {isActive && (
                        <span className="absolute -bottom-1.5 size-1.5 rounded-full bg-primary" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {step === 0 && <Step1Type d={d} update={update} />}
          {step === 1 && <Step2Structure d={d} update={update} buildings={buildings.data ?? []} />}
          {step === 2 && <Step3Basics d={d} update={update} owners={owners.data ?? []} employees={employees.data ?? []} />}
          {step === 3 && <Step4Address d={d} update={update} />}
          {step === 4 && <Step5Areas d={d} update={update} />}
          {step === 5 && <Step6Price d={d} update={update} />}
          {step === 6 && <Step7Equipment d={d} update={update} />}
          {step === 7 && <Step8Media d={d} update={update} />}
          {step === 8 && showUnitsStep && <Step9Units d={d} update={update} />}
          {step === 9 && <Step10Summary d={d} owners={owners.data ?? []} employees={employees.data ?? []} />}
        </div>

        <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-2 border-t bg-background p-4">
          <Button variant="ghost" onClick={goBack} disabled={step === 0 || submitting}>
            <ArrowLeft className="mr-1 h-4 w-4" /> {t("propertyWizard.nav.back")}
          </Button>
          <div className="hidden text-xs text-muted-foreground md:block">
            {t("propertyWizard.mandatoryHint")}
          </div>

          {step < 9 ? (
            <Button onClick={goNext} disabled={!canProceed || submitting}>
              {t("propertyWizard.nav.next")} <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finish} disabled={!canProceed || submitting}>
              <Check className="mr-1 h-4 w-4" /> {t("propertyWizard.nav.save")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------- Schritte -------------------- */

function EditBasics({
  d,
  update,
  buildings,
  owners,
  employees,
}: {
  d: WizardData;
  update: (p: Partial<WizardData>) => void;
  buildings: any[];
  owners: any[];
  employees: any[];
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("propertyWizard.steps.type")}</Label>
          <Select value={d.property_type} onValueChange={(value) => update({ property_type: value })}>
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROP_TYPES.map(({ v, icon: Icon }) => (
                <SelectItem key={v} value={v}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {t(`propertyWizard.types.${v}.label`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("propertyWizard.steps.structure")}</Label>
          <Select value={d.structure} onValueChange={(value: Structure) => update({ structure: value })}>
            <SelectTrigger className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRUCTURES.map(({ v, icon: Icon }) => (
                <SelectItem key={v} value={v}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {t(`propertyWizard.structures.${v}.label`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {d.structure === "unit_in_building" && (
        <div className="space-y-1.5 border-t pt-5">
          <Label>{t("propertyWizard.step2.parentLabel")}</Label>
          <Select value={d.parent_property_id ?? ""} onValueChange={(value) => update({ parent_property_id: value || null })}>
            <SelectTrigger><SelectValue placeholder={t("propertyWizard.step2.parentPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {buildings.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">{t("propertyWizard.step2.noBuildings")}</div>}
              {buildings.map((building: any) => (
                <SelectItem key={building.id} value={building.id}>
                  {building.title} {building.city ? `· ${building.city}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="border-t pt-5">
        <Step3Basics d={d} update={update} owners={owners} employees={employees} />
      </div>
    </div>
  );
}

function Step1Type({ d, update }: { d: WizardData; update: (p: Partial<WizardData>) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">{t("propertyWizard.step1.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("propertyWizard.step1.hint")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROP_TYPES.map(({ v, icon: Icon }) => {
          const selected = d.property_type === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => update({ property_type: v })}
              className={cn(
                "group relative flex h-full flex-col items-start gap-3 rounded-2xl border-2 bg-card p-5 text-left transition",
                "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md",
                selected ? "border-primary bg-primary/5 shadow-md" : "border-border",
              )}
            >
              <div className={cn(
                "flex h-12 w-12 items-center justify-center rounded-xl transition",
                selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground group-hover:bg-primary/10 group-hover:text-primary",
              )}>
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold leading-tight">{t(`propertyWizard.types.${v}.label`)}</div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{t(`propertyWizard.types.${v}.desc`)}</p>
              </div>
              {selected && (
                <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Step2Structure({ d, update, buildings }: { d: WizardData; update: (p: Partial<WizardData>) => void; buildings: any[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold">{t("propertyWizard.step2.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("propertyWizard.step2.hint")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {STRUCTURES.map(({ v, icon: Icon }) => {
          const selected = d.structure === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => update({ structure: v })}
              className={cn(
                "group relative flex h-full flex-col gap-3 rounded-2xl border-2 bg-card p-5 text-left transition",
                "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md",
                selected ? "border-primary bg-primary/5 shadow-md" : "border-border",
              )}
            >
              <div className={cn(
                "flex h-12 w-12 items-center justify-center rounded-xl transition",
                selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground group-hover:bg-primary/10 group-hover:text-primary",
              )}>
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold leading-tight">{t(`propertyWizard.structures.${v}.label`)}</div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{t(`propertyWizard.structures.${v}.desc`)}</p>
              </div>
              {selected && (
                <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {d.structure === "unit_in_building" && (
        <div className="rounded-xl border bg-muted/30 p-4">
          <Label>{t("propertyWizard.step2.parentLabel")}</Label>
          <Select value={d.parent_property_id ?? ""} onValueChange={(v) => update({ parent_property_id: v || null })}>
            <SelectTrigger className="mt-1"><SelectValue placeholder={t("propertyWizard.step2.parentPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {buildings.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">{t("propertyWizard.step2.noBuildings")}</div>}
              {buildings.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.title} {b.city ? `· ${b.city}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

const FLOOR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "-2", label: "2. Untergeschoss" },
  { value: "-1", label: "1. Untergeschoss" },
  { value: "0", label: "Erdgeschoss" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}. Obergeschoss` })),
];

/** Eine einzelne Stockwerkangabe ergibt nur bei Einheiten in einem Gebäude Sinn. */
export function showsSingleFloor(d: Pick<WizardData, "structure" | "property_type">) {
  if (d.structure === "building" || d.property_type === "mixed_use") return false;
  if (d.property_type === "land") return false;
  return d.structure === "unit_in_building" || d.property_type === "apartment" || d.property_type === "commercial" || d.property_type === "parking";
}

/** Anzahl Stockwerke ist bei ganzen Gebäuden/Häusern relevant. */
export function showsTotalFloors(d: Pick<WizardData, "structure" | "property_type">) {
  if (d.property_type === "land" || d.property_type === "parking") return false;
  return d.structure !== "unit_in_building";
}

function FloorSelect({ value, onChange, label = "Stockwerk", store = "value" }: { value: string; onChange: (v: string) => void; label?: string; store?: "value" | "label" }) {
  const options = FLOOR_OPTIONS.map((option) => ({ key: store === "label" ? option.label : option.value, label: option.label }));
  const current = options.some((option) => option.key === value) ? value : undefined;
  return (
    <div>
      <Label>{label}</Label>
      <Select value={current} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Stockwerk wählen" /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function Step3Basics({ d, update, owners, employees }: { d: WizardData; update: (p: Partial<WizardData>) => void; owners: any[]; employees: any[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <Label>{t("propertyWizard.step3.titleField")}</Label>
        <Input value={d.title} onChange={(e) => update({ title: e.target.value })} placeholder={t("propertyWizard.step3.titlePlaceholder")} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>{t("propertyWizard.step3.marketing")}</Label>
          <Select value={d.marketing_type} onValueChange={(v: Marketing) => update({ marketing_type: v, listing_type: v === "rent" ? "rent" : "sale" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">{t("propertyWizard.step3.marketingSale")}</SelectItem>
              <SelectItem value="rent">{t("propertyWizard.step3.marketingRent")}</SelectItem>
              <SelectItem value="off_market">{t("propertyWizard.step3.marketingOff")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("propertyWizard.step3.status")}</Label>
          <Select value={d.status} onValueChange={(v) => update({ status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map(s => <SelectItem key={s} value={s}>{propertyStatusLabels[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>{t("propertyWizard.step3.owner")}</Label>
          <Select value={d.owner_client_id ?? "none"} onValueChange={(v) => update({ owner_client_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("propertyWizard.step3.ownerNone")}</SelectItem>
              {owners.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("propertyWizard.step3.assignee")}</Label>
          <Select value={d.assigned_to ?? "none"} onValueChange={(v) => update({ assigned_to: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("propertyWizard.step3.assigneeNone")}</SelectItem>
              {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {(showsSingleFloor(d) || showsTotalFloors(d)) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {showsSingleFloor(d) && <FloorSelect value={d.floor} onChange={(v) => update({ floor: v })} />}
          {showsTotalFloors(d) && (
            <div>
              <Label>{t("propertyWizard.step5.totalFloors")}</Label>
              <Input type="number" value={d.total_floors} onChange={(e) => update({ total_floors: e.target.value })} />
            </div>
          )}
        </div>
      )}
      {(d.structure === "building" || d.property_type === "mixed_use") && (
        <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
          Bei Mehrfamilien- und Renditeobjekten werden die einzelnen Stockwerke pro Einheit im Schritt «Einheiten» erfasst.
        </p>
      )}
    </div>
  );
}

function Step4Address({ d, update }: { d: WizardData; update: (p: Partial<WizardData>) => void }) {
  const { t } = useTranslation();
  const lookupParcel = useServerFn(lookupSwissParcel);
  const generateLocation = useServerFn(generateLocationDescription);
  const [parcelLoading, setParcelLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const fullAddress = [d.address, [d.postal_code, d.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  const handleParcelLookup = async () => {
    if (d.latitude == null && fullAddress.trim().length < 3) return toast.error("Bitte zuerst eine Adresse erfassen.");
    setParcelLoading(true);
    try {
      const result = await lookupParcel({ data: { latitude: d.latitude, longitude: d.longitude, address: fullAddress || undefined } });
      update({ parcel_no: result.parcel_no, e_grid: result.e_grid });
      toast.success("Amtliche Parzellendaten übernommen.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Parzelle konnte nicht ermittelt werden.");
    } finally {
      setParcelLoading(false);
    }
  };

  const handleGenerateLocation = async () => {
    if (!d.city && !d.address) return toast.error("Bitte zuerst eine Adresse erfassen.");
    setAiLoading(true);
    try {
      const result = await generateLocation({ data: { address: d.address, postal_code: d.postal_code, city: d.city, country: d.country, property_type: d.property_type, requestId: crypto.randomUUID() } });
      update({ location_description: result.text });
      toast.success("Lagebeschreibung erstellt.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lagebeschreibung konnte nicht erstellt werden.");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        <div><Label>{t("propertyWizard.step4.street")}</Label><AddressAutocomplete value={d.address} onChange={(address) => update({ address, latitude: null, longitude: null })} onSelect={(address) => update({ address: address.street || address.label, postal_code: address.postal_code, city: address.city, country: address.country_code || d.country, latitude: address.latitude, longitude: address.longitude, parcel_no: "", e_grid: "" })} country="ch,li,de,at" provider="google" /></div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label>{t("propertyWizard.step4.postalCode")}</Label><Input value={d.postal_code} onChange={(e) => update({ postal_code: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>{t("propertyWizard.step4.city")}</Label><Input value={d.city} onChange={(e) => update({ city: e.target.value })} /></div>
      </div>
      <div><Label>{t("propertyWizard.step4.country")}</Label><Input value={d.country} onChange={(e) => update({ country: e.target.value })} /></div>
      {d.country.toUpperCase() === "CH" && (
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2 font-medium"><MapPin className="h-4 w-4 text-primary" /> Amtliche Parzellendaten</div>
              <p className="mt-1 text-xs text-muted-foreground">Grundstücknummer und EGRID aus dem Schweizer Kataster.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleParcelLookup} disabled={parcelLoading}>
              {parcelLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />} Parzelle abrufen
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>Parzellennummer</Label><Input value={d.parcel_no} onChange={(e) => update({ parcel_no: e.target.value })} /></div>
            <div><Label>EGRID</Label><Input value={d.e_grid} onChange={(e) => update({ e_grid: e.target.value })} /></div>
          </div>
        </div>
      )}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <Label>{t("propertyWizard.step4.locationDesc")}</Label>
          <Button type="button" variant="outline" size="sm" onClick={handleGenerateLocation} disabled={aiLoading}>
            {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Mit KI generieren
          </Button>
        </div>
        <Textarea rows={3} value={d.location_description} onChange={(e) => update({ location_description: e.target.value })} placeholder={t("propertyWizard.step4.locationPlaceholder")} />
      </div>
    </div>
  );
}

function Step5Areas({ d, update }: { d: WizardData; update: (p: Partial<WizardData>) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div><Label>{t("propertyWizard.step5.living")}</Label><Input type="number" value={d.living_area} onChange={(e) => update({ living_area: e.target.value })} /></div>
        <div><Label>{t("propertyWizard.step5.usable")}</Label><Input type="number" value={d.usable_area} onChange={(e) => update({ usable_area: e.target.value })} /></div>
        <div><Label>{t("propertyWizard.step5.plot")}</Label><Input type="number" value={d.plot_area} onChange={(e) => update({ plot_area: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div><Label>{t("propertyWizard.step5.rooms")}</Label><Input type="number" step="0.5" value={d.rooms} onChange={(e) => update({ rooms: e.target.value })} /></div>
        <div><Label>{t("propertyWizard.step5.bathrooms")}</Label><Input type="number" step="0.5" value={d.bathrooms} onChange={(e) => update({ bathrooms: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>{t("propertyWizard.step5.yearBuilt")}</Label><Input type="number" value={d.year_built} onChange={(e) => update({ year_built: e.target.value })} /></div>
        <div><Label>{t("propertyWizard.step5.renovated")}</Label><Input type="number" value={d.renovated_at} onChange={(e) => update({ renovated_at: e.target.value })} /></div>
      </div>
    </div>
  );
}

function Step6Price({ d, update }: { d: WizardData; update: (p: Partial<WizardData>) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>{t("propertyWizard.step6.price")}</Label><Input type="number" value={d.price} onChange={(e) => update({ price: e.target.value })} /></div>
        <div><Label>{t("propertyWizard.step6.rent")}</Label><Input type="number" value={d.rent} onChange={(e) => update({ rent: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>{t("propertyWizard.step6.ancillary")}</Label><Input type="number" value={d.ancillary_costs} onChange={(e) => update({ ancillary_costs: e.target.value })} /></div>
        <div><Label>{t("propertyWizard.step6.reservation")}</Label><Input type="number" value={d.reservation_amount_default} onChange={(e) => update({ reservation_amount_default: e.target.value })} /></div>
      </div>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <Label className="text-amber-700 dark:text-amber-400">{t("propertyWizard.step6.minPrice")}</Label>
        <Input type="number" value={d.internal_minimum_price} onChange={(e) => update({ internal_minimum_price: e.target.value })} />
        <p className="mt-1 text-xs text-muted-foreground">{t("propertyWizard.step6.minPriceHint")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("propertyWizard.step6.commissionModel")}</Label>
          <Select value={d.commission_model || "none"} onValueChange={(v) => update({ commission_model: v === "none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              <SelectItem value="percent">{t("propertyWizard.step6.commissionPercent")}</SelectItem>
              <SelectItem value="fixed">{t("propertyWizard.step6.commissionFixed")}</SelectItem>
              <SelectItem value="months_rent">{t("propertyWizard.step6.commissionMonths")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>{t("propertyWizard.step6.commissionValue")}</Label><Input type="number" value={d.commission_value} onChange={(e) => update({ commission_value: e.target.value })} placeholder={t("propertyWizard.step6.commissionValuePlaceholder")} /></div>
      </div>
    </div>
  );
}

const BASE_FEATURE_LABELS = ["Balkon", "Terrasse", "Garten", "Lift", "Garage", "Parkplatz", "Keller"];

function Step7Equipment({ d, update }: { d: WizardData; update: (p: Partial<WizardData>) => void }) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const checks: { k: keyof WizardData; tk: string; key: string }[] = [
    { k: "has_balcony", tk: "balcony", key: "balkon" },
    { k: "has_terrace", tk: "terrace", key: "terrasse" },
    { k: "has_garden", tk: "garden", key: "garten" },
    { k: "has_lift", tk: "lift", key: "lift" },
    { k: "has_garage", tk: "garage", key: "garage" },
    { k: "has_parking", tk: "parking", key: "parkplatz" },
    { k: "cellar_available", tk: "cellar", key: "keller" },
  ];
  const extras = (d.features_extra || "").split(",").map((s) => s.trim()).filter(Boolean);
  const setExtras = (list: string[]) => update({ features_extra: list.join(", ") });
  const { data: featureOptions = [] } = useFeatureOptions();
  const optionByLabel = new Map(featureOptions.map((o) => [o.label_de.toLowerCase(), o]));
  // Katalog-Merkmale erscheinen als Icon-Kacheln neben den Basis-Merkmalen,
  // eigene Einträge bleiben unten bei "Weitere Ausstattungen".
  const catalogExtras = extras.filter((l) => optionByLabel.has(l.toLowerCase()));
  const customExtras = extras.filter((l) => !optionByLabel.has(l.toLowerCase()));
  const removeExtra = (label: string) => setExtras(extras.filter((l) => l.toLowerCase() !== label.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {checks.map(c => {
          const Icon = featureIcon(c.key);
          const active = d[c.k] as boolean;
          return (
            <label
              key={c.k}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-colors hover:bg-accent",
                active && "border-primary bg-primary/5",
              )}
            >
              <Checkbox
                checked={active}
                onCheckedChange={(v) => update({ [c.k]: !!v } as any)}
              />
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
              <span className="text-sm font-medium">{t(`propertyWizard.step7.features.${c.tk}`)}</span>
            </label>
          );
        })}
        {catalogExtras.map((label) => {
          const opt = optionByLabel.get(label.toLowerCase());
          const Icon = featureIcon(opt?.key ?? null, label);
          return (
            <div
              key={label}
              className="group relative flex items-center gap-2 rounded-lg border border-primary bg-primary/5 p-3"
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium">{label}</span>
              <button
                type="button"
                className="ml-auto rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
                onClick={() => removeExtra(label)}
                aria-label={`${label} entfernen`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="mb-0">Weitere Ausstattungen</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />Weitere Ausstattungen
          </Button>
        </div>
        {customExtras.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Keine eigenen Ausstattungen erfasst.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {customExtras.map((label) => {
              const Icon = featureIcon(null, label);
              return (
                <Badge key={label} variant="secondary" className="gap-1.5 py-1 pl-2 pr-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-background/60"
                    onClick={() => removeExtra(label)}
                    aria-label={`${label} entfernen`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      <FeaturePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={extras}
        onSave={setExtras}
        hiddenLabels={BASE_FEATURE_LABELS}
      />

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>{t("propertyWizard.step7.heating")}</Label>
          <Select value={d.heating_type || "none"} onValueChange={(v) => update({ heating_type: v === "none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              <SelectItem value="gas">{t("propertyWizard.step7.heatings.gas")}</SelectItem>
              <SelectItem value="oil">{t("propertyWizard.step7.heatings.oil")}</SelectItem>
              <SelectItem value="heat_pump">{t("propertyWizard.step7.heatings.heat_pump")}</SelectItem>
              <SelectItem value="district">{t("propertyWizard.step7.heatings.district")}</SelectItem>
              <SelectItem value="wood">{t("propertyWizard.step7.heatings.wood")}</SelectItem>
              <SelectItem value="electric">{t("propertyWizard.step7.heatings.electric")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("propertyWizard.step7.energySource")}</Label>
          <Input value={d.energy_source} onChange={(e) => update({ energy_source: e.target.value })} placeholder={t("propertyWizard.step7.energySourcePlaceholder")} />
        </div>
        <div><Label>{t("propertyWizard.step7.energyClass")}</Label><Input value={d.energy_class} onChange={(e) => update({ energy_class: e.target.value })} placeholder={t("propertyWizard.step7.energyClassPlaceholder")} /></div>
      </div>
    </div>
  );
}

function detectKindFromFile(file: File): string {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const n = file.name.toLowerCase();
  if (n.includes("grundriss") || n.includes("floor") || n.includes("plan")) return "floor_plan";
  return "other";
}

function Step8Media({ d, update }: { d: WizardData; update: (p: Partial<WizardData>) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"upload" | "library">("upload");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const library = useQuery({
    queryKey: ["wizard_media_library"],
    queryFn: async () => {
      const { data } = await supabase
        .from("property_media")
        .select("id, file_url, file_name, file_type, title, properties(title)")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
    enabled: tab === "library",
  });

  type UploadJob = { id: string; name: string; size: number; kind: "image" | "document"; status: "waiting" | "uploading" | "done" | "error"; error?: string };
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [docDragOver, setDocDragOver] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef(d.media);
  mediaRef.current = d.media;

  const handleFiles = async (files: File[], kind: "image" | "document" = "image") => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      let processed = files;
      if (kind === "image") {
        const imgs = files.filter((f) => f.type.startsWith("image/") || /\.(tiff?|heic|heif)$/i.test(f.name));
        if (imgs.length < files.length) toast.error("Nur Bilder hier ablegen – Dokumente bitte im Feld «Dokumente».");
        processed = await convertUnsupportedImages(imgs);
      }
      const batch: UploadJob[] = processed.map((f) => ({ id: crypto.randomUUID(), name: f.name, size: f.size, kind, status: "waiting" }));
      setJobs((prev) => [...batch, ...prev]);
      const uploaded: WizardMedia[] = [];
      for (let i = 0; i < processed.length; i++) {
        const file = processed[i];
        const job = batch[i];
        setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "uploading" } : j)));
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `_wizard/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("media").upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (error) {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "error", error: error.message } : j)));
          continue;
        }
        setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "done" } : j)));
        uploaded.push({
          file_url: path,
          file_name: file.name,
          file_type: kind === "document" ? (detectKindFromFile(file) === "floor_plan" ? "floor_plan" : "document") : detectKindFromFile(file),
          title: null,
          is_cover: false,
          source: "upload",
        });
      }
      if (uploaded.length) {
        update({ media: ensureWizardCover([...mediaRef.current, ...uploaded]) });
        toast.success(t("propertyWizard.step8.uploaded", { count: uploaded.length }));
      }
    } catch (e: any) {
      toast.error(e.message ?? t("propertyWizard.step8.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(Array.from(e.dataTransfer.files), "image");
  };
  const onDocDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDocDragOver(false);
    void handleFiles(Array.from(e.dataTransfer.files), "document");
  };

  const togglePick = (item: any) => {
    const exists = d.media.find((m) => m.library_media_id === item.id);
    if (exists) {
      update({ media: ensureWizardCover(d.media.filter((m) => m.library_media_id !== item.id)) });
    } else {
      update({
        media: ensureWizardCover([
          ...d.media,
          { file_url: item.file_url, file_name: item.file_name, file_type: item.file_type, title: item.title, is_cover: false, source: "library", library_media_id: item.id },
        ]),
      });
    }
  };

  const setCover = (idx: number) => {
    update({ media: d.media.map((m, i) => ({ ...m, is_cover: i === idx })) });
  };
  const removeAt = (idx: number) => {
    update({ media: ensureWizardCover(d.media.filter((_, i) => i !== idx)) });
  };

  const imageItems = d.media.map((m, idx) => ({ m, idx })).filter(({ m }) => isWizardImage(m));
  const docItems = d.media.map((m, idx) => ({ m, idx })).filter(({ m }) => !isWizardImage(m));
  const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const activeJobs = jobs.filter((j) => j.status !== "done" || true).slice(0, 20);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl border bg-muted/30 p-1">
        <button type="button" onClick={() => setTab("upload")}
          className={cn("flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition", tab === "upload" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <Upload className="h-4 w-4" /> {t("propertyWizard.step8.tabUpload")}
        </button>
        <button type="button" onClick={() => setTab("library")}
          className={cn("flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition", tab === "library" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <Library className="h-4 w-4" /> {t("propertyWizard.step8.tabLibrary")}
        </button>
      </div>

      {tab === "upload" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition", dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20")}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><ImageIcon className="h-5 w-5" /></div>
            <p className="font-medium">Bilder hierher ziehen</p>
            <p className="text-xs text-muted-foreground">JPG, PNG, HEIC, TIFF – erscheinen in der Galerie</p>
            <input ref={fileRef} type="file" multiple accept="image/*,.tif,.tiff,.heic,.heif" className="hidden"
              onChange={(e) => { void handleFiles(Array.from(e.target.files ?? []), "image"); if (fileRef.current) fileRef.current.value = ""; }} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="mt-1">Bilder auswählen</Button>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDocDragOver(true); }}
            onDragLeave={() => setDocDragOver(false)}
            onDrop={onDocDrop}
            className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition", docDragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20")}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div>
            <p className="font-medium">Dokumente hierher ziehen</p>
            <p className="text-xs text-muted-foreground">PDF, Word, Excel, Grundrisse – gehören zum Objekt</p>
            <input ref={docRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*" className="hidden"
              onChange={(e) => { void handleFiles(Array.from(e.target.files ?? []), "document"); if (docRef.current) docRef.current.value = ""; }} />
            <Button type="button" variant="outline" size="sm" onClick={() => docRef.current?.click()} disabled={uploading} className="mt-1">Dokumente auswählen</Button>
          </div>
        </div>
      )}

      {tab === "upload" && activeJobs.length > 0 && (
        <div className="space-y-1.5 rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between">
            <Label>Upload-Fortschritt</Label>
            <span className="text-xs text-muted-foreground">{jobs.filter((j) => j.status === "done").length} / {jobs.length} fertig</span>
          </div>
          {activeJobs.map((j) => (
            <div key={j.id} className="flex items-center gap-2 text-sm">
              {j.status === "uploading" || j.status === "waiting" ? <Loader2 className={cn("h-4 w-4 shrink-0", j.status === "uploading" ? "animate-spin text-primary" : "text-muted-foreground")} />
                : j.status === "done" ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <X className="h-4 w-4 shrink-0 text-destructive" />}
              {j.kind === "document" ? <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{j.name}</span>
              <span className="text-xs text-muted-foreground">{j.status === "waiting" ? "wartet" : j.status === "uploading" ? "lädt hoch…" : j.status === "done" ? fmtSize(j.size) : (j.error ?? "Fehler")}</span>
            </div>
          ))}
          {(jobs.some((j) => j.status === "waiting" || j.status === "uploading")) && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(jobs.filter((j) => j.status === "done" || j.status === "error").length / jobs.length) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {tab === "library" && (
        <div className="rounded-2xl border bg-muted/20 p-3">
          {library.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">{t("propertyWizard.step8.loading")}</p>
          ) : (library.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("propertyWizard.step8.libraryEmpty")}</p>
          ) : (
            <div className="grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
              {(library.data ?? []).map((item: any) => {
                const picked = !!d.media.find((m) => m.library_media_id === item.id);
                return (
                  <button key={item.id} type="button" onClick={() => togglePick(item)}
                    className={cn("group relative aspect-square overflow-hidden rounded-lg border-2 bg-card transition", picked ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-primary/40")}>
                    <PropertyPhoto sources={[item.file_url]} alt={item.title ?? "Immobilie"} />
                    {picked && (
                      <div className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3.5 w-3.5" /></div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {imageItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Bilder ({imageItems.length})</Label>
            <p className="text-xs text-muted-foreground">{t("propertyWizard.step8.coverHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {imageItems.map(({ m, idx }) => (
              <div key={idx} className="group relative aspect-square overflow-hidden rounded-lg border bg-card">
                <PropertyPhoto sources={[m.file_url]} alt={m.title ?? "Immobilie"} />
                {m.is_cover && (
                  <Badge className="absolute left-1 top-1 bg-primary text-primary-foreground"><Star className="mr-1 h-3 w-3" /> {t("propertyWizard.step8.cover")}</Badge>
                )}
                {m.source === "library" && (
                  <Badge variant="secondary" className="absolute bottom-1 left-1 text-[10px]">{t("propertyWizard.step8.library")}</Badge>
                )}
                <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100">
                  {!m.is_cover && (
                    <Button type="button" size="icon" variant="secondary" className="h-7 w-7 bg-background/90" onClick={() => setCover(idx)} title={t("propertyWizard.step8.setCover")}><Star className="h-3.5 w-3.5" /></Button>
                  )}
                  <Button type="button" size="icon" variant="secondary" className="h-7 w-7 bg-background/90" onClick={() => removeAt(idx)} title={t("propertyWizard.step8.remove")}><X className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {docItems.length > 0 && (
        <div className="space-y-2">
          <Label>Dokumente ({docItems.length})</Label>
          <div className="divide-y rounded-xl border bg-card">
            {docItems.map(({ m, idx }) => (
              <div key={idx} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{m.file_name ?? m.title ?? m.file_url.split("/").pop()}</span>
                <Badge variant="secondary" className="text-[10px]">{m.file_type === "floor_plan" ? "Grundriss" : m.file_type === "video" ? "Video" : "Dokument"}</Badge>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeAt(idx)} title={t("propertyWizard.step8.remove")}><X className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 pt-2">
        <div>
          <Label>{t("propertyWizard.step8.description")}</Label>
          <Textarea rows={3} value={d.description} onChange={(e) => update({ description: e.target.value })} placeholder={t("propertyWizard.step8.descriptionPlaceholder")} />
        </div>
        <div>
          <Label>{t("propertyWizard.step8.internalNotes")}</Label>
          <Textarea rows={2} value={d.internal_notes} onChange={(e) => update({ internal_notes: e.target.value })} placeholder={t("propertyWizard.step8.internalNotesPlaceholder")} />
        </div>
      </div>
    </div>
  );
}

function Step9Units({ d, update }: { d: WizardData; update: (p: Partial<WizardData>) => void }) {
  const { t } = useTranslation();
  const addUnit = () => {
    update({
      units: [
        ...d.units,
        {
          unit_number: "",
          unit_type: "apartment",
          unit_floor: "",
          rooms: "",
          living_area: "",
          price: "",
          rent: "",
          unit_status: "draft",
          separately_marketable: true,
        },
      ],
    });
  };
  const removeUnit = (i: number) => update({ units: d.units.filter((_, idx) => idx !== i) });
  const patchUnit = (i: number, patch: Partial<Unit>) =>
    update({ units: d.units.map((u, idx) => idx === i ? { ...u, ...patch } : u) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("propertyWizard.step9.intro")}
        </p>
        <Button size="sm" onClick={addUnit}><Plus className="mr-1 h-4 w-4" />{t("propertyWizard.step9.addUnit")}</Button>
      </div>
      {d.units.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("propertyWizard.step9.empty")}
        </div>
      )}
      <div className="space-y-3">
        {d.units.map((u, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{t("propertyWizard.step9.unit")} {i + 1}</Badge>
                <Button size="sm" variant="ghost" onClick={() => removeUnit(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>{t("propertyWizard.step9.designation")}</Label><Input value={u.unit_number} onChange={(e) => patchUnit(i, { unit_number: e.target.value })} placeholder={t("propertyWizard.step9.designationPlaceholder")} /></div>
                <div>
                  <Label>{t("propertyWizard.step9.type")}</Label>
                  <Select value={u.unit_type} onValueChange={(v) => patchUnit(i, { unit_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apartment">{t("propertyWizard.step9.unitTypes.apartment")}</SelectItem>
                      <SelectItem value="commercial">{t("propertyWizard.step9.unitTypes.commercial")}</SelectItem>
                      <SelectItem value="parking">{t("propertyWizard.step9.unitTypes.parking")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <FloorSelect value={u.unit_floor} onChange={(v) => patchUnit(i, { unit_floor: v })} label={t("propertyWizard.step9.floor")} store="label" />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div><Label>{t("propertyWizard.step9.rooms")}</Label><Input type="number" step="0.5" value={u.rooms} onChange={(e) => patchUnit(i, { rooms: e.target.value })} /></div>
                <div><Label>{t("propertyWizard.step9.living")}</Label><Input type="number" value={u.living_area} onChange={(e) => patchUnit(i, { living_area: e.target.value })} /></div>
                <div><Label>{t("propertyWizard.step9.price")}</Label><Input type="number" value={u.price} onChange={(e) => patchUnit(i, { price: e.target.value })} /></div>
                <div><Label>{t("propertyWizard.step9.rent")}</Label><Input type="number" value={u.rent} onChange={(e) => patchUnit(i, { rent: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("propertyWizard.step9.status")}</Label>
                  <Select value={u.unit_status} onValueChange={(v) => patchUnit(i, { unit_status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(s => <SelectItem key={s} value={s}>{propertyStatusLabels[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <label className="mt-6 flex items-center gap-2 text-sm">
                  <Checkbox checked={u.separately_marketable} onCheckedChange={(v) => patchUnit(i, { separately_marketable: !!v })} />
                  {t("propertyWizard.step9.separate")}
                </label>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Step10Summary({ d, owners, employees }: { d: WizardData; owners: any[]; employees: any[] }) {
  const { t } = useTranslation();
  const owner = owners.find(o => o.id === d.owner_client_id);
  const emp = employees.find(e => e.id === d.assigned_to);
  const structureLabel = d.structure === "single"
    ? t("propertyWizard.step10.structureSingle")
    : d.structure === "building"
      ? t("propertyWizard.step10.structureBuilding")
      : t("propertyWizard.step10.structureUnit");
  const marketingLabel = d.marketing_type === "sale"
    ? t("propertyWizard.step3.marketingSale")
    : d.marketing_type === "rent"
      ? t("propertyWizard.step3.marketingRent")
      : t("propertyWizard.step3.marketingOff");
  const rows: [string, string][] = [
    [t("propertyWizard.step10.rows.type"), t(`propertyWizard.types.${d.property_type}.label`, { defaultValue: d.property_type })],
    [t("propertyWizard.step10.rows.structure"), structureLabel],
    [t("propertyWizard.step10.rows.title"), d.title || "—"],
    [t("propertyWizard.step10.rows.marketing"), marketingLabel],
    [t("propertyWizard.step10.rows.status"), propertyStatusLabels[d.status as keyof typeof propertyStatusLabels] ?? d.status],
    [t("propertyWizard.step10.rows.address"), [d.address, d.postal_code, d.city].filter(Boolean).join(", ") || "—"],
    [t("propertyWizard.step10.rows.living"), d.living_area ? `${d.living_area} m²` : "—"],
    [t("propertyWizard.step10.rows.rooms"), d.rooms || "—"],
    [t("propertyWizard.step10.rows.price"), d.price ? `CHF ${d.price}` : "—"],
    [t("propertyWizard.step10.rows.rent"), d.rent ? `CHF ${d.rent}` : "—"],
    [t("propertyWizard.step10.rows.owner"), owner?.full_name ?? "—"],
    [t("propertyWizard.step10.rows.assignee"), emp?.full_name || emp?.email || "—"],
    [t("propertyWizard.step10.rows.units"), d.units.length ? String(d.units.length) : "—"],
    [t("propertyWizard.step10.rows.media"), d.media.length
      ? t("propertyWizard.step10.mediaSummary", {
          count: d.media.length,
          cover: d.media.find(m => m.is_cover) ? t("propertyWizard.step10.coverSuffix") : "",
        })
      : "—"],
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("propertyWizard.step10.intro")}</p>
      <Card><CardContent className="p-0">
        <dl className="divide-y">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-3 gap-4 px-5 py-2.5 text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="col-span-2 font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent></Card>
      {d.units.length > 0 && (
        <Card><CardContent className="p-4">
          <h4 className="mb-2 text-sm font-semibold">{t("propertyWizard.step10.unitsHeader", { count: d.units.length })}</h4>
          <ul className="space-y-1 text-sm">
            {d.units.map((u, i) => (
              <li key={i} className="flex justify-between border-b py-1 last:border-0">
                <span>{u.unit_number || `${t("propertyWizard.step9.unit")} ${i + 1}`} · {t(`propertyWizard.step9.unitTypes.${u.unit_type}`, { defaultValue: u.unit_type })}</span>
                <span className="text-muted-foreground">{u.rooms ? `${u.rooms} ${t("propertyWizard.step5.rooms")} · ` : ""}{u.living_area ? `${u.living_area} m²` : ""}</span>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
