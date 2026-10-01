// Rollenbasierter Kunden-Wizard.
// Flow: Entity (Privat/Firma) -> Rolle -> dynamische Schritte je nach Rolle -> Review.
// Schreibt in: clients (Stammdaten), client_roles (Rollenkontext),
// client_search_profiles (Suchprofile), property_ownerships (Eigentum),
// client_relationships (Kontaktperson <-> Firma), activity_logs.
// Schweizer Rechtschreibung, kein ß.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Check, Loader2, User, Building2, Mail,
  Target, Wallet, Home, Users, ClipboardCheck, Tag, Briefcase, Upload, FileText, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { propertyTypeLabels } from "@/lib/format";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useTranslation } from "react-i18next";

// ----- Typen -----
type EntityType = "person" | "company";

type RoleChoice =
  | "buyer"               // Käufer / Suchkunde
  | "seller_owner"        // Verkäufer / Eigentümer
  | "tenant"              // Mieter
  | "landlord"            // Vermieter
  | "financing_applicant" // Finanzierungskunde
  | "investor"            // Investor
  | "general_contact";    // Allgemeiner Kontakt

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (clientId: string) => void;
}

// ----- Konstanten -----
const ROLE_OPTIONS: {
  value: RoleChoice; icon: typeof Tag;
}[] = [
  { value: "buyer",               icon: Target },
  { value: "seller_owner",        icon: Home },
  { value: "tenant",              icon: User },
  { value: "landlord",            icon: Building2 },
  { value: "financing_applicant", icon: Wallet },
  { value: "investor",            icon: Briefcase },
  { value: "general_contact",     icon: Mail },
];

const ROLE_TO_DB_ROLE: Record<RoleChoice, string> = {
  buyer: "buyer",
  seller_owner: "seller",
  tenant: "tenant",
  landlord: "landlord",
  financing_applicant: "financing_applicant",
  investor: "investor",
  general_contact: "general_contact",
};

const ROLE_TO_CLIENT_TYPE: Record<RoleChoice, string> = {
  buyer: "buyer",
  seller_owner: "seller",
  tenant: "tenant",
  landlord: "landlord",
  financing_applicant: "other",
  investor: "investor",
  general_contact: "other",
};

const PROP_TYPES = ["apartment", "house", "commercial", "land", "mixed_use", "other"] as const;
const FINANCING_GOALS = ["purchase", "renovation", "increase", "refinance", "new_build", "mortgage_increase"] as const;

// ----- Form State -----
type FormState = {
  entity_type: EntityType;
  creation_method: "manual" | "upload";
  role_choice: RoleChoice | "";


  // Person
  salutation: string;
  first_name: string;
  last_name: string;

  // Firma
  company_name: string;
  contact_mode: "manual" | "existing";
  linked_contact_client_id: string;
  contact_first_name: string;
  contact_last_name: string;

  // Kontakt
  email: string;
  phone: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;

  // Suchprofil (Käufer/Mieter/Investor)
  preferred_listing: "sale" | "rent" | "";
  preferred_cities: string;
  preferred_types: string[];
  budget_min: string;
  budget_max: string;
  rooms_min: string;
  area_min: string;
  yield_target: string;
  usage_types: string[];

  // Finanzierung
  equity: string;
  financing_status: string;
  financing_goal: string;
  // Objekt-/Finanzierungswerte
  fin_purchase_price: string;
  fin_renovation_costs: string;
  fin_existing_mortgage: string;
  fin_requested_mortgage: string;
  fin_requested_increase: string;
  fin_target_financing_amount: string;
  fin_project_costs: string;
  // Eigenmittel-Aufteilung
  own_funds_total: string;
  own_funds_cash: string;
  own_funds_pillar_3a: string;
  own_funds_pension_fund: string;
  own_funds_vested_benefits: string;
  own_funds_securities: string;
  own_funds_gift: string;
  own_funds_private_loan: string;
  own_funds_inheritance: string;
  own_funds_other: string;
  // Einkommen grob
  gross_income_yearly: string;
  partner_income_yearly: string;

  // Eigentum (Verkäufer/Vermieter/Eigentümer)
  property_mode: "existing" | "new" | "none";
  selected_property_id: string;
  new_property_title: string;
  new_property_address: string;
  new_property_postal_code: string;
  new_property_city: string;
  new_property_type: string;
  new_property_price: string;
  ownership_share: string;
  ownership_start_date: string;
  ownership_notes: string;

  // Allgemein
  tags: string;
  notes: string;
};

const empty: FormState = {
  entity_type: "person", creation_method: "manual", role_choice: "",
  salutation: "", first_name: "", last_name: "",
  company_name: "", contact_mode: "manual", linked_contact_client_id: "",
  contact_first_name: "", contact_last_name: "",
  email: "", phone: "", street: "", postal_code: "", city: "", country: "CH",
  preferred_listing: "", preferred_cities: "", preferred_types: [],
  budget_min: "", budget_max: "", rooms_min: "", area_min: "",
  yield_target: "", usage_types: [],
  equity: "", financing_status: "", financing_goal: "purchase",
  fin_purchase_price: "", fin_renovation_costs: "", fin_existing_mortgage: "",
  fin_requested_mortgage: "", fin_requested_increase: "",
  fin_target_financing_amount: "", fin_project_costs: "",
  own_funds_total: "", own_funds_cash: "", own_funds_pillar_3a: "",
  own_funds_pension_fund: "", own_funds_vested_benefits: "",
  own_funds_securities: "", own_funds_gift: "", own_funds_private_loan: "",
  own_funds_inheritance: "", own_funds_other: "",
  gross_income_yearly: "", partner_income_yearly: "",
  property_mode: "none", selected_property_id: "",
  new_property_title: "", new_property_address: "", new_property_postal_code: "",
  new_property_city: "", new_property_type: "apartment", new_property_price: "",
  ownership_share: "", ownership_start_date: new Date().toISOString().slice(0, 10),
  ownership_notes: "",
  tags: "", notes: "",
};

const num = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ----- Dynamische Schritte je nach Rolle -----
type StepKey = "entity" | "method" | "role" | "stamm" | "company_contact" | "search"
  | "investment" | "financing" | "property" | "ownership" | "tags" | "review";

