// Matchradions manus är en dialog: en replik per rad, "Tommy: …" eller
// "Peter: …". Parsern är strikt — en rad som inte går att tillskriva en
// värd får aldrig läsas upp med fel röst eller tappas tyst.

export type Speaker = "Tommy" | "Peter";
export type DialogueLine = { speaker: Speaker; text: string };

export const MAX_LINE_CHARS = 250;

const SPEAKERS: Record<string, Speaker> = { tommy: "Tommy", peter: "Peter" };
const LINE = /^\s*([^:]+?)\s*:\s*(.*?)\s*$/;

export function parseDialogue(script: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  for (const raw of script.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const m = LINE.exec(raw);
    const speaker = m ? SPEAKERS[m[1].toLowerCase()] : undefined;
    if (!m || !speaker) throw new Error(`okänd talare på raden: ${raw.slice(0, 60)}`);
    const text = m[2];
    if (text === "") throw new Error(`tom replik för ${speaker}`);
    if (text.length > MAX_LINE_CHARS) {
      throw new Error(`för lång replik för ${speaker} (${text.length} tecken)`);
    }
    lines.push({ speaker, text });
  }
  const speakers = new Set(lines.map((l) => l.speaker));
  if (speakers.size < 2) throw new Error("båda värdarna måste prata i dialogen");
  return lines;
}
