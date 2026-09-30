import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, ChevronDown, UserPlus, Users, Building2, CalendarDays, CheckSquare,
  Upload, Mic, MicOff, Sun, Moon, Cloud, CloudRain, CloudSnow, CloudLightning,
  CloudFog, CloudSun,
} from "lucide-react";
import { toast } from "sonner";

/* ---------------- Tageszeit ---------------- */

type Phase = "morning" | "day" | "evening" | "night";

function currentPhase(d = new Date()): Phase {
  const h = d.getHours();
  if (h >= 6 && h < 9) return "morning";
  if (h >= 9 && h < 17) return "day";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

const GREETING: Record<Phase, string> = {
  morning: "Guten Morgen",
  day: "Guten Tag",
  evening: "Guten Abend",
  night: "Gute Nacht",
};

const SUBLINE: Record<Phase, string[]> = {
  morning: [
    "Schön, dich wiederzusehen! Bereit für einen erfolgreichen Tag? Schau, was heute ansteht – ich helfe dir gerne.",
    "Frisch gestartet: Ich habe deinen Tag schon sortiert. Sag mir einfach, womit wir beginnen.",
  ],
  day: [
    "Schön, dass du da bist! Hier ist dein Überblick – erledigen wir gemeinsam die wichtigsten Punkte.",
    "Mitten im Tag: Ich habe im Blick, was liegen bleibt. Sag mir, wobei ich helfen darf.",
  ],
  evening: [
    "Schön, dich zu sehen! Schliessen wir den Tag erfolgreich ab – hier sind deine letzten Pendenzen.",
    "Der Tag klingt aus. Ich zeige dir, was noch offen ist, damit du ruhig Feierabend machen kannst.",
  ],
  night: [
    "Noch so spät aktiv? Schön, dich zu sehen! Ich halte dir den Rücken frei – schau, was offen ist.",
    "Späte Stunde, volle Konzentration. Ich helfe dir gerne, den letzten Punkt noch zu erledigen.",
  ],
};

/* ---------------- Wetter (Open-Meteo, ohne Schlüssel) ---------------- */

type Weather = { temp: number; code: number; place: string };

function weatherLabel(code: number, night: boolean) {
  if (code === 0) return night ? "Klar" : "Sonnig";
  if (code <= 2) return "Leicht bewölkt";
  if (code === 3) return "Bedeckt";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 57) return "Nieselregen";
  if (code >= 61 && code <= 67) return "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Regenschauer";
  if (code >= 85 && code <= 86) return "Schneeschauer";
  if (code >= 95) return "Gewitter";
  return "Wetter";
}

function weatherIcon(code: number, night: boolean) {
  if (code === 0) return night ? Moon : Sun;
  if (code <= 2) return night ? Cloud : CloudSun;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 85 && code <= 86) return CloudSnow;
  if (code >= 95) return CloudLightning;
  if (code >= 51) return CloudRain;
  return Cloud;
}

const HERO_BG: Record<Phase, string> = {
  morning:
    "from-amber-200/70 via-rose-100/60 to-sky-100/70 dark:from-amber-500/20 dark:via-rose-500/10 dark:to-sky-700/20",
  day:
    "from-sky-200/70 via-cyan-100/60 to-blue-100/70 dark:from-sky-600/25 dark:via-cyan-600/10 dark:to-blue-800/25",
  evening:
    "from-orange-200/70 via-rose-200/60 to-indigo-200/70 dark:from-orange-500/20 dark:via-rose-600/15 dark:to-indigo-800/30",
  night:
    "from-indigo-300/60 via-slate-300/50 to-slate-200/70 dark:from-indigo-950 dark:via-slate-900 dark:to-slate-950",
};

