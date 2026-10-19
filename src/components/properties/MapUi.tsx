import * as SliderPrimitive from "@radix-ui/react-slider";
import { TrendingUp } from "lucide-react";

export const YIELD_MIN = 0, YIELD_MAX = 10;
export const chf = (v: number) => new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 }).format(v);

export function RangeSlider({ value, min, max, step, onChange }: { value: [number, number]; min: number; max: number; step: number; onChange: (v: [number, number]) => void }) {
  return (
    <SliderPrimitive.Root className="relative flex w-full touch-none select-none items-center py-1" value={value} min={min} max={max} step={step} onValueChange={(v) => onChange([v[0], v[1]] as [number, number])}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow" />
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow" />
    </SliderPrimitive.Root>
  );
}

const comparisonLabels: Record<string, string> = {
  below_market: "Unter Marktwert",
  at_market: "Marktgerecht",
  above_market: "Über Marktwert",
  unknown: "Nicht eindeutig",
};

export function comparisonLabel(comparison?: string) {
  return comparison ? comparisonLabels[comparison] : undefined;
}

export function range(min?: number, max?: number, prefix = "", suffix = "", digits = 0) {
  const f = (v?: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? new Intl.NumberFormat("de-CH", { maximumFractionDigits: digits }).format(v)
      : null;
  const a = f(min), b = f(max);
  if (!a && !b) return "—";
  if (a && b && a !== b) return `${prefix}${a}–${b}${suffix}`;
  return `${prefix}${a ?? b}${suffix}`;
}

const G_MIN = 2, G_MAX = 6;
function polar(cx: number, cy: number, rad: number, v: number) {
  const a = Math.PI * (1 - (Math.min(Math.max(v, G_MIN), G_MAX) - G_MIN) / (G_MAX - G_MIN));
  return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
}
function arc(from: number, to: number) {
  const [x1, y1] = polar(70, 70, 56, from), [x2, y2] = polar(70, 70, 56, to);
  return `M ${x1} ${y1} A 56 56 0 0 1 ${x2} ${y2}`;
}

export function YieldGauge({ min, max }: { min?: number; max?: number }) {
  const vals = [min, max].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const [nx, ny] = polar(70, 70, 44, value ?? G_MIN);
  const label = value == null ? "Keine Angabe" : value >= 4.5 ? "Überdurchschnittlich" : value >= 3.5 ? "Marktüblich" : "Moderat";
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-2">
      <svg viewBox="0 0 140 80" className="h-[72px] w-[126px] shrink-0">
        <path d={arc(2, 3.5)} style={{ stroke: "var(--chart-4)" }} strokeWidth="12" fill="none" />
        <path d={arc(3.5, 4.5)} style={{ stroke: "var(--chart-2)" }} strokeWidth="12" fill="none" />
        <path d={arc(4.5, 6)} style={{ stroke: "var(--chart-1)" }} strokeWidth="12" fill="none" />
        {value != null && <line x1="70" y1="70" x2={nx} y2={ny} className="stroke-foreground" strokeWidth="3" strokeLinecap="round" />}
        <circle cx="70" cy="70" r="5" className="fill-foreground" />
        <text x="10" y="79" className="fill-muted-foreground" fontSize="9">2%</text>
        <text x="118" y="79" className="fill-muted-foreground" fontSize="9">6%+</text>
      </svg>
      <div>
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><TrendingUp className="h-3 w-3" />Bruttorendite</p>
        <p className="text-lg font-bold leading-tight">{range(min, max, "", " %", 1)}</p>
        <p className="text-[11px] font-medium text-primary">{label}</p>
        <p className="text-[10px] text-muted-foreground">Benchmark CH: 3.5–4.5 %</p>
      </div>
    </div>
  );
}

export function MarketScale({ comparison }: { comparison?: string }) {
  const pos = comparison === "below_market" ? 16 : comparison === "at_market" ? 50 : comparison === "above_market" ? 84 : null;
  return (
    <div>
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, var(--chart-1), var(--chart-2), var(--chart-4))" }}>
        {pos != null && <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow" style={{ left: `${pos}%` }} />}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>Unter Markt</span><span>Marktgerecht</span><span>Über Markt</span></div>
    </div>
  );
}
