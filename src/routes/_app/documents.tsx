import { useModuleAccess, moduleForPath } from "@/hooks/useModuleAccess";
import { tenantStoragePath } from "@/lib/tenant-storage";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { FileText, Download, Search, Trash2, Upload, ExternalLink, HardDrive, LayoutTemplate, ListChecks, FileSignature, FileCheck2, FileLock2, FileBadge } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { formatDate } from "@/lib/format";
import { GeneratedDocumentsTable } from "@/components/documents/GeneratedDocumentsTable";
import { DocumentTemplatesManager } from "@/components/settings/DocumentTemplatesManager";
import { DocumentFolderView } from "@/components/documents/DocumentFolderView";
import { useTranslation } from "react-i18next";
import { deleteToTrash } from "@/lib/trash";

export const Route = createFileRoute("/_app/documents")({ component: DocumentsPage });

const TYPE_KEYS = [
  "contract","expose","id","invoice","energy_certificate",
  "floor_plan","bank_statement","tax_document","other",
] as const;

const RELATED_KEYS = ["client","property","lead","mandate","reservation","financing_profile"] as const;

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const MAX_STORAGE = 20 * 1024 * 1024 * 1024; // 20 GB

const DOC_CENTER_TILES = [
  { to: "/checklists", labelKey: "nav.checklists", icon: ListChecks, desc: "Abläufe & Aufgabenlisten" },
  { to: "/mandates", labelKey: "nav.mandates", icon: FileSignature, desc: "Vermarktungsaufträge" },
  { to: "/reservations", labelKey: "nav.reservations", icon: FileCheck2, desc: "Reservationsverträge" },
  { to: "/ndas", labelKey: "nav.ndas", icon: FileLock2, desc: "Vertraulichkeitserklärungen" },
  { to: "/exposes", labelKey: "nav.exposes", icon: FileBadge, desc: "Objekt-Exposés" },
] as const;

