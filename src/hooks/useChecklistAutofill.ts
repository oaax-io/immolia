import { logActivity } from "@/components/ActivityTab";
// Automatischer Abgleich der Bank-Checkliste mit vorhandenen Daten und Dokumenten.
// Setzt erkannte Punkte selbstständig, respektiert aber jede manuelle Entscheidung.

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CHECKLIST_TEMPLATE, SECTION_LABELS, checklistStats,
  type ChecklistRow, type ChecklistSection,
} from "@/lib/financing-checklist";
import { detectChecklist, requiredKeys, type AutoMap } from "@/lib/financing-checklist-auto";

export type MissingItem = {
  id?: string;
  key: string;
  label: string;
  section: ChecklistSection;
  sectionLabel: string;
  required: boolean;
  reason: string;
};

export function useChecklistAutofill(dossierId: string, options?: { sync?: boolean }) {
  const qc = useQueryClient();
  const sync = options?.sync !== false;
  const lastSignature = useRef<string>("");

  const dossierQuery = useQuery({
    queryKey: ["financing_dossier_auto", dossierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financing_dossiers")
        .select("*")
        .eq("id", dossierId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const dossier = dossierQuery.data;

  const clientIds = useMemo(() => {
    if (!dossier) return [] as string[];
    const extras = Array.isArray(dossier.additional_co_applicants)
      ? dossier.additional_co_applicants.map((a: any) => a?.client_id)
      : [];
    return Array.from(new Set([dossier.client_id, dossier.co_applicant_client_id, ...extras].filter(Boolean))) as string[];
  }, [dossier]);
  const clientKey = clientIds.join(",");

  const clientsQuery = useQuery({
    queryKey: ["financing_auto_clients", clientKey],
    enabled: clientIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").in("id", clientIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const disclosuresQuery = useQuery({
    queryKey: ["financing_auto_disclosures", clientKey],
    enabled: clientIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_self_disclosures")
        .select("*")
        .in("client_id", clientIds)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const docsQuery = useQuery({
    queryKey: ["financing_auto_docs", dossierId, clientKey, dossier?.property_id],
    enabled: !!dossier,
    queryFn: async () => {
      const orParts: string[] = [`and(related_type.eq.financing,related_id.eq.${dossierId})`];
      if (clientIds.length > 0) orParts.push(`and(related_type.eq.client,related_id.in.(${clientIds.join(",")}))`);
      if (dossier?.property_id) orParts.push(`and(related_type.eq.property,related_id.eq.${dossier.property_id})`);
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, document_type, related_type")
        .or(orParts.join(","))
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rowsQuery = useQuery({
    queryKey: ["financing_checklist", dossierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financing_checklist_items")
        .select("*")
        .eq("dossier_id", dossierId)
        .order("section")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any as ChecklistRow[];
    },
  });

  const rows = rowsQuery.data ?? [];

  const auto: AutoMap = useMemo(() => {
    if (!dossier) return {};
    const map = detectChecklist({
      dossier,
      clients: clientsQuery.data ?? [],
      disclosures: disclosuresQuery.data ?? [],
      documents: (docsQuery.data ?? []) as any,
    });
    // Sammelpunkt: gilt erst, wenn alle anderen Pflichtpunkte erfüllt sind.
    const req = requiredKeys(CHECKLIST_TEMPLATE as any);
    const others = Array.from(req).filter((k) => k !== "submission_quality:all_docs_complete");
    const open = others.filter((k) => map[k]?.status !== "present");
    map["submission_quality:all_docs_complete"] = open.length === 0
      ? { status: "present", reason: "Alle Pflichtpunkte erfüllt" }
      : { status: "missing", reason: `${open.length} Pflichtpunkt(e) noch offen` };
    return map;
  }, [dossier, clientsQuery.data, disclosuresQuery.data, docsQuery.data]);

  // Erkannte Punkte in die Checkliste schreiben (nie manuell gesetzte überschreiben).
  useEffect(() => {
    if (!sync) return;
    if (!dossier || rows.length === 0 || Object.keys(auto).length === 0) return;

    const updates = rows
      .filter((r: any) => !r.manual_override && r.status !== "not_relevant")
      .map((r: any) => {
        const hit = auto[`${r.section}:${r.item_key}`];
        if (!hit) return null;
        const nextPresent = hit.status === "present";
        if (r.status === hit.status && r.is_present === nextPresent && r.auto_reason === hit.reason) return null;
        return {
          id: r.id as string,
          patch: {
            status: hit.status,
            is_present: nextPresent,
            auto_detected: true,
            auto_reason: hit.reason,
            ...(hit.documentId ? { document_id: hit.documentId } : {}),
          },
        };
      })
      .filter(Boolean) as { id: string; patch: Record<string, any> }[];

    if (updates.length === 0) return;
    const signature = updates.map((u) => `${u.id}:${u.patch.status}:${u.patch.auto_reason}`).join("|");
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;

    (async () => {
      for (const u of updates) {
        await supabase.from("financing_checklist_items").update(u.patch as any).eq("id", u.id);
      }
      qc.invalidateQueries({ queryKey: ["financing_checklist", dossierId] });
    })();
  }, [sync, auto, rows, dossier, dossierId, qc]);

  const required = useMemo(() => requiredKeys(CHECKLIST_TEMPLATE as any), []);

  const missing: MissingItem[] = useMemo(() => {
    const list: MissingItem[] = [];
    rows.forEach((r: any) => {
      if (r.status === "not_relevant") return;
      if (r.is_present || r.status === "present") return;
      const key = `${r.section}:${r.item_key}`;
      list.push({
        id: r.id,
        key,
        label: r.label,
        section: r.section,
        sectionLabel: SECTION_LABELS[r.section as ChecklistSection],
        required: required.has(key),
        reason: r.auto_reason ?? auto[key]?.reason ?? "Noch nicht erfasst",
      });
    });
    return list.sort((a, b) => Number(b.required) - Number(a.required));
  }, [rows, auto, required]);

  const stats = useMemo(() => checklistStats(rows), [rows]);
  const missingRequired = missing.filter((m) => m.required);
  const isReady = rows.length > 0 && missingRequired.length === 0;

  // Dossier-Status automatisch mitführen.
  useEffect(() => {
    if (!sync || !dossier || rows.length === 0) return;
    const status = dossier.dossier_status as string;
    if (["submitted_to_bank", "approved", "rejected", "cancelled"].includes(status)) return;

    const forced = !!(dossier as any).bank_ready_forced_at;
    const target = isReady
      ? "ready_for_bank"
      : status === "ready_for_bank" && !forced ? "documents_missing" : null;
    if (!target || target === status) return;

    (async () => {
      const { error } = await supabase
        .from("financing_dossiers")
        .update({ dossier_status: target } as any)
        .eq("id", dossierId);
      if (error) return;
      await logActivity({
        relatedType: "financing_dossier",
        relatedId: dossierId,
        action: target === "ready_for_bank"
          ? "Status automatisch auf «Bereit für Bank» gesetzt (alle Pflichtpunkte erfüllt)"
          : "Status automatisch auf «Unterlagen fehlen» gesetzt (Pflichtpunkte offen)",
        metadata: { kind: "dossier_status_auto", from: status, to: target },
      });
      qc.invalidateQueries({ queryKey: ["activity_logs", "financing_dossier", dossierId] });
      qc.invalidateQueries({ queryKey: ["financing_dossier", dossierId] });
      qc.invalidateQueries({ queryKey: ["financing_dossier_auto", dossierId] });
      qc.invalidateQueries({ queryKey: ["financing_dossier_bank", dossierId] });
      qc.invalidateQueries({ queryKey: ["financing_dossiers"] });
    })();
  }, [sync, isReady, dossier, rows.length, dossierId, qc]);

  /** Manuell trotz fehlender Pflichtpunkte auf «Bereit für Bank» setzen (mit Protokoll). */
  const forceReady = async () => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("financing_dossiers")
      .update({
        dossier_status: "ready_for_bank",
        bank_ready_forced_at: new Date().toISOString(),
        bank_ready_forced_by: u?.user?.id ?? null,
      } as any)
      .eq("id", dossierId);
    if (error) throw error;
    await logActivity({
      relatedType: "financing_dossier",
      relatedId: dossierId,
      action: `Trotz fehlender Unterlagen manuell auf «Bereit für Bank» gesetzt – bestätigt fehlend: ${missingRequired.map((m) => m.label).join(", ")}`,
      metadata: { kind: "bank_ready_forced", missing: missingRequired.map((m) => m.key) },
    });
    for (const k of [["activity_logs", "financing_dossier", dossierId], ["financing_dossier", dossierId], ["financing_dossier_auto", dossierId], ["financing_dossier_bank", dossierId], ["financing_dossiers"]])
      qc.invalidateQueries({ queryKey: k });
  };

  return {
    forceReady,
    isForced: !!(dossier as any)?.bank_ready_forced_at && (dossier as any)?.dossier_status === "ready_for_bank",
    rows,
    auto,
    stats,
    missing,
    missingRequired,
    isReady,
    isLoading: rowsQuery.isLoading || dossierQuery.isLoading,
    dossier,
  };
}
