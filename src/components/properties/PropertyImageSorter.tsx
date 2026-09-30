import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PropertyPhoto } from "@/components/properties/PropertyPhoto";

type Props = {
  items: string[];
  getUrl: (path: string) => string;
  title: string;
  onReorder: (next: string[]) => void;
  onOpen?: (path: string) => void;
  onSetCover?: (path: string) => void;
  onDelete?: (path: string) => void;
};

function Tile({
  path,
  index,
  getUrl,
  title,
  onOpen,
  onSetCover,
  onDelete,
}: {
  path: string;
  index: number;
  getUrl: Props["getUrl"];
  title: string;
  onOpen?: Props["onOpen"];
  onSetCover?: Props["onSetCover"];
  onDelete?: Props["onDelete"];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: path });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group/img relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted ${
        isDragging ? "opacity-40 ring-2 ring-primary ring-dashed" : ""
      }`}
    >
      <div className="h-full w-full" onClick={() => onOpen?.(path)}>
        <PropertyPhoto sources={[getUrl(path)]} alt={`${title} ${index + 1}`} />
      </div>

      <button
        type="button"
        aria-label="Bild verschieben"
        className="absolute right-2 top-2 cursor-grab touch-none rounded-md bg-background/90 p-1.5 shadow active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      <div className="absolute left-2 top-2 flex items-center gap-1">
        <span className="rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold shadow">{index + 1}</span>
        {index === 0 && <Badge className="text-[10px]">Cover</Badge>}
      </div>

      <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1 opacity-0 transition group-hover/img:opacity-100">
        {index !== 0 && onSetCover ? (
          <button
            type="button"
            onClick={() => onSetCover(path)}
            className="rounded bg-background/90 px-2 py-1 text-[10px] font-medium shadow hover:bg-background"
          >
            Als Cover
          </button>
        ) : (
          <span />
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(path)}
            className="rounded bg-destructive/90 p-1 text-destructive-foreground shadow hover:bg-destructive"
            aria-label="Bild löschen"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function PropertyImageSorter({ items, getUrl, title, onReorder, onOpen, onSetCover, onDelete }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const handleEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.indexOf(String(active.id));
    const to = items.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((path, i) => (
            <Tile
              key={path}
              path={path}
              index={i}
              getUrl={getUrl}
              title={title}
              onOpen={onOpen}
              onSetCover={onSetCover}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2,0,0,1)" }}>
        {activeId ? (
          <div className="aspect-[4/3] w-full overflow-hidden rounded-lg border-2 border-primary shadow-2xl">
            <PropertyPhoto sources={[getUrl(activeId)]} alt={title} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
