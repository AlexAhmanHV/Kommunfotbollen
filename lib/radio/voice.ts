// Uppläsning (ElevenLabs) och lagring (Supabase Storage) av Matchradion.
// Båda via fetch — inga SDK:er behövs för två anrop.

const TTS_MODEL = "eleven_multilingual_v2";
const BUCKET = "radio";

/** Manus → MP3 med vald röst. */
export async function synthesize(text: string, apiKey: string, voiceId: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

/** Billig förkontroll innan betalda anrop: true om bucketen nås, annars HTTP-status (0 = nätverksfel). */
export async function storageReachable(supabaseUrl: string, serviceKey: string): Promise<true | number> {
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/bucket/${BUCKET}`, {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
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
  });
  if (!res.ok) throw new Error(`Supabase Storage ${res.status}: ${await res.text()}`);
  // ?v= eftersom ett omgjort avsnitt återanvänder filnamnet (annars serveras gammalt ljud ur cache)
  return `${base}/storage/v1/object/public/${path}?v=${Date.now()}`;
}
