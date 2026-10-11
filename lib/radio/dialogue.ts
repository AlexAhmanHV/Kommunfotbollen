// Matchradions manus är en dialog: en replik per rad, "Tommy: …" eller
// "Peter: …". Parsern är strikt — en rad som inte går att tillskriva en
// värd får aldrig läsas upp med fel röst eller tappas tyst.

export type Speaker = "Tommy" | "Peter";
export type DialogueLine = { speaker: Speaker; text: string };

// Rymmer ett ordagrant citat på 200 tecken plus vem som sa det och källan.
export const MAX_LINE_CHARS = 400;

// Map, inte objekt — annars blir "constructor" och "__proto__" talare.
const SPEAKERS = new Map<string, Speaker>([
  ["tommy", "Tommy"],
  ["peter", "Peter"],
]);
// Markdown-betoning (* och _) runt talaren och kolonet tolereras: "**Tommy:**", "*Peter*:".
const LINE = /^\s*[*_]*\s*([^:*_]+?)\s*[*_]*\s*:\s*[*_]*\s*(.*?)\s*$/;
// En annan talares prefix inne i repliken = två repliker på samma rad.
const OTHER_SPEAKER = /\b(tommy|peter)\s*:/i;

export function parseDialogue(script: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  for (const raw of script.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const m = LINE.exec(raw);
    const speaker = m ? SPEAKERS.get(m[1].toLowerCase()) : undefined;
    if (!m || !speaker) throw new Error(`okänd talare på raden: ${raw.slice(0, 60)}`);
    const text = m[2];
    if (text === "") throw new Error(`tom replik för ${speaker}`);
    if (OTHER_SPEAKER.test(text)) throw new Error(`flera talare på samma rad: ${raw.slice(0, 60)}`);
    if (text.length > MAX_LINE_CHARS) {
      throw new Error(`för lång replik för ${speaker} (${text.length} tecken)`);
    }
    lines.push({ speaker, text });
  }
  const speakers = new Set(lines.map((l) => l.speaker));
  if (speakers.size < 2) throw new Error("båda värdarna måste prata i dialogen");
  return lines;
}
