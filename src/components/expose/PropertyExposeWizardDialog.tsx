import { useTenantBranding } from "@/lib/tenant-branding";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check, ChevronLeft, ChevronRight, FileDown, Image as ImageIcon, LayoutTemplate,
  Loader2, ListChecks, Eye, Star, Sparkles, UserRound, Paperclip, FileText, GripVertical,
  ArrowUp, ArrowDown, RotateCcw,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { formatCurrency, formatArea, propertyTypeLabels, listingTypeLabels } from "@/lib/format";
import {
  renderExposeHTML,
  EXPOSE_SECTION_KEYS,
  EXPOSE_SECTION_LABELS,
  type ExposeSectionKey,
} from "@/lib/expose-template";
import { renderDocumentPdf, fetchDocumentPdfBytes } from "@/lib/documents.functions";
import { TEMPLATES, type TemplateMeta, type GalerieLayout } from "@/components/expose/TemplatePreview";

type Props = {
  propertyId: string;
  property: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FactKey =
  | "property_type" | "listing_type" | "price" | "rent"
  | "area" | "living_area" | "plot_area" | "rooms" | "bathrooms"
  | "year_built" | "renovated_at" | "floor" | "energy_class";

const FACT_DEFS: Array<{ key: FactKey; label: string }> = [
  { key: "property_type", label: "Objekttyp" },
  { key: "listing_type", label: "Vermarktung" },
  { key: "price", label: "Kaufpreis" },
  { key: "rent", label: "Miete" },
  { key: "living_area", label: "Wohnfläche" },
  { key: "area", label: "Fläche" },
  { key: "plot_area", label: "Grundstück" },
  { key: "rooms", label: "Zimmer" },
  { key: "bathrooms", label: "Bäder" },
  { key: "floor", label: "Etage" },
  { key: "year_built", label: "Baujahr" },
  { key: "renovated_at", label: "Renoviert" },
  { key: "energy_class", label: "Energieklasse" },
];

const GALLERY_OPTIONS: Array<{ id: GalerieLayout; label: string; cols: number; desc: string }> = [
  { id: "grid2", label: "Grid 2×2", cols: 2, desc: "4 grosse Bilder pro Seite" },
  { id: "grid4", label: "Grid 3×3", cols: 3, desc: "9 Bilder pro Seite" },
  { id: "fullpage", label: "Vollbild", cols: 1, desc: "Ein Bild pro Seite" },
];

/** Rendert die erste Exposé-Seite (A4) komplett sichtbar, ohne Scrollen – wie ein Miniaturbild. */
function ScaledExposePreview({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 794);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full overflow-hidden rounded-lg border bg-white" style={{ aspectRatio: "210 / 297" }}>
      <iframe
        title={title}
        srcDoc={
          html +
          "<style>@media screen{html,body{background:#fff}body{padding:0}.page{margin:0;box-shadow:none;border:0}.page::after{display:none}}</style>"
        }
        className="pointer-events-none border-0"
        style={{ width: 794, height: 1123, transform: `scale(${scale})`, transformOrigin: "top left" }}
      />

    </div>
  );
}

const STEPS = [
  { label: "Vorlage", icon: LayoutTemplate },
  { label: "Inhalte", icon: ListChecks },
  { label: "Galerie", icon: ImageIcon },
  { label: "Anhänge", icon: Paperclip },
  { label: "Ansprechperson", icon: UserRound },
  { label: "Vorschau", icon: Eye },
  { label: "Reihenfolge", icon: GripVertical },
  { label: "Generieren", icon: FileDown },
] as const;

