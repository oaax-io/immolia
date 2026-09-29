import { tenantStoragePath } from "@/lib/tenant-storage";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Search, Trash2, Image as ImageIcon, Upload, Star, ArrowUp, ArrowDown, FileText, HardDrive, ChevronLeft, ChevronRight, Download, X, Pencil, Check, Calendar, User as UserIcon, Building2, Folder, ArrowLeft, Copy, LayoutGrid, List as ListIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { convertUnsupportedImages } from "@/lib/image-convert";
import { extractPropertyImagePaths } from "@/lib/property-media";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_app/media")({ component: MediaPage });

type MediaItem = {
  id: string;
  property_id: string;
  file_url: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  title: string | null;
  description: string | null;
  is_cover: boolean;
  sort_order: number;
  created_at: string;
  uploaded_by: string | null;
  properties?: { title: string; city: string | null } | null;
  uploader?: { full_name: string | null; email: string | null } | null;
};

function getPublicUrl(path: string) {
  if (path.startsWith("http")) return path;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

async function syncPropertyImages(propertyId: string) {
  const { data, error } = await supabase
    .from("property_media")
    .select("file_url, file_type, sort_order, is_cover, created_at")
    .eq("property_id", propertyId);
  if (error) throw error;

  const { error: updateError } = await supabase
    .from("properties")
    .update({ images: extractPropertyImagePaths(data ?? []) })
    .eq("id", propertyId);
  if (updateError) throw updateError;
}

function detectKind(file: File): string {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.name.toLowerCase().includes("grundriss") || file.name.toLowerCase().includes("floor")) return "floor_plan";
  return "other";
}

function isDocumentLike(item: { file_name?: string | null; file_url?: string | null; file_type?: string | null }): boolean {
  const name = (item.file_name ?? item.file_url ?? "").toLowerCase();
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods|odp)$/i.test(name)) return true;
  const t = (item.file_type ?? "").toLowerCase();
  if (t === "document" || t === "pdf") return true;
  return false;
}

function isAcceptedMediaFile(file: File): boolean {
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) return true;
  // Some browsers report empty mime for HEIC/TIFF — fall back to extension
  if (/\.(heic|heif|tif|tiff|avif)$/i.test(file.name)) return true;
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

const MAX_STORAGE = 20 * 1024 * 1024 * 1024; // 20 GB