function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (lat: number, lon: number, place: string) => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,
        );
        if (!res.ok) return;
        const json: any = await res.json();
        const temp = json?.current?.temperature_2m;
        const code = json?.current?.weather_code;
        if (cancelled || typeof temp !== "number") return;
        setWeather({ temp: Math.round(temp), code: Number(code ?? 0), place });
      } catch {
        /* Wetter ist rein dekorativ – Fehler bleiben still */
      }
    };

    // Standard: Zürich. Falls der Browser den Standort freigibt, genauer.
    void load(47.3769, 8.5417, "Zürich");
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => void load(pos.coords.latitude, pos.coords.longitude, "Dein Standort"),
        () => {},
        { timeout: 6000, maximumAge: 30 * 60 * 1000 },
      );
    }
    return () => { cancelled = true; };
  }, []);

  return weather;
}

/* ---------------- Sprachbefehle ---------------- */

type Command = { keywords: string[]; to: string; say: string };

const COMMANDS: Command[] = [
  { keywords: ["lead"], to: "/leads", say: "Alles klar, ich öffne die Leads." },
  { keywords: ["kunde", "kundin", "kunden", "kontakt"], to: "/clients", say: "Gut, ich öffne die Kunden." },
  { keywords: ["immobilie", "objekt", "liegenschaft", "wohnung", "haus"], to: "/properties", say: "Ich öffne die Immobilien." },
  { keywords: ["termin", "kalender", "besichtigung"], to: "/appointments", say: "Ich öffne den Kalender." },
  { keywords: ["aufgabe", "pendenz", "task"], to: "/tasks", say: "Ich öffne die Aufgaben." },
  { keywords: ["dokument", "unterlage", "datei"], to: "/documents", say: "Ich öffne die Dokumente." },
  { keywords: ["finanzierung", "dossier", "bank"], to: "/financing", say: "Ich öffne die Finanzierungen." },
  { keywords: ["matching", "treffer", "suchprofil"], to: "/matching", say: "Ich öffne das Matching." },
  { keywords: ["reservation", "reservierung"], to: "/reservations", say: "Ich öffne die Reservationen." },
  { keywords: ["provision", "kommission"], to: "/commissions", say: "Ich öffne die Provisionen." },
  { keywords: ["exposé", "expose"], to: "/exposes", say: "Ich öffne die Exposés." },
  { keywords: ["mandat"], to: "/mandates", say: "Ich öffne die Mandate." },
  { keywords: ["auswertung", "analytics", "statistik"], to: "/analytics", say: "Ich öffne die Auswertungen." },
  { keywords: ["einstellung", "profil"], to: "/settings", say: "Ich öffne die Einstellungen." },
];

/** Spricht Text und löst erst aus, wenn die Stimme fertig ist (mit Sicherheits-Timeout). */
function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const synth = window.speechSynthesis;
      if (!synth) return finish();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-CH";
      u.rate = 1.02;
      const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith("de"));
      if (voice) u.voice = voice;
      u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
      window.setTimeout(finish, Math.max(2500, text.length * 90));
    } catch {
      finish();
    }
  });
}

/* ---------------- Tipp-Effekt ---------------- */

function useTypewriter(lines: string[]) {
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState("");
  useEffect(() => {
    const full = lines[idx % lines.length] ?? "";
    let i = 0;
    let t: number;
    const type = () => {
      i++;
      setText(full.slice(0, i));
      if (i < full.length) t = window.setTimeout(type, 22 + Math.random() * 40);
      else t = window.setTimeout(() => setIdx((n) => n + 1), 9000);
    };
    setText("");
    t = window.setTimeout(type, 300);
    return () => window.clearTimeout(t);
  }, [idx, lines]);
  return text;
}

function matchCommand(text: string): Command | null {
  const t = text.toLowerCase();
  for (const c of COMMANDS) {
    if (c.keywords.some((k) => t.includes(k))) return c;
  }
  return null;
}

/* ---------------- Komponente ---------------- */