function mediaUrl(path?: string | null) {
  if (!path) return "";
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

async function urlToDataUri(url: string, maxSide = 1600, quality = 0.82): Promise<string | null> {
  try {
    // Kein `credentials: "include"` — Storage antwortet mit `Access-Control-Allow-Origin: *`,
    // was mit Credentials einen CORS-Fehler auslöst und die Bilder im PDF fehlen liess.
    const res = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();

    // Bilder verkleinern, damit das HTML-Payload unter dem Server-Limit bleibt.
    const downscaled = await downscaleBlob(blob, maxSide, quality);
    if (downscaled) return downscaled;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

async function downscaleBlob(blob: Blob, maxSide: number, quality: number): Promise<string | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return dataUrl.startsWith("data:image/jpeg") ? dataUrl : null;
  } catch {
    return null;
  }
}


export function PropertyExposeWizardDialog({ propertyId, property, open, onOpenChange }: Props) {
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<TemplateMeta>(TEMPLATES[0]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [withDescription, setWithDescription] = useState(true);
  const [withFeatures, setWithFeatures] = useState(true);
  const [withContact, setWithContact] = useState(true);
  const [visibleFacts, setVisibleFacts] = useState<Set<FactKey>>(
    new Set<FactKey>(["property_type", "listing_type", "price", "rent", "living_area", "rooms", "bathrooms", "energy_class"]),
  );
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryLayout, setGalleryLayout] = useState<GalerieLayout>("grid2");
  const [generating, setGenerating] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [sectionOrder, setSectionOrder] = useState<ExposeSectionKey[]>([...EXPOSE_SECTION_KEYS]);
  const [dragKey, setDragKey] = useState<ExposeSectionKey | null>(null);
  const [withMacro, setWithMacro] = useState(false);
  const [withMarket, setWithMarket] = useState(false);
  const [contactMode, setContactMode] = useState<"employee" | "custom">("employee");
  const [contactUserId, setContactUserId] = useState<string | null>(null);
  const [customContact, setCustomContact] = useState({ name: "", email: "", phone: "", role: "" });
  const [employeeRole, setEmployeeRole] = useState("");
  const [highlights, setHighlights] = useState<string[] | null>(null);

  const renderPdf = useServerFn(renderDocumentPdf);
  const fetchBytes = useServerFn(fetchDocumentPdfBytes);

  const { data: media = [] } = useQuery({
    queryKey: ["expose-wizard-media", propertyId],
    enabled: open && !!propertyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("property_media")
        .select("id,file_url,file_type,is_cover,sort_order")
        .eq("property_id", propertyId)
        .order("sort_order", { ascending: true });
      return data ?? [];
    },
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["expose-wizard-documents", propertyId],
    enabled: open && !!propertyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("documents")
        .select("id,file_name,document_type,mime_type,created_at")
        .eq("related_type", "property")
        .eq("related_id", propertyId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: marketAnalysis } = useQuery({
    queryKey: ["expose-wizard-market", propertyId],
    enabled: open && !!propertyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("property_market_analyses")
        .select("id,sections,created_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const _tb = useTenantBranding();
  const company = _tb.company ? { name: _tb.company.name } : null;

  const { data: profile } = useQuery({
    queryKey: ["expose-wizard-profile"],
    enabled: open,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("id,full_name,email,phone,avatar_url").eq("id", u.user.id).maybeSingle();
      return data;
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["expose-wizard-employees"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,full_name,email,phone,avatar_url")
        .order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  const contact = useMemo(() => {
    if (!withContact) return { name: null, email: null, phone: null, role: null, photo: null };
    if (contactMode === "custom") {
      return {
        name: customContact.name || null,
        email: customContact.email || null,
        phone: customContact.phone || null,
        role: customContact.role || null,
        photo: null,
      };
    }
    const emp = (employees as any[]).find((e) => e.id === contactUserId) ?? (profile as any);
    return {
      name: emp?.full_name ?? null,
      email: emp?.email ?? null,
      phone: emp?.phone ?? null,
      role: employeeRole || null,
      photo: emp?.avatar_url ?? null,
    };
  }, [withContact, contactMode, customContact, employees, contactUserId, profile, employeeRole]);

  const imagePool = useMemo(() => {
    const fromMedia = (media as any[])
      .filter((m) => !m.file_type || String(m.file_type).startsWith("image") || /\.(jpe?g|png|webp|gif|avif)$/i.test(m.file_url))
      .map((m) => ({ url: mediaUrl(m.file_url), isCover: !!m.is_cover }));
    const legacy: string[] = Array.isArray(property?.images) ? property.images : [];
    const out: Array<{ url: string; isCover: boolean }> = [];
    const seen = new Set<string>();
    [...fromMedia, ...legacy.map((u) => ({ url: mediaUrl(u), isCover: false }))].forEach((i) => {
      if (i.url && !seen.has(i.url)) { seen.add(i.url); out.push(i); }
    });
    return out;
  }, [media, property]);

  // Reset / initialize when opening
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setGenerating(false);
    setAttachmentIds([]);
    setSectionOrder([...EXPOSE_SECTION_KEYS]);
    setTitle(property?.title ?? "");
    setDescription(property?.description ?? "");
    setHighlights(null);
  }, [open, property]);

  useEffect(() => {
    if (!open || imagePool.length === 0) return;
    setCoverUrl((c) => c ?? (imagePool.find((i) => i.isCover)?.url ?? imagePool[0].url));
    setGalleryUrls((g) => (g.length ? g : imagePool.slice(0, 8).map((i) => i.url)));
  }, [open, imagePool]);

  const facts = useMemo(() => {
    const p = property ?? {};
    const map: Record<FactKey, string> = {
      property_type: propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels] ?? "—",
      listing_type: listingTypeLabels[p.listing_type as keyof typeof listingTypeLabels] ?? "—",
      price: p.price ? formatCurrency(Number(p.price)) : "—",
      rent: p.rent ? `${formatCurrency(Number(p.rent))} / Mt.` : "—",
      area: formatArea(p.area ? Number(p.area) : null),
      living_area: formatArea(p.living_area ? Number(p.living_area) : null),
      plot_area: formatArea(p.plot_area ? Number(p.plot_area) : null),
      rooms: p.rooms ? String(p.rooms) : "—",
      bathrooms: p.bathrooms ? String(p.bathrooms) : "—",
      year_built: p.year_built ? String(p.year_built) : "—",
      renovated_at: p.renovated_at ? String(p.renovated_at) : "—",
      floor: p.floor != null ? String(p.floor) : "—",
      energy_class: p.energy_class ?? "—",
    };
    return FACT_DEFS
      .filter((f) => visibleFacts.has(f.key) && map[f.key] && map[f.key] !== "—")
      .map((f) => ({ label: f.label, value: map[f.key] }));
  }, [property, visibleFacts]);

  const allFeatures: string[] = useMemo(
    () => (Array.isArray(property?.features) ? (property!.features as string[]).filter(Boolean) : []),
    [property],
  );

  // Standard: die ersten acht Ausstattungen werden automatisch als Highlights vorgeschlagen.
  const selectedHighlights = useMemo(
    () => (highlights ?? allFeatures.slice(0, 8)).filter((f) => allFeatures.includes(f)),
    [highlights, allFeatures],
  );

  const toggleHighlight = (f: string) =>
    setHighlights((prev) => {
      const base = prev ?? allFeatures.slice(0, 8);
      if (base.includes(f)) return base.filter((x) => x !== f);
      if (base.length >= 8) return base;
      return [...base, f];
    });

  // Exposé-Check: Qualitätsprüfung vor dem Erstellen.
  const checks = useMemo(() => {
    const p: any = property ?? {};
    return [
      { key: "cover", label: "Titelbild", ok: !!coverUrl, hint: "Im Schritt «Galerie» ein Titelbild wählen.", step: 2 },
      { key: "title", label: "Titel", ok: !!(title || p.title), hint: "Im Schritt «Inhalte» einen Titel erfassen.", step: 1 },
      {
        key: "price",
        label: p.listing_type === "rent" ? "Mietzins" : "Kaufpreis",
        ok: p.listing_type === "rent" ? !!p.rent : !!p.price,
        hint: "Preis beim Objekt hinterlegen.",
        step: 1,
      },
      { key: "address", label: "Adresse", ok: !!(p.address || p.city), hint: "Adresse beim Objekt ergänzen.", step: 1 },
      {
        key: "facts",
        label: "Eckdaten",
        ok: facts.length >= 3,
        hint: "Mindestens drei Eckdaten auswählen.",
        step: 1,
      },
      {
        key: "description",
        label: "Beschreibung",
        ok: withDescription && (description ?? "").trim().length >= 80,
        hint: "Aussagekräftige Beschreibung (min. 80 Zeichen) erfassen.",
        step: 1,
      },
      { key: "gallery", label: "Bilderstrecke", ok: galleryUrls.filter((u) => u !== coverUrl).length >= 3, hint: "Mindestens drei Galeriebilder wählen.", step: 2 },
      { key: "contact", label: "Ansprechperson", ok: !withContact || !!contact.name, hint: "Ansprechperson auswählen.", step: 4 },
    ];
  }, [property, coverUrl, title, facts, withDescription, description, galleryUrls, withContact, contact]);

  const checkOk = checks.filter((c) => c.ok).length;
  const checkMissing = checks.filter((c) => !c.ok);

  const macro = (property as any)?.macro_location as any | null;
  const marketSections = (marketAnalysis as any)?.sections as any | null;

  const extraSections = useMemo(() => {
    const out: any[] = [];
    if (withMacro && macro) {
      out.push({
        title: "Makrolage",
        summary: [macro.summary, [macro.municipality, macro.region].filter(Boolean).join(" · ")]
          .filter(Boolean)
          .join(" — "),
        items: (Array.isArray(macro.categories) ? macro.categories : []).map((c: any) => ({
          heading: c.title,
          rating: typeof c.rating === "number" ? `${c.rating}/5` : null,
          text: c.description,
          bullets: Array.isArray(c.highlights) ? c.highlights : [],
        })),
      });
    }
    if (withMarket && marketSections) {
      const s = marketSections;
      const items: any[] = [];
      if (s.location)
        items.push({
          heading: "Lageanalyse",
          rating: s.location.score != null ? `${s.location.score}/10` : null,
          text: s.location.summary,
          bullets: Array.isArray(s.location.highlights) ? s.location.highlights : [],
        });
      if (s.trend) items.push({ heading: "Markttrend", text: s.trend.outlook });
      if (s.purchase_price)
        items.push({
          heading: "Kaufpreis",
          text: s.purchase_price.summary ?? null,
          bullets: [
            s.purchase_price.price_per_sqm_min && s.purchase_price.price_per_sqm_max
              ? `Preis pro m²: ${s.purchase_price.price_per_sqm_min}–${s.purchase_price.price_per_sqm_max} ${s.purchase_price.currency ?? "CHF"}`
              : null,
            s.purchase_price.estimated_value_min && s.purchase_price.estimated_value_max
              ? `Verkehrswert: ${s.purchase_price.estimated_value_min}–${s.purchase_price.estimated_value_max} ${s.purchase_price.currency ?? "CHF"}`
              : null,
          ].filter(Boolean) as string[],
        });
      if (s.rental_price)
        items.push({
          heading: "Mietpotenzial",
          text: s.rental_price.summary ?? null,
          bullets: [
            s.rental_price.rent_per_sqm_min && s.rental_price.rent_per_sqm_max
              ? `Miete pro m²: ${s.rental_price.rent_per_sqm_min}–${s.rental_price.rent_per_sqm_max} ${s.rental_price.currency ?? "CHF"}`
              : null,
          ].filter(Boolean) as string[],
        });
      if (s.risks?.length)
        items.push({ heading: "Risiken", bullets: (s.risks as any[]).map((r: any) => (typeof r === "string" ? r : r?.text ?? "")) });
      out.push({
        title: "Marktanalyse",
        summary: s.recommendation?.summary ?? null,
        items,
      });
    }
    return out;
  }, [withMacro, withMarket, macro, marketSections]);

  const buildHtml = (cover: string | null, gallery: string[], portraitSrc?: string | null, logoSrc?: string | null) => {
    const p = property ?? {};
    const cols = GALLERY_OPTIONS.find((o) => o.id === galleryLayout)?.cols ?? 2;
    return renderExposeHTML(
      {
        title: title || p.title,
        description: withDescription ? description : null,
        address: p.address,
        postal_code: p.postal_code,
        city: p.city,
        property_type_label: propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels] ?? null,
        listing_type_label: p.listing_type === "rent" ? "Miet" : "Verkaufs",
        price: visibleFacts.has("price") && p.price ? Number(p.price) : null,
        rent: visibleFacts.has("rent") && p.rent ? Number(p.rent) : null,
        features: withFeatures ? (p.features ?? []) : [],
        highlights: withFeatures ? selectedHighlights : [],
        facts,
        cover_url: cover,
        gallery_urls: gallery.filter((u) => u !== cover),
        attachment_doc_names: (documents as any[])
          .filter((d) => attachmentIds.includes(d.id))
          .map((d) => d.file_name as string),
        extra_sections: extraSections,
        section_order: sectionOrder,
        gallery_cols: cols,
        agency_name: company?.name ?? _tb.companyName,
        agency_logo_url: logoSrc ?? _tb.logoUrl ?? null,
        contact_name: contact.name,
        contact_role: contact.role,
        contact_photo_url: portraitSrc ?? contact.photo ?? null,
        contact_email: contact.email,
        contact_phone: contact.phone,
        generated_on: new Date().toLocaleDateString("de-CH"),
      } as any,
      {
        primary: template.primary,
        accent: template.accent,
        pageBg: template.pageBg,
        titleFont: template.titleFont,
        bodyFont: template.bodyFont,
        orientation: template.orientation,
        templateLabel: template.label,
        family: template.family,
      },
    );
  };

  const previewHtml = useMemo(
    () => (step === 2 || step === 3 || step === 5 || step === 6 ? buildHtml(coverUrl, galleryUrls) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, coverUrl, galleryUrls, galleryLayout, template, title, description, withDescription, withFeatures, selectedHighlights, withContact, contact, facts, company, profile, attachmentIds, documents, extraSections, sectionOrder],
  );

  function moveSection(key: ExposeSectionKey, dir: -1 | 1) {
    setSectionOrder((prev) => {
      const i = prev.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function dropSection(target: ExposeSectionKey) {
    setSectionOrder((prev) => {
      if (!dragKey || dragKey === target) return prev;
      const next = prev.filter((k) => k !== dragKey);
      next.splice(next.indexOf(target), 0, dragKey);
      return next;
    });
    setDragKey(null);
  }


  async function handleGenerate() {
    setGenerating(true);
    try {
      const gallerySources = galleryUrls.filter((u) => u !== coverUrl);
      const portraitSrc = contact.photo ? await urlToDataUri(contact.photo, 320, 0.85) : null;
      const logoSrc = _tb.logoUrl ? await urlToDataUri(_tb.logoUrl, 480, 0.9) : null;
      const embed = async (maxSide: number, quality: number) => {
        const cover = coverUrl ? await urlToDataUri(coverUrl, maxSide, quality) : null;
        const gallery = (
          await Promise.all(gallerySources.map((u) => urlToDataUri(u, maxSide, quality)))
        ).filter((u): u is string => !!u);
        return buildHtml(cover, gallery, portraitSrc, logoSrc);
      };

      let html = await embed(1600, 0.82);
      // Server-Limit: 5 MB HTML — bei vielen Bildern stärker komprimieren.
      if (html.length > 4_600_000) html = await embed(1100, 0.7);
      if (html.length > 4_600_000) html = await embed(800, 0.6);
      if (html.length > 4_900_000) {
        toast.error("Zu viele Bilder für ein PDF", { description: "Bitte weniger Bilder in der Galerie auswählen." });
        return;
      }

      const safeTitle = title || property?.title || "Expose";
      const fileName = `Expose-${safeTitle.replace(/[^\w\s-]/g, "").trim() || "Objekt"}-${template.label}.pdf`;

      const res = await renderPdf({
        data: {
          html, title: safeTitle, fileName,
          documentType: "expose",
          propertyTitle: property?.title,
          companyName: company?.name ?? null,
        },
      });
      if (!res.ok || !res.fileUrl) {
        toast.error("PDF konnte nicht erstellt werden", { description: "message" in res ? (res as any).message : undefined });
        return;
      }

      let url = res.fileUrl;
      if (res.path) {
        try {
          const bytes = await fetchBytes({ data: { path: res.path } });
          if (bytes.ok && bytes.base64) {
            const bin = atob(bytes.base64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
          }
        } catch { /* fall back to fileUrl */ }
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Persist a record so it shows up under "Bisher erstellte Exposés"
      try {
        const { data: u } = await supabase.auth.getUser();
        await supabase.from("generated_documents").insert({
          related_type: "property",
          related_id: propertyId,
          html_content: buildHtml(coverUrl, galleryUrls),
          created_by: u.user?.id ?? null,
          variables: {
            kind: "expose",
            title: safeTitle,
            template: template.id,
            gallery_layout: galleryLayout,
            visible_facts: Array.from(visibleFacts),
          } as any,
        } as any);
      } catch { /* record is optional */ }

      toast.success("Exposé wurde erstellt und heruntergeladen");
      onOpenChange(false);
    } catch (err) {
      toast.error("PDF konnte nicht erstellt werden", { description: (err as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  const toggleFact = (k: FactKey) =>
    setVisibleFacts((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!generating) onOpenChange(o); }}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />Exposé erstellen
          </DialogTitle>
          <DialogDescription>
            Schritt für Schritt: Vorlage wählen, Inhalte auswählen, Galerie bestimmen, Vorschau prüfen und als PDF herunterladen.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <ol className="flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === step;
            const done = i < step;
            return (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    active && "border-primary bg-primary text-primary-foreground",
                    !active && done && "border-primary/40 bg-primary/10 text-primary",
                    !active && !done && "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>

        <ScrollArea className="-mx-2 flex-1 px-2">
          <div className="min-h-[320px] py-3">
            {step === 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplate(t)}
                    className={cn(
                      "rounded-xl border-2 p-3 text-left transition",
                      template.id === t.id ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="mb-2 flex h-14 overflow-hidden rounded-md" style={{ background: t.pageBg }}>
                      <div className="w-1/3" style={{ background: t.primary }} />
                      <div className="w-2 self-stretch" style={{ background: t.accent }} />
                    </div>
                    <p className="text-sm font-semibold">{t.label}</p>
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">{t.description}</p>
                    <Badge variant="outline" className="mt-2 text-[10px]">
                      {t.orientation === "landscape" ? "Querformat" : "Hochformat"}
                    </Badge>
                  </button>
                ))}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Titel</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Beschreibung</Label>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={withDescription} onCheckedChange={() => setWithDescription((v) => !v)} />
                      Im Exposé anzeigen
                    </label>
                  </div>
                  <Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!withDescription} />
                </div>
                <div>
                  <Label className="mb-2 block">Eckdaten auswählen</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {FACT_DEFS.map((f) => (
                      <label key={f.key} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                        <Checkbox checked={visibleFacts.has(f.key)} onCheckedChange={() => toggleFact(f.key)} />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={withFeatures} onCheckedChange={() => setWithFeatures((v) => !v)} />
                    Ausstattung anzeigen
                  </label>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                {imagePool.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Bilder vorhanden. Lade zuerst Medien zum Objekt hoch.</p>
                ) : (
                  <>
                    <div>
                      <Label className="mb-2 block">Galerie-Layout</Label>
                      <div className="flex flex-wrap gap-2">
                        {GALLERY_OPTIONS.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => setGalleryLayout(o.id)}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-left text-xs transition",
                              galleryLayout === o.id ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/40",
                            )}
                          >
                            <span className="block font-semibold">{o.label}</span>
                            <span className="text-muted-foreground">{o.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label>Bilder ({galleryUrls.length} ausgewählt)</Label>
                        <span className="text-xs text-muted-foreground">Klick = Auswahl · Stern = Coverbild</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                        {imagePool.map((img) => {
                          const selected = galleryUrls.includes(img.url);
                          const isCover = coverUrl === img.url;
                          return (
                            <div
                              key={img.url}
                              className={cn(
                                "relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl border-2 transition",
                                selected ? "border-primary ring-2 ring-primary/25" : "border-transparent hover:border-primary/40",
                              )}
                              onClick={() =>
                                setGalleryUrls((prev) =>
                                  prev.includes(img.url) ? prev.filter((u) => u !== img.url) : [...prev, img.url],
                                )
                              }
                            >
                              <img src={img.url} alt="" className={cn("h-full w-full object-cover", !selected && "opacity-60")} />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCoverUrl(img.url); }}
                                className={cn(
                                  "absolute left-1.5 top-1.5 rounded-full p-1 transition",
                                  isCover ? "bg-primary text-primary-foreground" : "bg-background/80 text-muted-foreground hover:text-primary",
                                )}
                                title="Als Coverbild verwenden"
                              >
                                <Star className={cn("h-3.5 w-3.5", isCover && "fill-current")} />
                              </button>
                              {selected && (
                                <div className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground">
                                  <Check className="h-3 w-3" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
                </div>

                {/* Live-Vorschau */}
                <div className="space-y-2 lg:sticky lg:top-0 lg:self-start">
                  <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" /> Live-Vorschau
                  </Label>
                  <ScaledExposePreview html={previewHtml} title="Galerie-Vorschau" />
                  <p className="text-[11px] text-muted-foreground">
                    {galleryUrls.filter((u) => u !== coverUrl).length} Galeriebilder · Vorlage {template.label}
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3">
                  <div>
                    <Label>Zusätzliche Abschnitte</Label>
                    <p className="text-xs text-muted-foreground">
                      Analysen aus dem Objekt als eigene Seiten ins Exposé übernehmen.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 text-sm transition",
                        macro ? "cursor-pointer" : "opacity-60",
                        withMacro ? "border-primary bg-primary/5" : "hover:border-primary/40",
                      )}
                    >
                      <Checkbox
                        checked={withMacro}
                        disabled={!macro}
                        onCheckedChange={() => setWithMacro((v) => !v)}
                      />
                      <span className="min-w-0 flex-1">
                        Makrolage
                        <span className="block text-xs text-muted-foreground">
                          {macro ? "KI-Analyse zu Lage, Infrastruktur und Umfeld" : "Noch keine Makrolage generiert"}
                        </span>
                      </span>
                    </label>
                    <label
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 text-sm transition",
                        marketSections ? "cursor-pointer" : "opacity-60",
                        withMarket ? "border-primary bg-primary/5" : "hover:border-primary/40",
                      )}
                    >
                      <Checkbox
                        checked={withMarket}
                        disabled={!marketSections}
                        onCheckedChange={() => setWithMarket((v) => !v)}
                      />
                      <span className="min-w-0 flex-1">
                        Marktanalyse
                        <span className="block text-xs text-muted-foreground">
                          {marketSections ? "Neuste KI-Marktanalyse dieses Objekts" : "Noch keine Marktanalyse vorhanden"}
                        </span>
                      </span>
                    </label>
                  </div>

                  <div>
                    <Label>Dokumente anhängen</Label>
                    <p className="text-xs text-muted-foreground">
                      Wähle die Dokumente dieses Objekts, die als Anhang im Exposé aufgeführt werden.
                    </p>
                  </div>

                  {(documents as any[]).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Zu diesem Objekt sind keine Dokumente hinterlegt.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(documents as any[]).map((d) => {
                        const checked = attachmentIds.includes(d.id);
                        return (
                          <label
                            key={d.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition",
                              checked ? "border-primary bg-primary/5" : "hover:border-primary/40",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() =>
                                setAttachmentIds((prev) =>
                                  prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                                )
                              }
                            />
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{d.file_name}</span>
                            {d.document_type && (
                              <Badge variant="outline" className="text-[10px]">{d.document_type}</Badge>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2 lg:sticky lg:top-0 lg:self-start">
                  <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" /> Live-Vorschau
                  </Label>
                  <ScaledExposePreview html={previewHtml} title="Anhänge-Vorschau" />
                  <p className="text-[11px] text-muted-foreground">{attachmentIds.length} Anhänge ausgewählt</p>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={withContact} onCheckedChange={() => setWithContact((v) => !v)} />
                  Ansprechperson im Exposé anzeigen
                </label>

                <div className={cn("space-y-4", !withContact && "pointer-events-none opacity-50")}>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setContactMode("employee")}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        contactMode === "employee" ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40",
                      )}
                    >
                      Mitarbeitende
                    </button>
                    <button
                      type="button"
                      onClick={() => setContactMode("custom")}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        contactMode === "custom" ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40",
                      )}
                    >
                      Zusätzliche Person
                    </button>
                  </div>

                  {contactMode === "employee" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(employees as any[]).length === 0 && (
                        <p className="text-sm text-muted-foreground">Keine Mitarbeitenden gefunden.</p>
                      )}
                      {(employees as any[]).map((e) => {
                        const active = (contactUserId ?? (profile as any)?.id) === e.id;
                        return (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => setContactUserId(e.id)}
                            className={cn(
                              "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                              active ? "border-primary bg-primary/5 ring-1 ring-primary/25" : "hover:border-primary/40",
                            )}
                          >
                            <Avatar className="h-9 w-9">
                              {e.avatar_url ? <AvatarImage src={e.avatar_url} alt={e.full_name ?? ""} /> : null}
                              <AvatarFallback className="bg-primary/10 text-xs text-primary">
                                {(e.full_name ?? e.email ?? "?").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{e.full_name ?? e.email}</p>
                              <p className="truncate text-xs text-muted-foreground">{e.email}{e.phone ? ` · ${e.phone}` : ""}</p>
                            </div>
                            {active && <Check className="ml-auto h-4 w-4 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input value={customContact.name} onChange={(e) => setCustomContact((c) => ({ ...c, name: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Funktion (optional)</Label>
                        <Input value={customContact.role} onChange={(e) => setCustomContact((c) => ({ ...c, role: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>E-Mail</Label>
                        <Input type="email" value={customContact.email} onChange={(e) => setCustomContact((c) => ({ ...c, email: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Telefon</Label>
                        <Input value={customContact.phone} onChange={(e) => setCustomContact((c) => ({ ...c, phone: e.target.value }))} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Vorschau · Vorlage {template.label} · {galleryUrls.filter((u) => u !== coverUrl).length} Galeriebilder
                  {attachmentIds.length ? ` · ${attachmentIds.length} Anhänge` : ""}
                  {contact.name ? ` · Ansprechperson ${contact.name}` : ""}
                </p>
                <iframe title="Exposé-Vorschau" srcDoc={previewHtml} className="h-[60vh] w-full rounded-lg border bg-muted" />
                <p className="text-[11px] text-muted-foreground">
                  Jede Seite wird als einzelnes Blatt dargestellt; die gestrichelte Linie markiert den Seitenumbruch. Die Reihenfolge der Abschnitte passt du im nächsten Schritt an.
                </p>

              </div>
            )}

            {step === 6 && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label>Reihenfolge der Abschnitte</Label>
                      <p className="text-xs text-muted-foreground">
                        Ziehe die Abschnitte in die gewünschte Reihenfolge – oder nutze die Pfeile.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSectionOrder([...EXPOSE_SECTION_KEYS])}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Standard
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {sectionOrder.map((key, i) => {
                      const empty =
                        (key === "extras" && extraSections.length === 0) ||
                        (key === "attachments" && attachmentIds.length === 0) ||
                        (key === "gallery" && galleryUrls.filter((u) => u !== coverUrl).length === 0);
                      return (
                        <div
                          key={key}
                          draggable
                          onDragStart={() => setDragKey(key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => dropSection(key)}
                          onDragEnd={() => setDragKey(null)}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border bg-card p-3 text-sm transition",
                            dragKey === key ? "border-primary opacity-60" : "hover:border-primary/40",
                            empty && "opacity-60",
                          )}
                        >
                          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                          <Badge variant="secondary" className="shrink-0">{i + 1}</Badge>
                          <span className="min-w-0 flex-1">
                            {EXPOSE_SECTION_LABELS[key]}
                            {empty && (
                              <span className="block text-xs text-muted-foreground">Keine Inhalte – wird nicht gedruckt</span>
                            )}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => moveSection(key, -1)}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === sectionOrder.length - 1} onClick={() => moveSection(key, 1)}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Vorschau</Label>
                  <ScaledExposePreview html={previewHtml} title="Reihenfolge-Vorschau" />
                </div>
              </div>
            )}

            {step === 7 && (

              <div className="space-y-4 py-6 text-center">
                <FileDown className="mx-auto h-10 w-10 text-primary" />
                <div>
                  <p className="font-semibold">Bereit zum Generieren</p>
                  <p className="text-sm text-muted-foreground">
                    {title || property?.title} · Vorlage {template.label} · {facts.length} Eckdaten ·{" "}
                    {galleryUrls.filter((u) => u !== coverUrl).length} Galeriebilder
                  </p>
                </div>
                <Button size="lg" onClick={handleGenerate} disabled={generating}>
                  {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                  {generating ? "PDF wird erstellt…" : "Exposé generieren & herunterladen"}
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t pt-3">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || generating}>
            <ChevronLeft className="mr-1 h-4 w-4" />Zurück
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Weiter<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>Schliessen</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
