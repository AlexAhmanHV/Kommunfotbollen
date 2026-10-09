// Genererar Matchradions statiska ljud en gång med ElevenLabs Sound Effects.
// Kör: npm run radio:sounds            (båda)
//      npm run radio:sounds -- crowd   (bara en)
// Lyssna, kör om tills det låter rätt och checka in filerna i public/radio/.
// Varje körning kostar ElevenLabs-krediter.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SOUNDS = {
  jingle: {
    text: "Short upbeat sports radio jingle, punchy brass stab and drum hit, energetic, clean ending, no vocals",
    duration_seconds: 4,
    loop: false,
  },
  crowd: {
    text: "Ambient crowd at a small outdoor amateur football match, a few hundred spectators, murmur and distant cheering, no music, no announcer",
    duration_seconds: 20,
    loop: true,
  },
};

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY saknas i .env");
  process.exit(1);
}

const OUT = path.join(process.cwd(), "public", "radio");
mkdirSync(OUT, { recursive: true });
const wanted = process.argv.slice(2);

for (const [name, body] of Object.entries(SOUNDS)) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, prompt_influence: 0.5 }),
  });
  if (!res.ok) {
    console.error(`${name}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const file = path.join(OUT, `${name}.mp3`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`Skrev ${file}`);
}
