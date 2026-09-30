type PropertyMediaLike = {
  file_url?: string | null;
  file_type?: string | null;
  sort_order?: number | null;
  is_cover?: boolean | null;
  created_at?: string | null;
};

export function isImageMedia(item: PropertyMediaLike): boolean {
  const kind = item.file_type?.toLowerCase() ?? null;
  return (!kind || kind === "image" || kind.startsWith("image/")) &&
    !/\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|zip|mp4|mov|webm)(?:[?#]|$)/i.test(item.file_url ?? "");
}

export function orderPropertyMedia<T extends PropertyMediaLike>(items: T[]): T[] {
  return [...items]
    .filter((item) => !!item.file_url)
    .sort((a, b) => {
      const coverDiff = Number(!!b.is_cover) - Number(!!a.is_cover);
      if (coverDiff !== 0) return coverDiff;

      const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;

      return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
    });
}

export function extractPropertyImagePaths<T extends PropertyMediaLike>(items: T[]): string[] {
  return orderPropertyMedia(items)
    .filter(isImageMedia)
    .map((item) => item.file_url?.trim() ?? "")
    .filter(Boolean);
}