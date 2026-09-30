import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { PropertyPhoto } from "@/components/properties/PropertyPhoto";
import { formatArea, formatCurrency, getPropertyStatusBadgeClass } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { Bath, Bed, Building2, Layers3, MapPin, Maximize, User } from "lucide-react";

export function PropertyHoverCard({
  property,
  assignee,
  children,
}: {
  property: any;
  assignee?: { full_name?: string | null; email?: string | null } | null;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const statusLabel = (s: string) => t(`properties.status.${s}`, { defaultValue: s });
  const typeLabel = (s: string) => t(`properties.type.${s}`, { defaultValue: s });
  const price =
    property.listing_type === "rent"
      ? property.rent
        ? Number(property.rent)
        : null
      : property.price
        ? Number(property.price)
        : null;

  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 overflow-hidden p-0">
        <div className="relative h-36 w-full bg-muted">
          <PropertyPhoto sources={property.images} alt={property.title} />
          <div className="absolute left-2 top-2 flex gap-1">
            <Badge variant="outline" className={`bg-background/90 text-[10px] ${getPropertyStatusBadgeClass(property.status)}`}>
              {statusLabel(property.status)}
            </Badge>
          </div>
        </div>

        <div className="space-y-2 p-3">
          <div>
            <p className="text-sm font-semibold leading-tight">{property.title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {[property.address, [property.zip, property.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"}
            </p>
          </div>

          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-primary">
              {formatCurrency(price) ?? "—"}
              {property.listing_type === "rent" && price ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">{t("properties.perMonth")}</span>
              ) : null}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" />
              {typeLabel(property.property_type)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-2 text-xs text-muted-foreground">
            {property.rooms ? (
              <span className="flex items-center gap-1"><Bed className="h-3 w-3" />{property.rooms} {t("properties.card.rooms", { defaultValue: "Zi." })}</span>
            ) : null}
            {property.bathrooms ? (
              <span className="flex items-center gap-1"><Bath className="h-3 w-3" />{property.bathrooms}</span>
            ) : null}
            {property.living_area || property.area ? (
              <span className="flex items-center gap-1"><Maximize className="h-3 w-3" />{formatArea(Number(property.living_area || property.area))}</span>
            ) : null}
            {property.floor != null ? (
              <span className="flex items-center gap-1"><Layers3 className="h-3 w-3" />{property.floor}. OG</span>
            ) : null}
            {property.year_built ? <span>Bj. {property.year_built}</span> : null}
          </div>

          {assignee ? (
            <p className="flex items-center gap-1 border-t pt-2 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              {assignee.full_name || assignee.email}
            </p>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
