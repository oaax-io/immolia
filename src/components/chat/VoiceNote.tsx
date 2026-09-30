import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Send, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "";
}

/** Aufnahmeknopf für Sprachnotizen. Liefert beim Senden eine fertige Audiodatei. */
export function VoiceRecorder({ onRecorded, disabled }: { onRecorded: (file: File) => void | Promise<void>; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  };

  useEffect(() => () => cleanup(), []);

  const start = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Dieser Browser unterstützt keine Sprachaufnahme.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const cancelled = cancelRef.current;
        cleanup();
        if (cancelled || blob.size === 0) return;
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `Sprachnotiz-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`, { type });
        setBusy(true);
        try {
          await onRecorded(file);
        } finally {
          setBusy(false);
        }
      };
      recRef.current = rec;
      streamRef.current = stream;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Kein Zugriff auf das Mikrofon.");
    }
  };

  const stop = (cancel: boolean) => {
    cancelRef.current = cancel;
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else cleanup();
  };

  if (!recording) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        title="Sprachnotiz aufnehmen"
        aria-label="Sprachnotiz aufnehmen"
        disabled={disabled || busy}
        onClick={start}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
      <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
      <span className="min-w-9 text-xs tabular-nums text-foreground">{fmt(seconds)}</span>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="Aufnahme verwerfen" onClick={() => stop(true)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" className="h-7 w-7" title="Sprachnotiz senden" onClick={() => stop(false)}>
        <Send className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** Abspieler für Sprachnotizen / Audiodateien im Chatverlauf. */
export function VoiceNotePlayer({ url, name }: { url: string | null; name: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    setPlaying(false);
    setCur(0);
  }, [url]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return (
    <div className="flex w-56 items-center gap-2 rounded-md border bg-background px-2 py-1.5">
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={toggle} title={playing ? "Pause" : "Abspielen"} disabled={!url}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={dur || 0}
          step={0.1}
          value={Math.min(cur, dur || 0)}
          disabled={!url || !dur}
          onChange={(e) => {
            const v = Number(e.target.value);
            setCur(v);
            if (audioRef.current) audioRef.current.currentTime = v;
          }}
          className="h-1 w-full cursor-pointer accent-primary"
          aria-label={`Sprachnotiz ${name}`}
        />
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="tabular-nums">{fmt(cur)}</span>
          <span className="tabular-nums">{dur ? fmt(dur) : "--:--"}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={cycleRate}
        className={cn("shrink-0 rounded px-1 text-[10px] font-medium text-muted-foreground hover:bg-muted", rate !== 1 && "text-foreground")}
        title="Abspielgeschwindigkeit"
      >
        {rate}×
      </button>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCur(0);
          }}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            setDur(Number.isFinite(d) ? d : 0);
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDur(d);
          }}
        />
      )}
    </div>
  );
}
