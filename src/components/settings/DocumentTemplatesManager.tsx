import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, FileCode2, Trash2, Eye, Sparkles, Code2, Star, Lock, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { RichTextEditor } from "@/components/editor/RichTextEditor";
import {
  AVAILABLE_VARIABLES,
  defaultTemplateForType,
  renderTemplate,
  wrapHtmlDocument,
} from "@/lib/document-templates";
import { setDefaultTemplate } from "@/lib/templates.functions";

const TYPE_LABELS: Record<string, string> = {
  mandate: "Mandat (exklusiv)",
  mandate_partial: "Mandat (teilexklusiv)",
  reservation: "Reservation",
  reservation_receipt: "Reservations-Quittung",
  nda: "NDA / Vertraulichkeit",
  contract: "Vertrag",
  expose: "Exposé",
  other: "Sonstiges",
};

type FormState = {
  id?: string;
  name: string;
  type: string;
  content: string;
  is_active: boolean;
};

const EMPTY: FormState = {
  name: "",
  type: "mandate",
  content: defaultTemplateForType("mandate"),
  is_active: true,
};

export function DocumentTemplatesManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY);

  // Kein Seeding beim Öffnen: Lesen dieser Seite erzeugt nie Vorlagen.
  // Standardvorlagen kommen künftig nur über das Tenant-Provisioning (siehe template-catalog.ts).

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["all-document-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_templates")
        .select("*")
        .order("type")
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const setDefault = useMutation({
    mutationFn: async (templateId: string) => {
      await setDefaultTemplate({ data: { templateId } });
    },
    onSuccess: () => {
      toast.success("Standardvorlage aktualisiert");
      qc.invalidateQueries({ queryKey: ["all-document-templates"] });
      qc.invalidateQueries({ queryKey: ["templates-by-kind"] });
      qc.invalidateQueries({ queryKey: ["document-templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Bitte Name angeben");
      if (form.id) {
        const { error } = await supabase
          .from("document_templates")
          .update({
            name: form.name.trim(),
            type: form.type as "other",
            content: form.content,
            is_active: form.is_active,
          })
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("document_templates").insert({
          name: form.name.trim(),
          type: form.type as "other",
          content: form.content,
          is_active: form.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Vorlage gespeichert");
      qc.invalidateQueries({ queryKey: ["all-document-templates"] });
      qc.invalidateQueries({ queryKey: ["document-templates"] });
      setForm(EMPTY);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("document_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Vorlage gelöscht");
      qc.invalidateQueries({ queryKey: ["all-document-templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicate = useMutation({
    mutationFn: async (t: { name: string; type: string; content: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from("document_templates")
        .insert({
          name: `${t.name} (Kopie)`,
          type: t.type as "other",
          content: t.content,
          is_active: t.is_active,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Vorlage kopiert");
      qc.invalidateQueries({ queryKey: ["all-document-templates"] });
      if (data) {
        setForm({
          id: data.id,
          name: data.name,
          type: data.type,
          content: data.content,
          is_active: data.is_active,
        });
        setOpen(true);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startNew = () => {
    setForm(EMPTY);
    setOpen(true);
  };
  const startEdit = (t: { id: string; name: string; type: string; content: string; is_active: boolean }) => {
    setForm({ id: t.id, name: t.name, type: t.type, content: t.content, is_active: t.is_active });
    setOpen(true);
  };

  const previewTemplate = (t: { name: string; content: string }) => {
    const sampleCtx = {
      client: {
        full_name: "Anna Müller",
        address: "Bahnhofstrasse 12",
        postal_code: "8001",
        city: "Zürich",
        email: "anna@example.ch",
        phone: "+41 79 123 45 67",
      },
      property: {
        title: "Loft mit Seesicht",
        address: "Seestrasse 88",
        postal_code: "8800",
        city: "Thalwil",
        price: 1850000,
        rent: null,
        rooms: 4.5,
        living_area: 142,
      },
      mandate: { commission_model: "Prozent", commission_value: 3, valid_from: "2026-05-01", valid_until: "2026-11-01" },
      reservation: { reservation_fee: 25000, valid_until: "2026-06-15" },
      company: { name: "Muster Immobilien AG" },
    };
    setPreviewHtml(wrapHtmlDocument(t.name || "Vorschau", renderTemplate(t.content, sampleCtx)));
    setPreviewOpen(true);
  };

  const handleTypeChange = (v: string) => {
    setForm((prev) => {
      const allDefaults = ["mandate", "mandate_partial", "reservation", "reservation_receipt", "nda"]
        .map((t) => defaultTemplateForType(t));
      const wasDefault = !prev.content || allDefaults.includes(prev.content);
      const next = defaultTemplateForType(v);
      return { ...prev, type: v, content: wasDefault && next ? next : prev.content };
    });
  };

  const insertVariable = (key: string) => {
    const label = (AVAILABLE_VARIABLES.find((v) => v.key === key)?.label ?? key).replace(/^★\s*/, "");
    const chip = `<span data-variable="${key}" data-label="${label.replace(/"/g, "&quot;")}">{{${key}}}</span>`;
    setForm((prev) => ({ ...prev, content: `${prev.content}${chip}` }));
  };

  const showPreview = () => {
    const sampleCtx = {
      client: {
        full_name: "Anna Müller",
        address: "Bahnhofstrasse 12",
        postal_code: "8001",
        city: "Zürich",
        email: "anna@example.ch",
        phone: "+41 79 123 45 67",
      },
      property: {
        title: "Loft mit Seesicht",
        address: "Seestrasse 88",
        postal_code: "8800",
        city: "Thalwil",
        price: 1850000,
        rent: null,
        rooms: 4.5,
        living_area: 142,
      },
      mandate: { commission_model: "Prozent", commission_value: 3, valid_from: "2026-05-01", valid_until: "2026-11-01" },
      reservation: { reservation_fee: 25000, valid_until: "2026-06-15" },
      company: { name: "Muster Immobilien AG" },
    };
    setPreviewHtml(wrapHtmlDocument(form.name || "Vorschau", renderTemplate(form.content, sampleCtx)));
    setPreviewOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Dokumentvorlagen</h2>
          <p className="text-sm text-muted-foreground">
            Vorlagen für Mandate, Reservationen und weitere Verträge mit dynamischen Variablen.
          </p>
        </div>
        <Button onClick={startNew}>
          <Plus className="mr-1 h-4 w-4" />
          Neue Vorlage
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">Wird geladen…</div>
      ) : templates.length === 0 ? (
        <EmptyState
          title="Keine Vorlagen"
          description="Lege eine erste Vorlage an, um Mandate und Reservationen zu generieren."
          action={
            <Button onClick={startNew}>
              <Plus className="mr-1 h-4 w-4" />
              Neue Vorlage
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const isSystem = (t as { is_system?: boolean }).is_system === true;
            const isDefault = (t as { is_default?: boolean }).is_default === true;
            const sameTypeActive = templates.filter((x) => x.type === t.type && x.is_active);
            const currentDefaultId =
              sameTypeActive.find((x) => (x as { is_default?: boolean }).is_default)?.id ?? "";
            return (
              <div key={t.id} className={`rounded-xl border bg-card p-4 shadow-soft ${isDefault ? "ring-1 ring-primary" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">{t.name}</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {isDefault && (
                      <Badge className="gap-1"><Star className="h-3 w-3" />Standard</Badge>
                    )}
                    {isSystem && (
                      <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />System</Badge>
                    )}
                    <Badge variant={t.is_active ? "default" : "secondary"}>{t.is_active ? "Aktiv" : "Inaktiv"}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{TYPE_LABELS[t.type] ?? t.type}</p>
                <div className="mt-3 line-clamp-3 text-xs text-muted-foreground">
                  {t.content.replace(/<[^>]+>/g, " ").slice(0, 200)}…
                </div>

                <div className="mt-3 space-y-1">
                  <Label className="text-xs text-muted-foreground">Standardvorlage für diesen Typ</Label>
                  <Select
                    value={currentDefaultId}
                    onValueChange={(id) => setDefault.mutate(id)}
                    disabled={setDefault.isPending || sameTypeActive.length === 0}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="– keine –" />
                    </SelectTrigger>
                    <SelectContent>
                      {sameTypeActive.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.name}
                          {(x as { is_system?: boolean }).is_system ? " (System)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => previewTemplate(t)}>
                    <Eye className="mr-1 h-4 w-4" />
                    Ansehen
                  </Button>
                  {!isSystem && (
                    <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                      Bearbeiten
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => duplicate.mutate(t)}
                    disabled={duplicate.isPending}
                  >
                    <Copy className="mr-1 h-4 w-4" />
                    Kopieren
                  </Button>
                  {!isSystem && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(t.id)}
                      className="ml-auto text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Vorlage bearbeiten" : "Neue Vorlage"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label>Typ</Label>
                  <Select value={form.type} onValueChange={handleTypeChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">Inhalt</Label>
                <Tabs defaultValue="visual">
                  <TabsList>
                    <TabsTrigger value="visual">
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Visuell
                    </TabsTrigger>
                    <TabsTrigger value="html">
                      <Code2 className="mr-1.5 h-3.5 w-3.5" />
                      HTML
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="visual" className="mt-2">
                    <RichTextEditor
                      value={form.content}
                      onChange={(html) => setForm((prev) => ({ ...prev, content: html }))}
                      variables={AVAILABLE_VARIABLES.map((v) => ({ key: v.key, label: v.label.replace(/^★\s*/, "") }))}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Wähle rechts eine Variable, um sie als Chip einzufügen. Beim Generieren wird sie durch echte Daten ersetzt.
                    </p>
                  </TabsContent>
                  <TabsContent value="html" className="mt-2">
                    <Textarea
                      rows={18}
                      value={form.content}
                      onChange={(e) => setForm({ ...form, content: e.target.value })}
                      className="font-mono text-xs"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Für Power-User: HTML direkt bearbeiten. Variablen als <code>{"{{client_name}}"}</code> schreiben.
                    </p>
                  </TabsContent>
                </Tabs>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label className="m-0">Aktiv</Label>
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Variablen einfügen</p>
              <div className="max-h-[400px] space-y-1 overflow-y-auto">
                {AVAILABLE_VARIABLES.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVariable(v.key)}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <div className="font-medium">{v.label}</div>
                    <code className="text-[10px] text-muted-foreground">{`{{${v.key}}}`}</code>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={showPreview}>
              <Eye className="mr-1 h-4 w-4" />
              Vorschau
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Vorschau (mit Beispieldaten)</DialogTitle>
          </DialogHeader>
          <iframe title="Vorschau" srcDoc={previewHtml} className="h-[70vh] w-full rounded-md border bg-white" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
