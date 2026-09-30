import { supabase } from "@/integrations/supabase/client";

export type CallRow = {
  id: string;
  room_name: string;
  title: string | null;
  context_type: string;
  context_id: string | null;
  created_by: string;
  participants: string[];
  status: string;
  started_at: string;
  ended_at: string | null;
};

/** Wie lange ein eingehender Anruf klingelt, bevor er als verpasst gilt. */
export const CALL_RING_MS = 45_000;

/** Raumname für ein 1:1-Gespräch – für beide Seiten identisch. */
export function chatRoomName(a: string, b: string) {
  return `chat-${[a, b].sort().join("--")}`;
}

/** Anruf starten: erzeugt eine klingelnde Zeile, die der Gegenseite live zugestellt wird. */
export async function startCall(opts: {
  room: string;
  callerId: string;
  calleeId: string;
  title?: string | null;
}): Promise<CallRow | null> {
  const { data, error } = await supabase
    .from("video_calls")
    .insert({
      room_name: opts.room,
      title: opts.title ?? null,
      context_type: "chat",
      created_by: opts.callerId,
      participants: [opts.callerId, opts.calleeId],
      status: "ringing",
    } as never)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CallRow) ?? null;
}

/** Zustand eines Anrufs setzen (angenommen / abgelehnt / beendet / verpasst). */
export async function setCallStatus(
  id: string,
  status: "accepted" | "declined" | "ended" | "missed",
) {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "ended" || status === "declined" || status === "missed") {
    patch.ended_at = new Date().toISOString();
  }
  let q = supabase.from("video_calls").update(patch as never).eq("id", id);
  // Klingel-Endzustände nur aus "ringing" heraus setzen: ein später Timeout überschreibt
  // nie ein bereits angenommenes/beendetes Gespräch (Rennen Anrufer ↔ Empfänger).
  if (status === "missed" || status === "declined" || status === "accepted") q = q.eq("status", "ringing");
  await q;
}

/** Kurzer, wiederholter Klingelton ohne Audiodatei. */
export function createRingtone() {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const beep = () => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.65);
  };

  return {
    start() {
      try {
        const Ctor =
          (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
            .AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        void ctx.resume();
        beep();
        timer = setInterval(beep, 1800);
      } catch {
        /* Ton ist optional */
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        void ctx?.close();
      } catch {
        /* ignorieren */
      }
      ctx = null;
    },
  };
}