function MediaPage() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language?.startsWith("fr") ? "fr-CH" : "de-CH";
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0, currentName: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ property_id: "", title: "", description: "" });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [viewMode, setViewMode] = useState<"folder" | "grid">("grid");

  const { data: media = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: ["property-media"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_media")
        .select("*, properties(title, city)")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const items = (data as MediaItem[]) ?? [];
      // Background: fill missing file_size from storage metadata
      const missing = items.filter((m) => m.file_size == null && m.file_url && !m.file_url.startsWith("http"));
      if (missing.length > 0) {
        const folderMap = new Map<string, string[]>();
        for (const m of missing) {
          const folder = m.file_url.split("/")[0] ?? "";
          if (!folderMap.has(folder)) folderMap.set(folder, []);
          folderMap.get(folder)!.push(m.file_url);
        }
        for (const [folder, paths] of folderMap) {
          const { data: listData } = await supabase.storage.from("media").list(folder);
          if (listData) {
            for (const m of missing) {
              const fileName = m.file_url.split("/").pop();
              const meta = listData.find((f) => f.name === fileName);
              if (meta?.metadata?.size) {
                await supabase.from("property_media").update({ file_size: meta.metadata.size }).eq("id", m.id);
                m.file_size = meta.metadata.size;
              }
            }
          }
        }
      }
      // Fetch uploader profiles
      const uploaderIds = Array.from(new Set(items.map((m) => m.uploaded_by).filter((x): x is string => !!x)));
      if (uploaderIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", uploaderIds);
        const map = new Map((profs ?? []).map((p) => [p.id, p]));
        for (const m of items) {
          if (m.uploaded_by) {
            const p = map.get(m.uploaded_by);
            if (p) m.uploader = { full_name: p.full_name, email: p.email };
          }
        }
      }
      return items;
    },
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["properties-min"],
    queryFn: async () =>
      (
        await supabase
          .from("properties")
          .select("id, title, city, parent_property_id, is_unit")
          .order("title")
      ).data ?? [],
  });

  // Map every property to its "root" property (parent if unit, else itself).
  // Units share the same folder as their parent property.
  const propertyIndex = useMemo(() => {
    const byId = new Map<string, { id: string; title: string; city: string | null; parent_property_id: string | null; is_unit: boolean | null }>();
    for (const p of properties as any[]) byId.set(p.id, p);
    const rootOf = (pid: string | null | undefined): string | null => {
      if (!pid) return null;
      const p = byId.get(pid);
      if (!p) return pid;
      return p.is_unit && p.parent_property_id ? p.parent_property_id : p.id;
    };
    return { byId, rootOf };
  }, [properties]);

  const rootProperties = useMemo(
    () => (properties as any[]).filter((p) => !p.is_unit),
    [properties],
  );

  const reset = () => {
    setFiles([]);
    setForm({ property_id: "", title: "", description: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!form.property_id) throw new Error(t("media.toasts.propertyRequired"));
      if (files.length === 0) throw new Error(t("media.toasts.fileRequired"));
      const rejected = files.filter((f) => !isAcceptedMediaFile(f));
      if (rejected.length > 0) {
        throw new Error(t("media.toasts.onlyMedia", { names: rejected.map((f) => f.name).join(", ") }));
      }
      setUploading(true);
      const processed = await convertUnsupportedImages(files);
      const maxSort = Math.max(0, ...media.filter((m) => m.property_id === form.property_id).map((m) => m.sort_order));
      setUploadProgress({ done: 0, total: processed.length, currentName: processed[0]?.name ?? "" });
      const toastId = toast.loading(t("media.uploadingProgress", { done: 0, total: processed.length }));

      try {
        for (let i = 0; i < processed.length; i++) {
          const file = processed[i];
          setUploadProgress({ done: i, total: processed.length, currentName: file.name });
          toast.loading(t("media.uploadingProgressNamed", { done: i, total: processed.length, name: file.name }), { id: toastId });

          const ext = file.name.split(".").pop() ?? "bin";
          const path = `${form.property_id}/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });
          if (upErr) throw upErr;

          const { error } = await supabase.from("property_media").insert({
            property_id: form.property_id,
            file_url: path,
            file_name: file.name,
            file_type: detectKind(file),
            file_size: file.size,
            title: files.length === 1 && form.title ? form.title : null,
            description: files.length === 1 && form.description ? form.description : null,
            sort_order: maxSort + i + 1,
          });
          if (error) throw error;

          setUploadProgress({ done: i + 1, total: processed.length, currentName: file.name });
        }

        await syncPropertyImages(form.property_id);
        toast.success(
          processed.length === 1
            ? t("media.toasts.uploaded")
            : t("media.toasts.uploadedAll", { count: processed.length }),
          { id: toastId },
        );
      } catch (err) {
        toast.dismiss(toastId);
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-media"] });
      reset();
      setOpen(false);
      setUploading(false);
      setUploadProgress({ done: 0, total: 0, currentName: "" });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setUploading(false);
      setUploadProgress({ done: 0, total: 0, currentName: "" });
    },
  });

  const remove = useMutation({
    mutationFn: async (item: MediaItem) => {
      // Zuerst Datensatz löschen (RLS entscheidet), Datei nur nach bestätigter Löschung entfernen.
      const { data: deleted, error } = await supabase.from("property_media").delete().eq("id", item.id).select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) throw new Error("Keine Berechtigung zum Löschen dieses Mediums.");
      if (item.file_url && !item.file_url.startsWith("http")) {
        await supabase.storage.from("media").remove([item.file_url]);
      }
      await syncPropertyImages(item.property_id);
    },
    onSuccess: () => {
      toast.success(t("media.toasts.deleted"));
      qc.invalidateQueries({ queryKey: ["property-media"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setCover = useMutation({
    mutationFn: async (item: MediaItem) => {
      await supabase.from("property_media").update({ is_cover: false }).eq("property_id", item.property_id);
      const { error } = await supabase.from("property_media").update({ is_cover: true }).eq("id", item.id);
      if (error) throw error;
      await syncPropertyImages(item.property_id);
    },
    onSuccess: () => {
      toast.success(t("media.toasts.coverSet"));
      qc.invalidateQueries({ queryKey: ["property-media"] });
    },
  });

  const moveSort = useMutation({
    mutationFn: async ({ item, dir }: { item: MediaItem; dir: -1 | 1 }) => {
      const siblings = media.filter((m) => m.property_id === item.property_id);
      const idx = siblings.findIndex((m) => m.id === item.id);
      const target = siblings[idx + dir];
      if (!target) return;
      await supabase.from("property_media").update({ sort_order: target.sort_order }).eq("id", item.id);
      await supabase.from("property_media").update({ sort_order: item.sort_order }).eq("id", target.id);
      await syncPropertyImages(item.property_id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["property-media"] }),
  });

  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      // We only update the display title; file_url and file_name in storage remain unchanged → keine Datei geht verloren.
      const { error } = await supabase
        .from("property_media")
        .update({ title: title.trim() || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("media.toasts.renamed"));
      qc.invalidateQueries({ queryKey: ["property-media"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeDuplicates = useMutation({
    mutationFn: async (propertyId: string) => {
      const items = media.filter((m) => m.property_id === propertyId);
      // Group by file_size + file_type (keep earliest created_at, remove the rest)
      const groups = new Map<string, MediaItem[]>();
      for (const m of items) {
        if (m.file_size == null) continue;
        const key = `${m.file_type ?? ""}::${m.file_size}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(m);
      }
      const toRemove: MediaItem[] = [];
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const sorted = [...group].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        // Keep first; remove rest. But prefer to keep the cover if any.
        const coverIdx = sorted.findIndex((m) => m.is_cover);
        const keepIdx = coverIdx >= 0 ? coverIdx : 0;
        sorted.forEach((m, i) => {
          if (i !== keepIdx) toRemove.push(m);
        });
      }
      if (toRemove.length === 0) return 0;
      const paths = toRemove
        .map((m) => m.file_url)
        .filter((p) => p && !p.startsWith("http"));
      if (paths.length > 0) {
        await supabase.storage.from("media").remove(paths);
      }
      const { error } = await supabase
        .from("property_media")
        .delete()
        .in("id", toRemove.map((m) => m.id));
      if (error) throw error;
      await syncPropertyImages(propertyId);
      return toRemove.length;
    },
    onSuccess: (count) => {
      if (count === 0) toast.info(t("media.duplicates.none"));
      else toast.success(t("media.duplicates.removed", { count }));
      qc.invalidateQueries({ queryKey: ["property-media"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const migrateDocuments = useMutation({
    mutationFn: async () => {
      const docs = media.filter(isDocumentLike);
      if (docs.length === 0) return 0;
      const { data: userData } = await supabase.auth.getUser();
      const uploaderId = userData.user?.id ?? null;
      const touchedProperties = new Set<string>();
      let moved = 0;
      for (const item of docs) {
        if (!item.file_url || item.file_url.startsWith("http")) {
          // Externally hosted — just delete the row, nothing to copy
          await supabase.from("property_media").delete().eq("id", item.id);
          moved++;
          continue;
        }
        const { data: blob, error: dlErr } = await supabase.storage.from("media").download(item.file_url);
        if (dlErr || !blob) {
          console.warn("Download fehlgeschlagen", item.file_url, dlErr);
          continue;
        }
        const safeName = (item.file_name ?? item.file_url.split("/").pop() ?? "dokument").replace(/[^a-zA-Z0-9._-]/g, "_");
        const newPath = await tenantStoragePath(`properties/${item.property_id}/${Date.now()}-${safeName}`);
        const lowerName = (item.file_name ?? item.file_url).toLowerCase();
        const mime = lowerName.endsWith(".pdf")
          ? "application/pdf"
          : blob.type || "application/octet-stream";
        const { error: upErr } = await supabase.storage.from("documents").upload(newPath, blob, {
          contentType: mime,
          upsert: false,
        });
        if (upErr) {
          console.warn("Upload nach documents fehlgeschlagen", upErr);
          continue;
        }
        const { error: insErr } = await supabase.from("documents").insert({
          related_type: "property",
          related_id: item.property_id,
          document_type: "property_document" as any,
          file_url: newPath,
          file_name: item.file_name ?? safeName,
          mime_type: mime,
          size_bytes: item.file_size ?? blob.size ?? null,
          uploaded_by: uploaderId,
        });
        if (insErr) {
          console.warn("Documents-Insert fehlgeschlagen, räume auf", insErr);
          await supabase.storage.from("documents").remove([newPath]);
          continue;
        }
        await supabase.storage.from("media").remove([item.file_url]);
        await supabase.from("property_media").delete().eq("id", item.id);
        touchedProperties.add(item.property_id);
        moved++;
      }
      for (const pid of touchedProperties) await syncPropertyImages(pid);
      return moved;
    },
    onSuccess: (count) => {
      if (count === 0) toast.info(t("media.migration.none"));
      else toast.success(t("media.migration.moved", { count }));
      qc.invalidateQueries({ queryKey: ["property-media"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const documentLikeCount = useMemo(() => media.filter(isDocumentLike).length, [media]);

  const filtered = useMemo(
    () =>
      media.filter((m) => {
        // Mediathek = nur Bilder & Videos. Dokumente (PDF etc.) gehören in "Dokumente".
        if (isDocumentLike(m)) return false;
        if (propertyFilter !== "all") {
          const root = propertyIndex.rootOf(m.property_id);
          if (root !== propertyFilter) return false;
        }
        if (typeFilter !== "all" && m.file_type !== typeFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!m.title?.toLowerCase().includes(q) && !m.file_name?.toLowerCase().includes(q)) return false;
        }
        return true;
      }),
    [media, propertyFilter, typeFilter, search, propertyIndex],
  );

  const showFolders = viewMode === "folder";

  const folders = useMemo(() => {
    const map = new Map<string, { propertyId: string; title: string; city: string | null; items: MediaItem[]; cover: MediaItem | null; unitCount: number }>();
    const unitsSeen = new Map<string, Set<string>>();
    for (const m of filtered) {
      if (!m.property_id) continue;
      const rootId = propertyIndex.rootOf(m.property_id) ?? m.property_id;
      const rootProp = propertyIndex.byId.get(rootId);
      const f = map.get(rootId) ?? {
        propertyId: rootId,
        title: rootProp?.title ?? m.properties?.title ?? t("media.untitled"),
        city: rootProp?.city ?? m.properties?.city ?? null,
        items: [],
        cover: null,
        unitCount: 0,
      };
      f.items.push(m);
      if (!f.cover || m.is_cover) f.cover = f.cover && f.cover.is_cover ? f.cover : m;
      if (m.property_id !== rootId) {
        const set = unitsSeen.get(rootId) ?? new Set<string>();
        set.add(m.property_id);
        unitsSeen.set(rootId, set);
      }
      map.set(rootId, f);
    }
    for (const [rootId, set] of unitsSeen) {
      const f = map.get(rootId);
      if (f) f.unitCount = set.size;
    }
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [filtered, propertyIndex]);

  const duplicateCount = useMemo(() => {
    if (showFolders || propertyFilter === "all") return 0;
    const items = media.filter(
      (m) => propertyIndex.rootOf(m.property_id) === propertyFilter && m.file_size != null,
    );
    const groups = new Map<string, number>();
    for (const m of items) {
      const key = `${m.file_type ?? ""}::${m.file_size}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    let extras = 0;
    for (const count of groups.values()) if (count > 1) extras += count - 1;
    return extras;
  }, [media, propertyFilter, showFolders, propertyIndex]);

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <ImageIcon className="h-8 w-8 text-[#6F6B94]" />
            {t("pages.media.title")}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "folder" | "grid")}>
              <TabsList>
                <TabsTrigger value="grid"><LayoutGrid className="mr-1 h-4 w-4" />{t("media.viewModes.tiles")}</TabsTrigger>
                <TabsTrigger value="folder"><ListIcon className="mr-1 h-4 w-4" />{t("media.viewModes.folders")}</TabsTrigger>
              </TabsList>
            </Tabs>
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
                  {t("media.uploadButton")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("media.newMedia")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>{t("media.fields.property")}</Label>
                    <Select value={form.property_id} onValueChange={(v) => setForm({ ...form, property_id: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("media.fields.selectProperty")} />
                      </SelectTrigger>
                      <SelectContent>
                        {rootProperties.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("media.fields.files")}</Label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*,.tif,.tiff,.heic,.heif"
                      multiple
                      className="hidden"
                      onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setDragActive(false); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragActive(false);
                        const dropped = Array.from(e.dataTransfer.files ?? []);
                        if (dropped.length > 0) setFiles(dropped);
                      }}
                      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${
                        dragActive
                          ? "scale-[1.01] border-primary bg-primary/10"
                          : "border-muted-foreground/30 hover:border-primary/60 hover:bg-accent/20"
                      }`}
                    >
                      <div className={`rounded-full bg-primary/10 p-3 ${dragActive ? "animate-bounce" : ""}`}>
                        <Upload className={`h-5 w-5 ${dragActive ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <p className="text-sm font-medium">
                        {dragActive ? t("media.dropzone.release") : t("media.dropzone.idle")}
                      </p>
                      <p className="text-xs text-muted-foreground">{t("media.dropzone.hint")}</p>
                    </div>
                    {files.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">{t("media.dropzone.selected", { count: files.length })}</p>
                    )}
                  </div>

                  {files.length === 1 && (
                    <>
                      <div>
                        <Label>{t("media.fields.title")}</Label>
                        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                      </div>
                      <div>
                        <Label>{t("media.fields.description")}</Label>
                        <Textarea
                          rows={2}
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>
                {uploading && uploadProgress.total > 0 && (() => {
                  const pct = Math.round((uploadProgress.done / uploadProgress.total) * 100);
                  return (
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">
                          {t("media.uploadedCount", { done: uploadProgress.done, total: uploadProgress.total })}
                        </span>
                        <span className="text-muted-foreground">{pct}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      {uploadProgress.currentName && (
                        <p className="truncate text-xs text-muted-foreground">{uploadProgress.currentName}</p>
                      )}
                    </div>
                  );
                })()}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={uploading}>
                    {t("media.cancel")}
                  </Button>
                  <Button onClick={() => upload.mutate()} disabled={uploading || files.length === 0}>
                    {uploading ? t("media.uploading") : t("media.upload")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Storage usage */}
      {(() => {
        const used = media.reduce((sum, m) => sum + (m.file_size ?? 0), 0);
        const pct = Math.min(100, Math.round((used / MAX_STORAGE) * 100));
        return (
          <div className="mb-4 flex items-center gap-4 rounded-xl border bg-card p-3 shadow-soft">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HardDrive className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{t("media.storageUsage")}</span>
                <span className="text-muted-foreground">
                  {formatBytes(used)} / {formatBytes(MAX_STORAGE)} ({pct}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {documentLikeCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {t("media.migration.warn", { count: documentLikeCount })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={migrateDocuments.isPending}
            onClick={async () => {
              if (await confirm({ title: t("media.migration.confirmTitle"), description: t("media.migration.confirmDescription", { count: documentLikeCount }), confirmText: t("media.migration.confirm") })) {
                migrateDocuments.mutate();
              }
            }}
          >
            {migrateDocuments.isPending ? t("media.migration.moving") : t("media.migration.move")}
          </Button>
        </div>
      )}



      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("media.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("media.filters.property")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("media.filters.allProperties")}</SelectItem>
            {rootProperties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("media.filters.type")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("media.filters.allTypes")}</SelectItem>
            <SelectItem value="image">{t("media.filters.images")}</SelectItem>
            <SelectItem value="video">{t("media.filters.videos")}</SelectItem>
            <SelectItem value="floor_plan">{t("media.filters.floorPlans")}</SelectItem>
            
          </SelectContent>
        </Select>
      </div>

      {propertyFilter !== "all" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setPropertyFilter("all")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("media.folders.allFolders")}
          </Button>
          {duplicateCount > 0 && (
            <div className="ml-auto flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200">
              <Copy className="h-3.5 w-3.5" />
              <span>{t("media.duplicates.detected", { count: duplicateCount })}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={async () => {
                  if (await confirm({ title: t("media.duplicates.confirmTitle"), description: t("media.duplicates.confirmDescription", { count: duplicateCount }), confirmText: t("media.duplicates.confirm") })) {
                    removeDuplicates.mutate(propertyFilter);
                  }
                }}
              >
                {t("media.duplicates.remove")}
              </Button>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">{t("media.loading")}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t("media.empty.title")}
          description={t("media.empty.description")}
        />
      ) : showFolders ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-soft">
          <div className="grid grid-cols-[1fr_120px_140px_80px] gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <div>{t("media.fields.name")}</div>
            <div className="text-right">{t("media.fields.fileCount")}</div>
            <div>{t("media.fields.location")}</div>
            <div className="text-right">{t("media.fields.units")}</div>
          </div>
          {folders.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("media.folders.empty")}</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.propertyId}
                type="button"
                onClick={() => { setPropertyFilter(f.propertyId); setViewMode("grid"); }}
                className="grid w-full grid-cols-[1fr_120px_140px_80px] items-center gap-4 border-b px-4 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-muted/50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Folder className="h-5 w-5 shrink-0 text-primary" fill="currentColor" />
                  <span className="truncate font-medium">{f.title}</span>
                </div>
                <div className="text-right text-muted-foreground tabular-nums">{f.items.length}</div>
                <div className="truncate text-muted-foreground">{f.city ?? "—"}</div>
                <div className="text-right text-muted-foreground tabular-nums">{f.unitCount > 0 ? f.unitCount : "—"}</div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((m, idx) => {
            const url = getPublicUrl(m.file_url);
            const isVideo = m.file_type === "video";
            const isPdf = (m.file_name ?? m.file_url ?? "").toLowerCase().endsWith(".pdf");
            return (
              <div key={m.id} className="group relative overflow-hidden rounded-xl border bg-card shadow-soft">
                <button
                  type="button"
                  onClick={() => setViewerIndex(idx)}
                  className="relative block aspect-square w-full overflow-hidden bg-muted text-left"
                >
                  {isPdf ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/60 text-muted-foreground transition group-hover:bg-muted">
                      <FileText className="h-10 w-10" />
                      <span className="text-xs font-medium">{t("media.badges.openPdf")}</span>
                    </div>
                  ) : isVideo ? (
                    <video src={url} className="h-full w-full object-cover" muted />
                  ) : url ? (
                    <img
                      src={url}
                      alt={m.title ?? m.file_name ?? ""}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  {m.is_cover && (
                    <Badge className="absolute left-2 top-2 bg-primary text-primary-foreground">
                      <Star className="mr-1 h-3 w-3" />
                      {t("media.badges.cover")}
                    </Badge>
                  )}
                  {m.file_type && m.file_type !== "image" && (
                    <Badge variant="secondary" className="absolute right-2 top-2 capitalize">
                      {m.file_type === "floor_plan" ? t("media.badges.floorPlan") : m.file_type}
                    </Badge>
                  )}
                </button>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{m.title ?? m.file_name ?? t("media.untitled")}</p>
                  {m.properties && (
                    <Link
                      to="/properties/$id"
                      params={{ id: m.property_id }}
                      className="truncate text-xs text-muted-foreground hover:text-primary"
                    >
                      {m.properties.title}
                    </Link>
                  )}
                </div>
                <div className="absolute right-2 top-12 flex flex-col gap-1.5 opacity-0 transition group-hover:opacity-100">
                  {!m.is_cover && (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 bg-card/95 text-foreground border border-border shadow-md backdrop-blur-sm hover:bg-primary hover:text-primary-foreground transition-colors"
                      title={t("media.actions.setCover")}
                      onClick={() => setCover.mutate(m)}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 bg-card/95 text-foreground border border-border shadow-md backdrop-blur-sm hover:bg-primary hover:text-primary-foreground transition-colors"
                    title={t("media.actions.moveUp")}
                    onClick={() => moveSort.mutate({ item: m, dir: -1 })}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 bg-card/95 text-foreground border border-border shadow-md backdrop-blur-sm hover:bg-primary hover:text-primary-foreground transition-colors"
                    title={t("media.actions.moveDown")}
                    onClick={() => moveSort.mutate({ item: m, dir: 1 })}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 bg-card/95 text-foreground border border-border shadow-md backdrop-blur-sm hover:bg-primary hover:text-primary-foreground transition-colors"
                    title={t("media.actions.rename")}
                    onClick={() => {
                      const next = window.prompt(t("media.newTitlePrompt"), m.title ?? m.file_name ?? "");
                      if (next !== null) rename.mutate({ id: m.id, title: next });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 bg-card/95 text-foreground border border-border shadow-md backdrop-blur-sm hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    title={t("media.actions.delete")}
                    onClick={() => remove.mutate(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Viewer / Lightbox */}
      {viewerIndex !== null && filtered[viewerIndex] && (() => {
        const current = filtered[viewerIndex];
        const url = getPublicUrl(current.file_url);
        const isVideo = current.file_type === "video";
        const isPdf = (current.file_name ?? current.file_url ?? "").toLowerCase().endsWith(".pdf");
        const goPrev = () => setViewerIndex((i) => (i === null ? null : (i - 1 + filtered.length) % filtered.length));
        const goNext = () => setViewerIndex((i) => (i === null ? null : (i + 1) % filtered.length));
        return (
          <div
            className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
            onKeyDown={(e) => {
              if (e.key === "Escape") setViewerIndex(null);
              if (e.key === "ArrowLeft") goPrev();
              if (e.key === "ArrowRight") goNext();
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <div className="flex items-center justify-between gap-3 border-b bg-card/80 px-4 py-3">
              <div className="min-w-0 flex-1">
                {editingTitle !== null ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      rename.mutate({ id: current.id, title: editingTitle });
                      setEditingTitle(null);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingTitle(null); }}
                      className="h-8 max-w-md"
                    />
                    <Button type="submit" size="icon" variant="secondary" className="h-8 w-8" title={t("media.actions.save")}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title={t("media.cancel")} onClick={() => setEditingTitle(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{current.title ?? current.file_name ?? t("media.untitled")}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      title={t("media.actions.rename")}
                      onClick={() => setEditingTitle(current.title ?? current.file_name ?? "")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{viewerIndex + 1} / {filtered.length}</span>
                  {current.properties && (
                    <Link
                      to="/properties/$id"
                      params={{ id: current.property_id }}
                      className="inline-flex items-center gap-1 hover:text-primary"
                    >
                      <Building2 className="h-3 w-3" />
                      {current.properties.title}
                    </Link>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(current.created_at).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  {(current.uploader?.full_name || current.uploader?.email) && (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="h-3 w-3" />
                      {current.uploader.full_name ?? current.uploader.email}
                    </span>
                  )}
                  {current.file_size != null && <span>{formatBytes(current.file_size)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={url} download={current.file_name ?? undefined} target="_blank" rel="noreferrer">
                    <Download className="mr-1 h-4 w-4" /> {t("media.actions.download")}
                  </a>
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setViewerIndex(null)} title={t("media.actions.close")}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
              <Button
                variant="secondary"
                size="icon"
                className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-lg"
                onClick={goPrev}
                title={t("media.actions.prev")}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex h-full w-full max-w-6xl items-center justify-center">
                {isPdf ? (
                  <iframe src={url} className="h-full w-full rounded-lg border bg-white" title={current.file_name ?? "PDF"} />
                ) : isVideo ? (
                  <video src={url} controls className="max-h-full max-w-full rounded-lg" />
                ) : (
                  <img src={url} alt={current.title ?? current.file_name ?? ""} className="max-h-full max-w-full rounded-lg object-contain" />
                )}
              </div>
              <Button
                variant="secondary"
                size="icon"
                className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full shadow-lg"
                onClick={goNext}
                title={t("media.actions.next")}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        );
      })()}
    </>
  );
}