function buildSteps(entity: EntityType, role: RoleChoice | "", method: "manual" | "upload"): StepKey[] {
  const s: StepKey[] = ["entity"];
  if (entity === "person") {
    s.push("method");
    if (method === "upload") return s; // Upload-Schritt ist terminal
  }
  s.push("role");
  if (!role) return s;
  s.push("stamm");
  if (entity === "company") s.push("company_contact");
  switch (role) {
    case "buyer":
    case "tenant":
      s.push("search");
      if (role === "buyer") s.push("financing");
      break;
    case "investor":
      s.push("investment");
      break;
    case "seller_owner":
    case "landlord":
      s.push("property", "ownership");
      break;
    case "financing_applicant":
      s.push("financing", "property");
      break;
    case "general_contact":
      s.push("tags");
      break;
  }
  s.push("review");
  return s;
}

// Step labels are resolved via t(`clientWizard.steps.${key}`)

// ===========================================================
export function ClientWizard({ open, onOpenChange, onCreated }: Props) {
  const { t, i18n } = useTranslation();
  const numLocale = i18n.language?.startsWith("fr") ? "fr-CH" : "de-CH";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [form, setForm] = useState<FormState>(empty);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const steps = useMemo(() => buildSteps(form.entity_type, form.role_choice as RoleChoice | "", form.creation_method), [form.entity_type, form.role_choice, form.creation_method]);
  const currentStep = steps[Math.min(stepIdx, steps.length - 1)];

  // ---- Daten für Selects ----
  const personClientsQuery = useQuery({
    queryKey: ["clients-persons-for-link"],
    enabled: open && form.entity_type === "company",
    queryFn: async () => {
      const { data } = await supabase.from("clients")
        .select("id, full_name, email")
        .eq("entity_type", "person").eq("is_archived", false).order("full_name");
      return data ?? [];
    },
  });

  const propertiesQuery = useQuery({
    queryKey: ["properties-for-wizard"],
    enabled: open && (form.role_choice === "seller_owner" || form.role_choice === "landlord" || form.role_choice === "financing_applicant"),
    queryFn: async () => {
      const { data } = await supabase.from("properties")
        .select("id, title, city, address").order("title");
      return data ?? [];
    },
  });

  // ---- Validation ----
  const personName = `${form.first_name} ${form.last_name}`.trim();
  const fullName = form.entity_type === "company" ? form.company_name.trim() : personName;
  const canSave = !!form.role_choice && fullName.length > 0;

  const reset = () => { setForm(empty); setStepIdx(0); };

  // ---- Upload-Flow: Selbstauskunft hochladen, Kunde(n) automatisch anlegen ----
  const handleSelfDisclosureUpload = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error(t("clientWizard.toasts.pdfRequired"));
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(binary);

      const { data, error } = await supabase.functions.invoke("parse-self-disclosure", {
        body: { pdf_base64: base64, mime_type: file.type },
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));

      const fields = (data?.fields ?? {}) as Record<string, any>;
      const coFields = (data?.co_applicant_fields ?? null) as Record<string, any> | null;
      const hasCo = !!data?.has_co_applicant && coFields && Object.keys(coFields).length > 0;

      const first = (fields.first_name as string | undefined)?.trim() ?? "";
      const last = (fields.last_name as string | undefined)?.trim() ?? "";
      const fullName = [first, last].filter(Boolean).join(" ");
      if (!fullName) throw new Error(t("clientWizard.toasts.noNameDetected"));
      if (data?.review_required) {
        toast.warning(
          "Unbekanntes Formular: Nur Personen- und Kontaktangaben übernommen. Finanzangaben bitte manuell erfassen.",
        );
      }

      const { data: userData } = await supabase.auth.getUser();
      const owner_id = userData.user?.id ?? null;

      // 1) Hauptantragsteller anlegen
      const { data: newClient, error: ce } = await supabase
        .from("clients")
        .insert({
          full_name: fullName,
          contact_first_name: first || null,
          contact_last_name: last || null,
          email: (fields.email as string) ?? null,
          phone: (fields.phone as string) ?? (fields.mobile as string) ?? null,
          address: [fields.street, fields.street_number].filter(Boolean).join(" ") || null,
          postal_code: (fields.postal_code as string) ?? null,
          city: (fields.city as string) ?? null,
          country: (fields.country as string) ?? "CH",
          client_type: "other" as any,
          entity_type: "person",
          owner_id,
          assigned_to: owner_id,
        })
        .select("id")
        .single();
      if (ce) throw ce;
      const clientId = newClient.id as string;

      // Rolle: Finanzierungskunde (Selbstauskunft ist Finanzierungsdokument)
      await supabase.from("client_roles").insert({
        client_id: clientId,
        role_type: "financing_applicant" as any,
        status: "active",
        start_date: new Date().toISOString().slice(0, 10),
      });

      // Selbstauskunft speichern
      const sdPayload: Record<string, unknown> = { client_id: clientId, status: "draft" };
      for (const [k, v] of Object.entries(fields)) {
        if (v === null || v === undefined || v === "") continue;
        sdPayload[k] = v;
      }
      await supabase.from("client_self_disclosures").upsert(sdPayload as never, { onConflict: "client_id" });

      // 2) Mitantragsteller automatisch anlegen + verknüpfen
      if (hasCo && coFields) {
        const coFirst = (coFields.first_name as string | undefined)?.trim() ?? "";
        const coLast = (coFields.last_name as string | undefined)?.trim() ?? "";
        const coName = [coFirst, coLast].filter(Boolean).join(" ") || t("clientWizard.toasts.coApplicantFallback");

        const { data: coClient, error: coErr } = await supabase
          .from("clients")
          .insert({
            full_name: coName,
            contact_first_name: coFirst || null,
            contact_last_name: coLast || null,
            email: (coFields.email as string) ?? null,
            phone: (coFields.phone as string) ?? (coFields.mobile as string) ?? null,
            address: [coFields.street, coFields.street_number].filter(Boolean).join(" ") || null,
            postal_code: (coFields.postal_code as string) ?? null,
            city: (coFields.city as string) ?? null,
            country: (coFields.country as string) ?? "CH",
            client_type: "other" as any,
            entity_type: "person",
            owner_id,
            assigned_to: owner_id,
          })
          .select("id")
          .single();
        if (!coErr && coClient) {
          const marital = (fields.marital_status as string | undefined)?.toLowerCase() ?? "";
          const relType = marital.includes("verheirat") || marital.includes("partner") ? "spouse" : "co_applicant";
          await supabase.from("client_relationships").insert([
            { client_id: clientId, related_client_id: coClient.id, relationship_type: relType as any },
            { client_id: coClient.id, related_client_id: clientId, relationship_type: relType as any },
          ]);
          await supabase.from("client_roles").insert({
            client_id: coClient.id,
            role_type: "financing_applicant" as any,
            status: "active",
            start_date: new Date().toISOString().slice(0, 10),
          });
          const coPayload: Record<string, unknown> = { client_id: coClient.id, status: "draft" };
          for (const [k, v] of Object.entries(coFields)) {
            if (v === null || v === undefined || v === "") continue;
            coPayload[k] = v;
          }
          await supabase.from("client_self_disclosures").upsert(coPayload as never, { onConflict: "client_id" });
        }
      }

      toast.success(hasCo
        ? t("clientWizard.toasts.uploadedWithCo", { name: fullName })
        : t("clientWizard.toasts.uploadedSingle", { name: fullName }));
      qc.invalidateQueries({ queryKey: ["clients"] });
      onCreated?.(clientId);
      navigate({ to: "/clients/$id", params: { id: clientId } }).catch(() => {});
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? t("clientWizard.toasts.parseError"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ---- Save ----
  const create = useMutation({
    mutationFn: async () => {
      if (!form.role_choice) throw new Error(t("clientWizard.toasts.roleRequired"));
      if (!fullName) throw new Error(form.entity_type === "company"
        ? t("clientWizard.toasts.companyRequired")
        : t("clientWizard.toasts.personRequired"));

      const role = form.role_choice as RoleChoice;
      const { data: userData } = await supabase.auth.getUser();
      const owner_id = userData.user?.id ?? null;

      // 1) Client
      const clientPayload: any = {
        full_name: fullName,
        entity_type: form.entity_type,
        company_name: form.entity_type === "company" ? (form.company_name || null) : null,
        contact_first_name: form.entity_type === "company"
          ? (form.contact_mode === "manual" ? (form.contact_first_name || null) : null)
          : null,
        contact_last_name: form.entity_type === "company"
          ? (form.contact_mode === "manual" ? (form.contact_last_name || null) : null)
          : null,
        email: form.email || null,
        phone: form.phone || null,
        client_type: ROLE_TO_CLIENT_TYPE[role] as any,
        notes: form.notes || null,
        owner_id,
        assigned_to: owner_id,
        address: form.street || null,
        postal_code: form.postal_code || null,
        city: form.city || null,
        country: form.country || null,
        equity: num(form.own_funds_total) ?? num(form.equity),
        financing_status: form.financing_status || null,
      };
      const { data: client, error: clientErr } = await supabase
        .from("clients").insert(clientPayload).select("id").single();
      if (clientErr) throw clientErr;
      const clientId = client.id as string;

      // 2) Hauptrolle in client_roles
      const dbRole = ROLE_TO_DB_ROLE[role];
      const { error: roleErr } = await supabase.from("client_roles").insert({
        client_id: clientId,
        role_type: dbRole as any,
        status: "active",
        start_date: new Date().toISOString().slice(0, 10),
      });
      if (roleErr) console.warn("Rolle:", roleErr);

      // 3) Firma -> Kontaktperson
      if (form.entity_type === "company") {
        if (form.contact_mode === "existing" && form.linked_contact_client_id) {
          // Verknüpfen über client_relationships
          const { error: relErr } = await supabase.from("client_relationships").insert({
            client_id: clientId,
            related_client_id: form.linked_contact_client_id,
            relationship_type: "other" as any,
            notes: t("clientWizard.toasts.contactPersonNote"),
          });
          if (relErr) console.warn("Relationship:", relErr);
          // Zusätzlich client_roles contact_person für die verknüpfte Person
          await supabase.from("client_roles").insert({
            client_id: form.linked_contact_client_id,
            role_type: "contact_person" as any,
            status: "active",
            start_date: new Date().toISOString().slice(0, 10),
            related_id: clientId,
            related_type: "client",
            notes: t("clientWizard.toasts.contactPersonFor", { name: fullName }),
          });
        }
      }

      // 4) Suchprofil
      if (role === "buyer" || role === "tenant" || role === "investor") {
        const profilePayload: any = {
          client_id: clientId,
          role_type: dbRole as any,
          listing_type: role === "tenant" ? "rent" : (form.preferred_listing || (role === "investor" ? "sale" : "sale")),
          preferred_cities: form.preferred_cities
            ? form.preferred_cities.split(",").map((s) => s.trim()).filter(Boolean) : null,
          preferred_property_types: form.preferred_types.length ? form.preferred_types : null,
          budget_min: num(form.budget_min),
          budget_max: num(form.budget_max),
          rooms_min: num(form.rooms_min),
          area_min: num(form.area_min),
          yield_target: role === "investor" ? num(form.yield_target) : null,
          usage_types: role === "investor" && form.usage_types.length ? form.usage_types : null,
          notes: null,
        };
        const { error: spErr } = await supabase.from("client_search_profiles").insert(profilePayload);
        if (spErr) console.warn("Suchprofil:", spErr);
      }

      // 5) Eigentum / Immobilie (Verkäufer/Vermieter/Eigentümer)
      let createdPropertyId: string | null = null;
      if (role === "seller_owner" || role === "landlord") {
        let propertyId: string | null = null;
        if (form.property_mode === "existing" && form.selected_property_id) {
          propertyId = form.selected_property_id;
        } else if (form.property_mode === "new" && form.new_property_title.trim()) {
          const { data: prop, error: propErr } = await supabase.from("properties").insert({
            title: form.new_property_title,
            address: form.new_property_address || null,
            postal_code: form.new_property_postal_code || null,
            city: form.new_property_city || null,
            property_type: form.new_property_type as any,
            listing_type: (role === "landlord" ? "rent" : "sale") as any,
            status: "draft" as any,
            price: num(form.new_property_price),
            owner_client_id: clientId,
            owner_id,
          }).select("id").single();
          if (propErr) console.warn("Immobilie:", propErr);
          propertyId = prop?.id ?? null;
          createdPropertyId = propertyId;
        }

        if (propertyId) {
          // Owner-Rolle für Client mit Bezug zur Immobilie
          await supabase.from("client_roles").insert({
            client_id: clientId,
            role_type: "owner" as any,
            status: "active",
            start_date: form.ownership_start_date || new Date().toISOString().slice(0, 10),
            related_id: propertyId,
            related_type: "property",
            notes: form.ownership_notes || null,
          });

          // property_ownerships Eintrag
          await supabase.from("property_ownerships").insert({
            property_id: propertyId,
            client_id: clientId,
            ownership_type: "owner" as any,
            source: "manual",
            start_date: form.ownership_start_date || new Date().toISOString().slice(0, 10),
            share_percent: num(form.ownership_share),
            notes: form.ownership_notes || null,
            is_primary_contact: true,
          });

          // Activity Log
          await supabase.from("activity_logs").insert({
            action: "ownership_created",
            actor_id: owner_id,
            related_id: propertyId,
            related_type: "property",
            metadata: { client_id: clientId, source: "client_wizard", role: dbRole },
          });
        }
      }

      // 6) Finanzierungskunde -> optional Immobilienbezug
      if (role === "financing_applicant" && form.property_mode === "existing" && form.selected_property_id) {
        await supabase.from("client_roles").insert({
          client_id: clientId,
          role_type: "financing_applicant" as any,
          status: "active",
          start_date: new Date().toISOString().slice(0, 10),
          related_id: form.selected_property_id,
          related_type: "property",
        });
      }

      // 7) Finanzierungs-Draft anlegen (nur wenn financing-Step ausgefüllt wurde)
      const hasFinancingStep = role === "financing_applicant" || role === "buyer";
      const anyFinValue =
        form.fin_purchase_price || form.fin_renovation_costs ||
        form.fin_existing_mortgage || form.fin_requested_mortgage ||
        form.fin_requested_increase || form.fin_target_financing_amount ||
        form.fin_project_costs || form.own_funds_total ||
        form.gross_income_yearly;
      if (hasFinancingStep && anyFinValue) {
        const goal = role === "financing_applicant" ? form.financing_goal : "purchase";
        const linkedPropertyId = createdPropertyId
          ?? (form.property_mode === "existing" ? form.selected_property_id || null : null);
        const requestedMortgage =
          num(form.fin_requested_mortgage) ?? num(form.fin_target_financing_amount);
        const dossierPayload: any = {
          client_id: clientId,
          property_id: linkedPropertyId,
          financing_type: goal,
          financing_modules: goal ? [goal] : [],
          status: "draft",
          dossier_status: "draft",
          quick_check_status: "incomplete",
          data_source: linkedPropertyId ? "existing_property" : "manual",
          title: t("clientWizard.toasts.financingTitle", { name: fullName }),
          purchase_price: num(form.fin_purchase_price),
          renovation_costs: num(form.fin_renovation_costs),
          existing_mortgage: num(form.fin_existing_mortgage),
          requested_mortgage: requestedMortgage,
          requested_increase: num(form.fin_requested_increase),
          construction_costs: num(form.fin_project_costs),
          own_funds_total: num(form.own_funds_total),
          own_funds_liquid: num(form.own_funds_cash),
          own_funds_pillar_3a: num(form.own_funds_pillar_3a),
          own_funds_pension_fund: num(form.own_funds_pension_fund),
          own_funds_vested_benefits: num(form.own_funds_vested_benefits),
          own_funds_gift: num(form.own_funds_gift),
          own_funds_private_loan: num(form.own_funds_private_loan),
          own_funds_inheritance: num(form.own_funds_inheritance),
          gross_income_yearly: num(form.gross_income_yearly),
          section_additional: {
            wizard_source: true,
            own_funds_securities: num(form.own_funds_securities),
            own_funds_other: num(form.own_funds_other),
            partner_income_yearly: num(form.partner_income_yearly),
            target_financing_amount: num(form.fin_target_financing_amount),
          },
        };
        const { error: dossierErr } = await supabase
          .from("financing_dossiers").insert(dossierPayload);
        if (dossierErr) console.warn("Finanzierungsdossier:", dossierErr);
      }

      return {
        clientId,
        role,
        propertyId: createdPropertyId
          ?? (form.property_mode === "existing" ? form.selected_property_id : null),
      };
    },
    onSuccess: ({ clientId, role, propertyId }) => {
      toast.success(t("clientWizard.toasts.createSuccess"));
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["properties"] });
      onCreated?.(clientId);

      // Immer zum Kundenprofil
      navigate({ to: "/clients/$id", params: { id: clientId } }).catch(() => {});

      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? t("clientWizard.toasts.createError")),
  });

  // ---- Navigation ----
  const isLast = stepIdx === steps.length - 1;
  const canProceed = (() => {
    if (currentStep === "role") return !!form.role_choice;
    if (currentStep === "stamm") {
      return form.entity_type === "company" ? form.company_name.trim().length > 0 : personName.length > 0;
    }
    return true;
  })();

  const progress = ((stepIdx + 1) / steps.length) * 100;

  // ---- UI Render ----
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] w-full max-w-4xl overflow-hidden p-0">
        <div className="flex flex-col max-h-[92vh]">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle className="text-xl">{t("clientWizard.title")}</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("clientWizard.stepProgress", { current: stepIdx + 1, total: steps.length, label: t(`clientWizard.steps.${currentStep}`) })}
            </p>
            <div className="mt-3"><Progress value={progress} className="h-1.5" /></div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* ENTITY */}
            {currentStep === "entity" && (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-semibold">{t("clientWizard.entity.question")}</p>
                  <p className="text-sm text-muted-foreground">{t("clientWizard.entity.hint")}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {([
                    { v: "person",  k: "person",  Icon: User },
                    { v: "company", k: "company", Icon: Building2 },
                  ] as const).map(({ v, k, Icon }) => {
                    const active = form.entity_type === v;
                    return (
                      <button type="button" key={v}
                        onClick={() => set("entity_type", v)}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left transition hover:border-primary/60 hover:bg-accent/40 ${
                          active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : ""
                        }`}>
                        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="flex-1">
                          <span className="block font-semibold">{t(`clientWizard.entity.${k}.title`)}</span>
                          <span className="block text-sm text-muted-foreground">{t(`clientWizard.entity.${k}.desc`)}</span>
                        </span>
                        {active && <Check className="h-5 w-5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* METHOD: Manuell vs. Selbstauskunft-Upload */}
            {currentStep === "method" && (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-semibold">{t("clientWizard.method.question")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("clientWizard.method.hint")}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {([
                    { v: "manual", k: "manual", Icon: ClipboardCheck },
                    { v: "upload", k: "upload", Icon: Sparkles },
                  ] as const).map(({ v, k, Icon }) => {
                    const active = form.creation_method === v;
                    return (
                      <button type="button" key={v}
                        onClick={() => set("creation_method", v)}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left transition hover:border-primary/60 hover:bg-accent/40 ${
                          active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : ""
                        }`}>
                        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="flex-1">
                          <span className="block font-semibold">{t(`clientWizard.method.${k}.title`)}</span>
                          <span className="block text-sm text-muted-foreground">{t(`clientWizard.method.${k}.desc`)}</span>
                        </span>
                        {active && <Check className="h-5 w-5 text-primary" />}
                      </button>
                    );
                  })}
                </div>

                {form.creation_method === "upload" && (
                  <div className="rounded-xl border border-dashed p-6 text-center space-y-3">
                    <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{t("clientWizard.method.pdfTitle")}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("clientWizard.method.pdfHint")}
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleSelfDisclosureUpload(f);
                      }}
                    />
                    <Button type="button" disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}>
                      {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      {uploading ? t("clientWizard.method.analyzing") : t("clientWizard.method.selectPdf")}
                    </Button>
                  </div>
                )}
              </div>
            )}



            {/* ROLE */}
            {currentStep === "role" && (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-semibold">{t("clientWizard.role.question")}</p>
                  <p className="text-sm text-muted-foreground">{t("clientWizard.role.hint")}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {ROLE_OPTIONS.map(({ value, icon: Icon }) => {
                    const active = form.role_choice === value;
                    return (
                      <button type="button" key={value}
                        onClick={() => set("role_choice", value)}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left transition hover:border-primary/60 hover:bg-accent/40 ${
                          active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : ""
                        }`}>
                        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="flex-1">
                          <span className="block font-semibold">{t(`clientWizard.role.options.${value}.label`)}</span>
                          <span className="block text-sm text-muted-foreground">{t(`clientWizard.role.options.${value}.description`)}</span>
                        </span>
                        {active && <Check className="h-5 w-5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* STAMM */}
            {currentStep === "stamm" && (
              <div className="space-y-4">
                {form.entity_type === "company" ? (
                  <>
                    <div>
                      <Label>{t("clientWizard.stamm.companyName")}</Label>
                      <Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} placeholder="ACME AG" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div><Label>{t("clientWizard.stamm.email")}</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.stamm.phone")}</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label>{t("clientWizard.stamm.salutation")}</Label>
                        <Select value={form.salutation} onValueChange={(v) => set("salutation", v)}>
                          <SelectTrigger><SelectValue placeholder={t("clientWizard.stamm.selectPlaceholder")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Herr">{t("clientWizard.stamm.salHerr")}</SelectItem>
                            <SelectItem value="Frau">{t("clientWizard.stamm.salFrau")}</SelectItem>
                            <SelectItem value="Divers">{t("clientWizard.stamm.salDivers")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>{t("clientWizard.stamm.firstName")}</Label><Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.stamm.lastName")}</Label><Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div><Label>{t("clientWizard.stamm.email")}</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.stamm.phone")}</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-2"><Label>{t("clientWizard.stamm.street")}</Label><AddressAutocomplete value={form.street} onChange={(v) => set("street", v)} onSelect={(s) => { set("street", s.street || s.label); if (s.postal_code) set("postal_code", s.postal_code); if (s.city) set("city", s.city); if (s.country_code) set("country", s.country_code); }} /></div>
                  <div><Label>{t("clientWizard.stamm.postalCode")}</Label><Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} /></div>
                  <div><Label>{t("clientWizard.stamm.city")}</Label><Input value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
                </div>
              </div>
            )}

            {/* COMPANY CONTACT (Firma -> Kontaktperson) */}
            {currentStep === "company_contact" && (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-semibold">{t("clientWizard.companyContact.title")}</p>
                  <p className="text-sm text-muted-foreground">{t("clientWizard.companyContact.hint")}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {([
                    { v: "manual",   k: "manual",   Icon: User },
                    { v: "existing", k: "existing", Icon: Users },
                  ] as const).map(({ v, k, Icon }) => {
                    const active = form.contact_mode === v;
                    return (
                      <button type="button" key={v}
                        onClick={() => set("contact_mode", v)}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left transition hover:border-primary/60 ${
                          active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : ""
                        }`}>
                        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-semibold">{t(`clientWizard.companyContact.${k}.title`)}</span>
                          <span className="block text-xs text-muted-foreground">{t(`clientWizard.companyContact.${k}.desc`)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {form.contact_mode === "manual" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><Label>{t("clientWizard.companyContact.firstName")}</Label><Input value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.companyContact.lastName")}</Label><Input value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} /></div>
                  </div>
                )}

                {form.contact_mode === "existing" && (
                  <div>
                    <Label>{t("clientWizard.companyContact.existingClient")}</Label>
                    <Select value={form.linked_contact_client_id} onValueChange={(v) => set("linked_contact_client_id", v)}>
                      <SelectTrigger><SelectValue placeholder={t("clientWizard.companyContact.selectPerson")} /></SelectTrigger>
                      <SelectContent>
                        {(personClientsQuery.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.full_name}{c.email ? ` · ${c.email}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* SEARCH (Buyer/Tenant) */}
            {currentStep === "search" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>{t("clientWizard.search.listingType")}</Label>
                    <Select value={form.preferred_listing || (form.role_choice === "tenant" ? "rent" : "sale")} onValueChange={(v) => set("preferred_listing", v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sale">{t("clientWizard.search.listingSale")}</SelectItem>
                        <SelectItem value="rent">{t("clientWizard.search.listingRent")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("clientWizard.search.preferredCities")}</Label>
                    <Input value={form.preferred_cities} onChange={(e) => set("preferred_cities", e.target.value)} placeholder={t("clientWizard.search.citiesPlaceholder")} />
                  </div>
                </div>
                <div>
                  <Label>{t("clientWizard.search.propertyTypes")}</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {PROP_TYPES.map((pt) => {
                      const active = form.preferred_types.includes(pt);
                      return (
                        <button type="button" key={pt}
                          onClick={() => set("preferred_types", active ? form.preferred_types.filter((x) => x !== pt) : [...form.preferred_types, pt])}
                          className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}>
                          {propertyTypeLabels[pt as keyof typeof propertyTypeLabels] ?? pt}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><Label>{t("clientWizard.search.budgetMin")}</Label><Input type="number" value={form.budget_min} onChange={(e) => set("budget_min", e.target.value)} /></div>
                  <div><Label>{t("clientWizard.search.budgetMax")}</Label><Input type="number" value={form.budget_max} onChange={(e) => set("budget_max", e.target.value)} /></div>
                  <div><Label>{t("clientWizard.search.roomsMin")}</Label><Input type="number" value={form.rooms_min} onChange={(e) => set("rooms_min", e.target.value)} /></div>
                  <div><Label>{t("clientWizard.search.areaMin")}</Label><Input type="number" value={form.area_min} onChange={(e) => set("area_min", e.target.value)} /></div>
                </div>
              </div>
            )}

            {/* INVESTMENT */}
            {currentStep === "investment" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>{t("clientWizard.investment.preferredCities")}</Label>
                    <Input value={form.preferred_cities} onChange={(e) => set("preferred_cities", e.target.value)} />
                  </div>
                  <div>
                    <Label>{t("clientWizard.investment.yieldTarget")}</Label>
                    <Input type="number" step="0.1" value={form.yield_target} onChange={(e) => set("yield_target", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>{t("clientWizard.investment.propertyTypes")}</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {PROP_TYPES.map((pt) => {
                      const active = form.preferred_types.includes(pt);
                      return (
                        <button type="button" key={pt}
                          onClick={() => set("preferred_types", active ? form.preferred_types.filter((x) => x !== pt) : [...form.preferred_types, pt])}
                          className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}>
                          {propertyTypeLabels[pt as keyof typeof propertyTypeLabels] ?? pt}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <Label>{t("clientWizard.investment.usages")}</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(["residential", "commercial", "yield"] as const).map((v) => {
                      const active = form.usage_types.includes(v);
                      return (
                        <button type="button" key={v}
                          onClick={() => set("usage_types", active ? form.usage_types.filter((x) => x !== v) : [...form.usage_types, v])}
                          className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}>
                          {t(`clientWizard.investment.usage.${v}`)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>{t("clientWizard.investment.budgetMin")}</Label><Input type="number" value={form.budget_min} onChange={(e) => set("budget_min", e.target.value)} /></div>
                  <div><Label>{t("clientWizard.investment.budgetMax")}</Label><Input type="number" value={form.budget_max} onChange={(e) => set("budget_max", e.target.value)} /></div>
                </div>
              </div>
            )}

            {/* FINANCING */}
            {currentStep === "financing" && (() => {
              const goal = form.role_choice === "financing_applicant" ? form.financing_goal : "purchase";
              const ownFundsSplit =
                num(form.own_funds_cash) ?? 0;
              const splitSum =
                (num(form.own_funds_cash) ?? 0) +
                (num(form.own_funds_pillar_3a) ?? 0) +
                (num(form.own_funds_pension_fund) ?? 0) +
                (num(form.own_funds_vested_benefits) ?? 0) +
                (num(form.own_funds_securities) ?? 0) +
                (num(form.own_funds_gift) ?? 0) +
                (num(form.own_funds_private_loan) ?? 0) +
                (num(form.own_funds_inheritance) ?? 0) +
                (num(form.own_funds_other) ?? 0);
              void ownFundsSplit;
              const total = num(form.own_funds_total);
              const mismatch = total != null && Math.abs(total - splitSum) > 1;
              return (
              <div className="space-y-5">
                {form.role_choice === "financing_applicant" && (
                  <div>
                    <Label>{t("clientWizard.financing.goal")}</Label>
                    <Select value={form.financing_goal} onValueChange={(v) => set("financing_goal", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FINANCING_GOALS.map((g) => <SelectItem key={g} value={g}>{t(`clientWizard.financingGoals.${g}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Objekt-/Finanzierungswerte je nach Ziel */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold">{t("clientWizard.financing.objectValues")}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(goal === "purchase") && (<>
                      <div><Label>{t("clientWizard.financing.purchasePrice")}</Label><Input type="number" value={form.fin_purchase_price} onChange={(e) => set("fin_purchase_price", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.financing.requestedMortgage")}</Label><Input type="number" value={form.fin_requested_mortgage} onChange={(e) => set("fin_requested_mortgage", e.target.value)} /></div>
                    </>)}
                    {(goal === "renovation") && (<>
                      <div><Label>{t("clientWizard.financing.renovationCosts")}</Label><Input type="number" value={form.fin_renovation_costs} onChange={(e) => set("fin_renovation_costs", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.financing.targetFinancingAmount")}</Label><Input type="number" value={form.fin_target_financing_amount} onChange={(e) => set("fin_target_financing_amount", e.target.value)} /></div>
                    </>)}
                    {(goal === "increase") && (<>
                      <div><Label>{t("clientWizard.financing.additionalNeed")}</Label><Input type="number" value={form.fin_requested_increase} onChange={(e) => set("fin_requested_increase", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.financing.existingMortgageOptional")}</Label><Input type="number" value={form.fin_existing_mortgage} onChange={(e) => set("fin_existing_mortgage", e.target.value)} /></div>
                    </>)}
                    {(goal === "refinance") && (<>
                      <div><Label>{t("clientWizard.financing.existingMortgage")}</Label><Input type="number" value={form.fin_existing_mortgage} onChange={(e) => set("fin_existing_mortgage", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.financing.newRequestedMortgage")}</Label><Input type="number" value={form.fin_requested_mortgage} onChange={(e) => set("fin_requested_mortgage", e.target.value)} /></div>
                    </>)}
                    {(goal === "new_build") && (<>
                      <div><Label>{t("clientWizard.financing.projectCosts")}</Label><Input type="number" value={form.fin_project_costs} onChange={(e) => set("fin_project_costs", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.financing.requestedMortgage")}</Label><Input type="number" value={form.fin_requested_mortgage} onChange={(e) => set("fin_requested_mortgage", e.target.value)} /></div>
                    </>)}
                    {(goal === "mortgage_increase") && (<>
                      <div><Label>{t("clientWizard.financing.existingMortgage")}</Label><Input type="number" value={form.fin_existing_mortgage} onChange={(e) => set("fin_existing_mortgage", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.financing.increaseAmount")}</Label><Input type="number" value={form.fin_requested_increase} onChange={(e) => set("fin_requested_increase", e.target.value)} /></div>
                    </>)}
                  </div>
                </div>

                {/* Eigenmittel */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold">{t("clientWizard.financing.ownFunds")}</p>
                  <div><Label>{t("clientWizard.financing.ownFundsTotal")}</Label><Input type="number" value={form.own_funds_total} onChange={(e) => set("own_funds_total", e.target.value)} /></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div><Label>{t("clientWizard.financing.cash")}</Label><Input type="number" value={form.own_funds_cash} onChange={(e) => set("own_funds_cash", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.pillar3a")}</Label><Input type="number" value={form.own_funds_pillar_3a} onChange={(e) => set("own_funds_pillar_3a", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.pensionFund")}</Label><Input type="number" value={form.own_funds_pension_fund} onChange={(e) => set("own_funds_pension_fund", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.vestedBenefits")}</Label><Input type="number" value={form.own_funds_vested_benefits} onChange={(e) => set("own_funds_vested_benefits", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.securities")}</Label><Input type="number" value={form.own_funds_securities} onChange={(e) => set("own_funds_securities", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.gift")}</Label><Input type="number" value={form.own_funds_gift} onChange={(e) => set("own_funds_gift", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.privateLoan")}</Label><Input type="number" value={form.own_funds_private_loan} onChange={(e) => set("own_funds_private_loan", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.inheritance")}</Label><Input type="number" value={form.own_funds_inheritance} onChange={(e) => set("own_funds_inheritance", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.other")}</Label><Input type="number" value={form.own_funds_other} onChange={(e) => set("own_funds_other", e.target.value)} /></div>
                  </div>
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-xs">
                    {t("clientWizard.financing.splitSum")} <strong>CHF {splitSum.toLocaleString(numLocale)}</strong>
                    {mismatch && (
                      <span className="ml-2 text-amber-600">
                        {t("clientWizard.financing.mismatchHint")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Einkommen */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold">{t("clientWizard.financing.income")}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><Label>{t("clientWizard.financing.grossIncome")}</Label><Input type="number" value={form.gross_income_yearly} onChange={(e) => set("gross_income_yearly", e.target.value)} /></div>
                    <div><Label>{t("clientWizard.financing.partnerIncome")}</Label><Input type="number" value={form.partner_income_yearly} onChange={(e) => set("partner_income_yearly", e.target.value)} /></div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("clientWizard.financing.incomeHint")}
                  </p>
                </div>

                <div>
                  <Label>{t("clientWizard.financing.financingStatus")}</Label>
                  <Select value={form.financing_status} onValueChange={(v) => set("financing_status", v)}>
                    <SelectTrigger><SelectValue placeholder={t("clientWizard.financing.statusPlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {[
                        { v: "unklar", k: "unklar" },
                        { v: "in Prüfung", k: "inPruefung" },
                        { v: "Vorabbestätigung", k: "vorab" },
                        { v: "bestätigt", k: "bestaetigt" },
                        { v: "abgelehnt", k: "abgelehnt" },
                      ].map((f) =>
                        <SelectItem key={f.v} value={f.v}>{t(`clientWizard.financing.status.${f.k}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              );
            })()}

            {/* PROPERTY (Verkäufer/Vermieter/Finanzierung) */}
            {currentStep === "property" && (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-semibold">{t("clientWizard.property.title")}</p>
                  <p className="text-sm text-muted-foreground">
                    {form.role_choice === "financing_applicant"
                      ? t("clientWizard.property.hintFinancing")
                      : t("clientWizard.property.hintOther")}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {([
                    { v: "existing", k: "modeExisting" },
                    { v: "new",      k: "modeNew" },
                    { v: "none",     k: "modeNone" },
                  ] as const).map(({ v, k }) => (
                    <button type="button" key={v}
                      onClick={() => set("property_mode", v)}
                      className={`rounded-xl border p-3 text-sm transition ${form.property_mode === v ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "hover:bg-muted"}`}>
                      {t(`clientWizard.property.${k}`)}
                    </button>
                  ))}
                </div>

                {form.property_mode === "existing" && (
                  <div>
                    <Label>{t("clientWizard.property.selectLabel")}</Label>
                    <Select value={form.selected_property_id} onValueChange={(v) => set("selected_property_id", v)}>
                      <SelectTrigger><SelectValue placeholder={t("clientWizard.property.selectPlaceholder")} /></SelectTrigger>
                      <SelectContent>
                        {(propertiesQuery.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}{p.city ? ` · ${p.city}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {form.property_mode === "new" && (
                  <div className="space-y-3">
                    <div><Label>{t("clientWizard.property.newTitle")}</Label><Input value={form.new_property_title} onChange={(e) => set("new_property_title", e.target.value)} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="md:col-span-2"><Label>{t("clientWizard.property.address")}</Label><AddressAutocomplete value={form.new_property_address} onChange={(v) => set("new_property_address", v)} onSelect={(s) => { set("new_property_address", s.street || s.label); if (s.postal_code) set("new_property_postal_code", s.postal_code); }} /></div>
                      <div><Label>{t("clientWizard.property.postalCode")}</Label><Input value={form.new_property_postal_code} onChange={(e) => set("new_property_postal_code", e.target.value)} /></div>
                      <div><Label>{t("clientWizard.property.city")}</Label><Input value={form.new_property_city} onChange={(e) => set("new_property_city", e.target.value)} /></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label>{t("clientWizard.property.propType")}</Label>
                        <Select value={form.new_property_type} onValueChange={(v) => set("new_property_type", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PROP_TYPES.map((pt) => <SelectItem key={pt} value={pt}>{propertyTypeLabels[pt as keyof typeof propertyTypeLabels] ?? pt}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>{t("clientWizard.property.estimatedPrice")}</Label><Input type="number" value={form.new_property_price} onChange={(e) => set("new_property_price", e.target.value)} /></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* OWNERSHIP */}
            {currentStep === "ownership" && (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-semibold">{t("clientWizard.ownership.title")}</p>
                  <p className="text-sm text-muted-foreground">{t("clientWizard.ownership.hint")}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><Label>{t("clientWizard.ownership.since")}</Label><Input type="date" value={form.ownership_start_date} onChange={(e) => set("ownership_start_date", e.target.value)} /></div>
                  <div><Label>{t("clientWizard.ownership.share")}</Label><Input type="number" step="0.01" value={form.ownership_share} onChange={(e) => set("ownership_share", e.target.value)} placeholder="100" /></div>
                </div>
                <div><Label>{t("clientWizard.ownership.notes")}</Label><Textarea value={form.ownership_notes} onChange={(e) => set("ownership_notes", e.target.value)} /></div>
                <p className="text-xs text-muted-foreground">
                  {t("clientWizard.ownership.mandateHint")}
                </p>
              </div>
            )}

            {/* TAGS */}
            {currentStep === "tags" && (
              <div className="space-y-4">
                <div><Label>{t("clientWizard.tags.notes")}</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
                <div><Label>{t("clientWizard.tags.tagsField")}</Label><Input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder={t("clientWizard.tags.tagsPlaceholder")} /></div>
              </div>
            )}

            {/* REVIEW */}
            {currentStep === "review" && (
              <div className="space-y-4">
                <div className="rounded-xl border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{form.entity_type === "company" ? t("clientWizard.review.companyType") : t("clientWizard.review.privatePerson")}</Badge>
                    <Badge>{form.role_choice ? t(`clientWizard.role.options.${form.role_choice}.label`) : ""}</Badge>
                  </div>
                  <p className="text-lg font-semibold">{fullName || t("clientWizard.common.dash")}</p>
                  {(form.email || form.phone) && (
                    <p className="text-sm text-muted-foreground">
                      {[form.email, form.phone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {(form.street || form.city) && (
                    <p className="text-sm text-muted-foreground">
                      {[form.street, form.postal_code, form.city].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {form.entity_type === "company" && form.contact_mode === "existing" && form.linked_contact_client_id && (
                    <p className="text-sm">
                      {t("clientWizard.review.contactPerson")} {(personClientsQuery.data ?? []).find((c) => c.id === form.linked_contact_client_id)?.full_name}
                    </p>
                  )}
                  {form.entity_type === "company" && form.contact_mode === "manual" && (form.contact_first_name || form.contact_last_name) && (
                    <p className="text-sm">{t("clientWizard.review.contactPerson")} {`${form.contact_first_name} ${form.contact_last_name}`.trim()}</p>
                  )}
                </div>

                {(form.role_choice === "buyer" || form.role_choice === "tenant" || form.role_choice === "investor") && (
                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-semibold mb-1">{t("clientWizard.review.searchProfile")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("clientWizard.review.budgetRange", { cities: form.preferred_cities || t("clientWizard.common.dash"), min: form.budget_min || t("clientWizard.common.dash"), max: form.budget_max || t("clientWizard.common.dash") })}
                      {form.role_choice === "investor" && form.yield_target ? t("clientWizard.review.yieldSuffix", { value: form.yield_target }) : ""}
                    </p>
                  </div>
                )}

                {(form.role_choice === "seller_owner" || form.role_choice === "landlord") && (
                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-semibold mb-1">{t("clientWizard.review.ownership")}</p>
                    <p className="text-sm text-muted-foreground">
                      {form.property_mode === "existing"
                        ? (propertiesQuery.data ?? []).find((p) => p.id === form.selected_property_id)?.title || t("clientWizard.review.ownershipExistingFallback")
                        : form.property_mode === "new"
                          ? form.new_property_title || t("clientWizard.review.ownershipNewFallback")
                          : t("clientWizard.review.ownershipNoneText")}
                    </p>
                  </div>
                )}

                {form.role_choice === "financing_applicant" && (
                  <div className="rounded-xl border p-4">
                    <p className="text-sm font-semibold mb-1">{t("clientWizard.review.financing")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("clientWizard.review.goalLabel")} {form.financing_goal ? t(`clientWizard.financingGoals.${form.financing_goal}`) : ""}
                      {form.equity ? t("clientWizard.review.equitySuffix", { amount: form.equity }) : ""}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t bg-background px-6 py-4">
            <Button type="button" variant="outline" disabled={stepIdx === 0 || create.isPending}
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> {t("clientWizard.nav.back")}
            </Button>
            {currentStep === "method" && form.creation_method === "upload" ? (
              <p className="text-xs text-muted-foreground">
                {t("clientWizard.nav.uploadHint")}
              </p>
            ) : !isLast ? (
              <Button type="button" disabled={!canProceed}
                onClick={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}>
                {t("clientWizard.nav.next")} <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" disabled={!canSave || create.isPending}
                onClick={() => create.mutate()}>
                {create.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-1 h-4 w-4" />}
                {create.isPending ? t("clientWizard.nav.creating") : t("clientWizard.nav.create")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
