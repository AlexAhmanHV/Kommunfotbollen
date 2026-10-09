// Uppläsning (ElevenLabs) och lagring (Supabase Storage) av Matchradion.
// Båda via fetch — inga SDK:er behövs för två anrop.

const TTS_MODEL = "eleven_multilingual_v2";
const BUCKET = "radio";

/** Manus → MP3 med vald röst. */
export async function synthesize(text: string, apiKey: string, voiceId: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

/** Laddar upp avsnittet till den publika bucketen och returnerar dess URL. */
export async function uploadAudio(
  key: string,
  audio: ArrayBuffer,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string> {
  const path = `${BUCKET}/${key}.mp3`;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${path}`, {
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
  return `${supabaseUrl}/storage/v1/object/public/${path}`;
}