export function DashboardHero({ displayName }: { displayName?: string }) {
  const navigate = useNavigate();
  const weather = useWeather();
  const [phase, setPhase] = useState<Phase>(() => currentPhase());
  const [listening, setListening] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const [heard, setHeard] = useState("");
  const recRef = useRef<any>(null);
  const silenceRef = useRef<number | null>(null);
  const handledRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setPhase(currentPhase()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const night = phase === "night" || phase === "evening";
  const lines = useMemo(() => {
    const list = SUBLINE[phase];
    const start = new Date().getDate() % list.length;
    return [...list.slice(start), ...list.slice(0, start)];
  }, [phase]);
  const typed = useTypewriter(lines);

  const WIcon = weather ? weatherIcon(weather.code, night) : null;

  const clearSilence = () => {
    if (silenceRef.current) window.clearTimeout(silenceRef.current);
    silenceRef.current = null;
  };

  useEffect(() => () => {
    activeRef.current = false;
    clearSilence();
    try { recRef.current?.abort?.(); } catch { /* egal */ }
    try { window.speechSynthesis?.cancel(); } catch { /* egal */ }
  }, []);

  const stopListening = () => {
    activeRef.current = false;
    clearSilence();
    try { recRef.current?.stop?.(); } catch { /* egal */ }
    try { window.speechSynthesis?.cancel(); } catch { /* egal */ }
    setListening(false);
    setGreeting(false);
  };

  const handleText = (text: string) => {
    if (handledRef.current || !text.trim()) return;
    handledRef.current = true;
    stopListening();
    const cmd = matchCommand(text);
    if (cmd) {
      void speak(cmd.say);
      toast.success(cmd.say, { description: `Verstanden: „${text.trim()}“` });
      void navigate({ to: cmd.to as never });
    } else {
      void speak("Das habe ich leider nicht verstanden. Sag zum Beispiel: neuer Lead oder neue Immobilie.");
      toast("Befehl nicht erkannt", { description: `Verstanden: „${text.trim()}“` });
    }
    window.setTimeout(() => setHeard(""), 4000);
  };

  const startListening = async () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Spracheingabe wird von diesem Browser nicht unterstützt.", {
        description: "Bitte Chrome, Edge oder Safari verwenden.",
      });
      return;
    }
    // Mikrofon früh freigeben lassen, damit kein Dialog die Aufnahme abbricht
    try {
      const s = await navigator.mediaDevices?.getUserMedia?.({ audio: true });
      s?.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error("Kein Zugriff auf das Mikrofon.", { description: "Bitte im Browser erlauben." });
      return;
    }

    activeRef.current = true;
    handledRef.current = false;
    setHeard("");
    setGreeting(true);
    setListening(true);
    await speak(`Hallo ${displayName || "zusammen"}, wie kann ich dir helfen?`);
    if (!activeRef.current) return;
    setGreeting(false);

    const rec = new SR();
    recRef.current = rec;
    rec.lang = "de-CH";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    let latest = "";

    const armSilence = (ms: number) => {
      clearSilence();
      silenceRef.current = window.setTimeout(() => {
        if (latest.trim()) handleText(latest);
        else {
          stopListening();
          toast("Ich habe nichts gehört", { description: "Tippe nochmals aufs Mikrofon und sprich deinen Befehl." });
        }
      }, ms);
    };

    rec.onstart = () => armSilence(10000); // 10 s Zeit zum Anfangen
    rec.onerror = (e: any) => {
      if (e?.error === "no-speech" || e?.error === "aborted") return;
      stopListening();
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        toast.error("Kein Zugriff auf das Mikrofon.", { description: "Bitte im Browser erlauben." });
      }
    };
    rec.onend = () => {
      // Browser beendet manchmal früh – solange aktiv, neu starten
      if (activeRef.current && !handledRef.current) {
        try { rec.start(); } catch { /* egal */ }
      }
    };
    rec.onresult = (event: any) => {
      let text = "";
      let final = false;
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
        if (event.results[i].isFinal) final = true;
      }
      latest = text;
      setHeard(text);
      if (final && matchCommand(text)) { clearSilence(); handleText(text); return; }
      armSilence(2200); // nach kurzer Sprechpause auswerten
    };

    try { rec.start(); } catch { /* bereits aktiv */ }
  };

  return (
    <div className={`relative mb-4 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br ${HERO_BG[phase]} px-5 py-4 shadow-sm`}>
      {/* Atmosphäre */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {phase === "night" ? (
          <>
            <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-slate-100/70 blur-2xl dark:bg-slate-300/20" />
            {[
              [12, 18], [28, 55], [44, 22], [62, 68], [76, 34], [88, 60], [55, 12], [34, 80],
            ].map(([l, t], i) => (
              <span
                key={i}
                className="absolute h-1 w-1 animate-pulse rounded-full bg-white/80 dark:bg-white/70"
                style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${i * 0.4}s` }}
              />
            ))}
          </>
        ) : (
          <div className="absolute -right-8 -top-10 h-44 w-44 rounded-full bg-amber-200/60 blur-3xl dark:bg-amber-400/20" />
        )}
        {weather && (weather.code >= 51 && weather.code <= 82) && (
          [10, 24, 38, 52, 66, 80, 92].map((l, i) => (
            <span
              key={l}
              className="absolute top-0 h-8 w-px animate-[fall_1.6s_linear_infinite] bg-gradient-to-b from-transparent via-sky-400/40 to-transparent"
              style={{ left: `${l}%`, animationDelay: `${i * 0.22}s` }}
            />
          ))
        )}
      </div>

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
            <span className="truncate">
              {GREETING[phase]}{displayName ? `, ${displayName}` : ""}
            </span>
            <span className="inline-block origin-[70%_80%] animate-[wave_2.2s_ease-in-out_infinite] text-2xl">
              {phase === "night" ? "🌙" : "👋"}
            </span>
          </h1>
          <p className="mt-1 min-h-[2.5rem] max-w-2xl text-sm text-muted-foreground">
            {typed}
            <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground/60" />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date().toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          {(listening || heard) && (
            <div className="mt-2 flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 text-xs shadow-sm backdrop-blur animate-fade-in">
              <span className="flex h-4 items-end gap-0.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-0.5 rounded bg-primary"
                    style={{
                      height: listening ? undefined : "4px",
                      animation: listening ? `voicebar 0.9s ease-in-out ${i * 0.12}s infinite` : undefined,
                    }}
                  />
                ))}
              </span>
              <span className="truncate text-muted-foreground">
                {greeting ? "Ich spreche …" : heard ? `„${heard}“` : "Ich höre zu – sprich jetzt …"}
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {weather && WIcon && (
            <div className="hidden items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 text-xs shadow-sm backdrop-blur sm:flex">
              <WIcon className="h-4 w-4 text-primary" />
              <span className="font-semibold tabular-nums">{weather.temp}°C</span>
              <span className="text-muted-foreground">{weatherLabel(weather.code, night)} · {weather.place}</span>
            </div>
          )}

          <span className="relative inline-flex">
            {listening && (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
                <span className="absolute -inset-1 animate-pulse rounded-full bg-primary/20" />
              </>
            )}
            <Button
              size="sm"
              variant={listening ? "default" : "outline"}
              className="relative shrink-0 rounded-full"
              onClick={listening ? stopListening : () => void startListening()}
              aria-label={listening ? "Spracheingabe beenden" : "Spracheingabe starten"}
              title={listening ? "Zuhören beenden" : "Sprich mit Immolia"}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="shrink-0 rounded-full">
                <Plus className="mr-1 h-4 w-4" />
                Neu
                <ChevronDown className="ml-1 h-4 w-4 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Neu erstellen</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link to="/leads"><UserPlus className="mr-2 h-4 w-4" />Neuer Lead</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/clients"><Users className="mr-2 h-4 w-4" />Neuer Kunde</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/properties"><Building2 className="mr-2 h-4 w-4" />Neue Immobilie</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/appointments"><CalendarDays className="mr-2 h-4 w-4" />Neuer Termin</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/tasks"><CheckSquare className="mr-2 h-4 w-4" />Neue Aufgabe</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/documents"><Upload className="mr-2 h-4 w-4" />Dokument hochladen</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
