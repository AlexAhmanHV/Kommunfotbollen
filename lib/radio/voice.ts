// Uppläsning (ElevenLabs, en replik i taget) och lagring (Supabase Storage)
// av Matchradion. Båda via fetch — inga SDK:er behövs.

import type { DialogueLine, Speaker } from "./dialogue";

const TTS_MODEL = "eleven_multilingual_v2";
const BUCKET = "radio";
// Ett anrop som hänger får inte låsa kvällsjobbet.
const TTS_TIMEOUT_MS = 120_000;
const STORAGE_TIMEOUT_MS = 30_000;

type TtsBody = { text: string; model_id: string; previous_text?: string; next_text?: string };

/** En TTS-förfrågan per replik. Grannreplikernas text skickas med så att
 * intonationen hänger ihop över växlingarna. */
export function ttsRequests(
  lines: DialogueLine[],
  voices: Record<Speaker, string>,
): { voiceId: string; body: TtsBody }[] {
  return lines.map((line, i) => {
    const body: TtsBody = { text: line.text, model_id: TTS_MODEL };
    if (i > 0) body.previous_text = lines[i - 1].text;
    if (i < lines.length - 1) body.next_text = lines[i + 1].text;
    return { voiceId: voices[line.speaker], body };
  });
}

/** Dialog → en MP3: replik för replik i ordning, svaren ihopsatta. Ett fel i
 * någon replik kastar — ett avsnitt med halva dialogen får aldrig sändas. */
export async function synthesizeDialogue(
  lines: DialogueLine[],
  apiKey: string,
  voices: Record<Speaker, string>,
): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  for (const { voiceId, body } of ttsRequests(lines, voices)) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
    parts.push(new Uint8Array(await res.arrayBuffer()));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out.buffer;
}

/** Billig förkontroll innan betalda anrop: true om bucketen nås, annars HTTP-status (0 = nätverksfel). */
export async function storageReachable(supabaseUrl: string, serviceKey: string): Promise<true | number> {
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/bucket/${BUCKET}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
    return res.ok ? true : res.status;
  } catch {
    return 0;
  }
}

/** Laddar upp avsnittet till den publika bucketen och returnerar dess URL (med cache-bust). */
export async function uploadAudio(
  key: string,
  audio: ArrayBuffer,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string> {
  const base = supabaseUrl.replace(/\/+$/, "");
  const path = `${BUCKET}/${key}.mp3`;
  const res = await fetch(`${base}/storage/v1/object/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: audio,
    signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Supabase Storage ${res.status}: ${await res.text()}`);
  // ?v= eftersom ett omgjort avsnitt återanvänder filnamnet (annars serveras gammalt ljud ur cache)
  return `${base}/storage/v1/object/public/${path}?v=${Date.now()}`;
}
