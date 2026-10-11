import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINE_CHARS, parseDialogue } from "./dialogue";

describe("parseDialogue", () => {
  it("delar upp repliker i ordning", () => {
    const lines = parseDialogue("Tommy: Välkomna!\nPeter: Tack, Tommy.\nTommy: Nu kör vi.");
    assert.deepEqual(lines, [
      { speaker: "Tommy", text: "Välkomna!" },
      { speaker: "Peter", text: "Tack, Tommy." },
      { speaker: "Tommy", text: "Nu kör vi." },
    ]);
  });

  it("ignorerar tomma rader och CRLF", () => {
    const lines = parseDialogue("Tommy: Hej.\r\n\r\n\nPeter: Hej hej.\r\n");
    assert.equal(lines.length, 2);
  });

  it("normaliserar skiftläge och blanksteg i talaren", () => {
    const lines = parseDialogue("  tommy :  Hej.  \nPETER:Hej hej.");
    assert.deepEqual(lines, [
      { speaker: "Tommy", text: "Hej." },
      { speaker: "Peter", text: "Hej hej." },
    ]);
  });

  it("behåller kolon i själva repliken", () => {
    const lines = parseDialogue("Tommy: Tabellen: Vimmerby leder.\nPeter: Ja.");
    assert.equal(lines[0].text, "Tabellen: Vimmerby leder.");
  });

  it("avvisar en rad utan känd talare", () => {
    assert.throws(() => parseDialogue("Tommy: Hej.\nPeter: Hej.\nOch så var det slut."), /talare/);
    assert.throws(() => parseDialogue("Tommy: Hej.\nAnna: Hej."), /talare/);
  });

  it("avvisar en rad med två talare", () => {
    assert.throws(() => parseDialogue("Tommy: Hej. Peter: Tack!\nPeter: Ja."), /talare/);
    assert.throws(() => parseDialogue("Tommy: Hej.\nPeter: Ja, tommy : precis."), /talare/);
  });

  it("avvisar prototypnycklar som talare", () => {
    assert.throws(() => parseDialogue("Tommy: Hej.\nPeter: Hej.\nconstructor: x"), /talare/);
    assert.throws(() => parseDialogue("Tommy: Hej.\nPeter: Hej.\n__proto__: x"), /talare/);
  });

  it("tål markdown-betoning runt talaren", () => {
    const lines = parseDialogue("**Tommy:** Hej.\n*Peter*: Hej hej.\n__Tommy__: Nu kör vi.");
    assert.deepEqual(lines, [
      { speaker: "Tommy", text: "Hej." },
      { speaker: "Peter", text: "Hej hej." },
      { speaker: "Tommy", text: "Nu kör vi." },
    ]);
  });

  it("avvisar en tom replik", () => {
    assert.throws(() => parseDialogue("Tommy: Hej.\nPeter:   "), /tom/);
  });

  it("godkänner 400 tecken men inte 401", () => {
    const ok = "a".repeat(MAX_LINE_CHARS);
    assert.equal(parseDialogue(`Tommy: ${ok}\nPeter: Ja.`)[0].text.length, 400);
    assert.throws(() => parseDialogue(`Tommy: ${ok}a\nPeter: Ja.`), /lång/);
  });

  it("kräver att båda värdarna pratar", () => {
    assert.throws(() => parseDialogue("Tommy: Hej.\nTommy: Igen."), /båda/);
    assert.throws(() => parseDialogue(""), /båda/);
  });
});