function DocumentsPage() {
  const { t } = useTranslation();
  const typeLabel = (k: string) => t(`documents.types.${k}`);
  const relatedLabel = (k: string) => t(`documents.related.${k}`);
  const qc = useQueryClient();
  const { user } = useAuth();
  const modAccess = useModuleAccess();
  const [open, setOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [relatedFilter, setRelatedFilter] = useState<string>("all");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    document_type: "other",
    related_type: "client",
    related_id: "",
    notes: "",
  });

  const { data: profile } = useQuery({
    queryKey: ["my-profile-role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_role").eq("id", user!.id).maybeSingle();
      return data;
    },
  });
  const canDelete = profile?.user_role === "owner" || profile?.user_role === "admin";

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("documents").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      const docs = data ?? [];
      const uploaderIds = Array.from(new Set(docs.map((d) => d.uploaded_by).filter(Boolean) as string[]));
      let uploaders: Record<string, string> = {};
      if (uploaderIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", uploaderIds);
        uploaders = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name ?? ""]));
      }
      return docs.map((d) => ({ ...d, uploader: d.uploaded_by ? { full_name: uploaders[d.uploaded_by] } : null }));
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["docs-clients"],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").order("full_name")).data ?? [],
  });
  const { data: properties = [] } = useQuery({
    queryKey: ["docs-properties"],
    queryFn: async () => (await supabase.from("properties").select("id, title").order("title")).data ?? [],
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["docs-leads"],
    queryFn: async () => (await supabase.from("leads").select("id, full_name").order("full_name")).data ?? [],
  });

  const relatedOptions = useMemo(() => {
    if (form.related_type === "client") return clients.map((c) => ({ id: c.id, label: c.full_name }));
    if (form.related_type === "property") return properties.map((p) => ({ id: p.id, label: p.title }));
    if (form.related_type === "lead") return leads.map((l) => ({ id: l.id, label: l.full_name }));
    return [];
  }, [form.related_type, clients, properties, leads]);

  const reset = () => {
    setFile(null);
    setForm({ document_type: "other", related_type: "client", related_id: "", notes: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("documents.toasts.fileRequired"));
      if (!form.related_id) throw new Error(t("documents.toasts.linkRequired"));
      setUploading(true);
      const ext = file.name.split(".").pop() ?? "bin";
      const path = await tenantStoragePath(`${form.related_type}/${form.related_id}/${crypto.randomUUID()}.${ext}`);
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("documents").createSignedUrl(path, 60);
      const fileUrl = signed?.signedUrl ?? path;
      const { error } = await supabase.from("documents").insert({
        file_name: file.name,
        file_url: path,
        document_type: form.document_type as "other",
        related_type: form.related_type,
        related_id: form.related_id,
        notes: form.notes.trim() || null,
        uploaded_by: user?.id,
        size_bytes: file.size,
        mime_type: file.type || null,
      });
      if (error) throw error;
      return fileUrl;
    },
    onSuccess: () => {
      toast.success(t("documents.toasts.uploaded"));
      qc.invalidateQueries({ queryKey: ["documents"] });
      reset();
      setOpen(false);
      setUploading(false);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setUploading(false);
    },
  });

  const remove = useMutation({
    mutationFn: async (doc: { id: string; file_url: string }) => {
      if (doc.file_url && !doc.file_url.startsWith("http")) {
        await supabase.storage.from("documents").remove([doc.file_url]);
      }
      await deleteToTrash("documents", doc.id);
    },
    onSuccess: () => {
      toast.success(t("documents.toasts.deleted"));
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openDocument = async (doc: { file_url: string }) => {
    if (doc.file_url.startsWith("http")) {
      window.open(doc.file_url, "_blank", "noopener");
      return;
    }
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.file_url, 300);
    if (error || !data) {
      toast.error(t("documents.toasts.openFailed"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const filtered = useMemo(
    () =>
      docs.filter((d) => {
        if (typeFilter !== "all" && d.document_type !== typeFilter) return false;
        if (relatedFilter !== "all" && d.related_type !== relatedFilter) return false;
        if (search && !d.file_name?.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [docs, typeFilter, relatedFilter, search],
  );

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <FileText className="h-8 w-8 text-[#6F6B94]" />
            {t("pages.documents.title")}
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
              <LayoutTemplate className="mr-1 h-4 w-4" />
              {t("documents.templates")}
            </Button>
            <Dialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) reset();
              }}
            >
              <DialogTrigger asChild>
                <Button>
                  <Upload className="mr-1 h-4 w-4" />
                  {t("documents.uploadButton")}
                </Button>
              </DialogTrigger>
              <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("documents.newDocument")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>{t("documents.fields.file")}</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  {file && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {file.name} · {formatBytes(file.size)}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("documents.fields.type")}</Label>
                    <Select value={form.document_type} onValueChange={(v) => setForm({ ...form, document_type: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_KEYS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {typeLabel(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("documents.fields.linkedWith")}</Label>
                    <Select
                      value={form.related_type}
                      onValueChange={(v) => setForm({ ...form, related_type: v, related_id: "" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RELATED_KEYS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {relatedLabel(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>{t("documents.fields.entry")}</Label>
                  {relatedOptions.length > 0 ? (
                    <Select value={form.related_id} onValueChange={(v) => setForm({ ...form, related_id: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("documents.fields.selectPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {relatedOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={form.related_id}
                      onChange={(e) => setForm({ ...form, related_id: e.target.value })}
                      placeholder={t("documents.fields.uuidPlaceholder")}
                    />
                  )}
                </div>
                <div>
                  <Label>{t("documents.fields.note")}</Label>
                  <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("documents.cancel")}
                </Button>
                <Button onClick={() => upload.mutate()} disabled={uploading || !file}>
                  {uploading ? t("documents.uploading") : t("documents.upload")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {(() => {
        const used = docs.reduce((sum, d) => sum + (d.size_bytes ?? 0), 0);
        const pct = Math.min(100, Math.round((used / MAX_STORAGE) * 100));
        return (
          <div className="mb-4 flex items-center gap-4 rounded-xl border bg-card p-3 shadow-soft">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HardDrive className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{t("documents.storageUsage")}</span>
                <span className="text-muted-foreground">
                  {formatBytes(used)} / {formatBytes(MAX_STORAGE)} ({pct}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        );
      })()}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {DOC_CENTER_TILES.filter((tile) => modAccess.isEnabled(moduleForPath(tile.to))).map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            className="group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <tile.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{t(tile.labelKey)}</span>
              <span className="block text-xs text-muted-foreground">{tile.desc}</span>
            </span>
          </Link>
        ))}
      </div>


      <Tabs defaultValue="folders" className="space-y-4">

        <TabsList>
          <TabsTrigger value="folders">{t("documents.tabs.folders")}</TabsTrigger>
          <TabsTrigger value="uploaded">{t("documents.tabs.uploaded")}</TabsTrigger>
          <TabsTrigger value="generated">{t("documents.tabs.generated")}</TabsTrigger>
        </TabsList>

        <TabsContent value="folders">
          <DocumentFolderView />
        </TabsContent>


        <TabsContent value="uploaded" className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("documents.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t("documents.filters.type")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("documents.filters.allTypes")}</SelectItem>
                {TYPE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {typeLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={relatedFilter} onValueChange={setRelatedFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t("documents.filters.link")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("documents.filters.allLinks")}</SelectItem>
                {RELATED_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {relatedLabel(k)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              {t("documents.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title={t("documents.empty.title")}
              description={t("documents.empty.description")}
            />
          ) : (
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("documents.fields.name")}</TableHead>
                    <TableHead>{t("documents.fields.type")}</TableHead>
                    <TableHead>{t("documents.fields.link")}</TableHead>
                    <TableHead>{t("documents.fields.size")}</TableHead>
                    <TableHead>{t("documents.fields.uploadedBy")}</TableHead>
                    <TableHead>{t("documents.fields.date")}</TableHead>
                    <TableHead className="text-right">{t("documents.fields.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => {
                    const uploader = (d as { uploader?: { full_name?: string } }).uploader;
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{d.file_name ?? t("documents.fields.unnamed")}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {typeLabel(d.document_type as string)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.related_type ? relatedLabel(d.related_type) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatBytes(d.size_bytes)}</TableCell>
                        <TableCell className="text-muted-foreground">{uploader?.full_name ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => openDocument(d)} title={t("documents.open")}>
                            {d.file_url?.startsWith("http") ? (
                              <ExternalLink className="h-4 w-4" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => remove.mutate({ id: d.id, file_url: d.file_url })}
                              title={t("documents.delete")}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="generated">
          <GeneratedDocumentsTable />
        </TabsContent>
      </Tabs>

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("documents.templates")}</DialogTitle>
          </DialogHeader>
          <DocumentTemplatesManager />
        </DialogContent>
      </Dialog>
    </>
  );
}
