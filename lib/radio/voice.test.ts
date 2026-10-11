import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripMp3Headers, synthesizeDialogue, ttsRequests } from "./voice";

const VOICES = { Tommy: "voice-tommy", Peter: "voice-peter" };

describe("ttsRequests", () => {
  it("en förfrågan per replik med rätt röst och grannarnas text", () => {
    const reqs = ttsRequests(
      [
        { speaker: "Tommy", text: "Ett." },
        { speaker: "Peter", text: "Två." },
        { speaker: "Tommy", text: "Tre." },
      ],
      VOICES,
    );
    assert.deepEqual(
      reqs.map((r) => r.voiceId),
      ["voice-tommy", "voice-peter", "voice-tommy"],
    );
    assert.deepEqual(reqs[1].body, {
      text: "Två.",
      model_id: "eleven_multilingual_v2",
      previous_text: "Ett.",
      next_text: "Tre.",
    });
  });

  it("utelämnar previous_text först och next_text sist", () => {
    const reqs = ttsRequests(
      [
        { speaker: "Tommy", text: "Ett." },
        { speaker: "Peter", text: "Två." },
      ],
      VOICES,
    );
    assert.equal("previous_text" in reqs[0].body, false);
    assert.equal(reqs[0].body.next_text, "Två.");
    assert.equal(reqs[1].body.previous_text, "Ett.");
    assert.equal("next_text" in reqs[1].body, false);
  });
});

const JINGLE = new Uint8Array(readFileSync("public/radio/jingle.mp3"));
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("stripMp3Headers", () => {
  it("tar bort ID3-taggen och Info-ramen från en riktig MP3", () => {
    // Förutsättning: jingeln har både ID3-tagg och Info-ram
    assert.equal(latin1(JINGLE.subarray(0, 3)), "ID3");
    assert.ok(latin1(JINGLE.subarray(0, 600)).includes("Info"));

    const out = stripMp3Headers(JINGLE);
    assert.notEqual(latin1(out.subarray(0, 3)), "ID3");
    assert.equal(out[0], 0xff);
    assert.equal(out[1] & 0xe0, 0xe0);
    // Första ramen (128 kbit/s, 44,1 kHz = 417 byte) bär ingen Xing/Info-tagg
    const first = latin1(out.subarray(0, 417));
    assert.ok(!first.includes("Xing") && !first.includes("Info"));
    assert.ok(out.length < JINGLE.length);
  });

  it("lämnar en buffert utan ID3/Info orörd", () => {
    const plain = stripMp3Headers(JINGLE);
    assert.deepEqual(stripMp3Headers(plain), plain);
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    assert.deepEqual(stripMp3Headers(junk), junk);
  });
});

function stubFetch(responses: (() => Response)[]): { calls: number; restore: () => void } {
  const original = globalThis.fetch;
  const stub = { calls: 0, restore: () => (globalThis.fetch = original) };
  globalThis.fetch = (async () => responses[stub.calls++]()) as typeof fetch;
  return stub;
}

const LINES = [
  { speaker: "Tommy" as const, text: "Ett." },
  { speaker: "Peter" as const, text: "Två." },
  { speaker: "Tommy" as const, text: "Tre." },
];

describe("synthesizeDialogue", () => {
  it("sätter ihop replikerna i ordning", async () => {
    const stub = stubFetch([
      () => new Response(new Uint8Array([1, 2])),
      () => new Response(new Uint8Array([3])),
      () => new Response(new Uint8Array([4, 5])),
    ]);
    try {
      const out = await synthesizeDialogue(LINES, "key", VOICES);
      assert.deepEqual([...new Uint8Array(out)], [1, 2, 3, 4, 5]);
      assert.equal(stub.calls, 3);
    } finally {
      stub.restore();
    }
  });

  it("skalar ID3/Info från varje klipp, även det första", async () => {
    const stub = stubFetch([() => new Response(JINGLE), () => new Response(JINGLE), () => new Response(JINGLE)]);
    try {
      const out = new Uint8Array(await synthesizeDialogue(LINES, "key", VOICES));
      const clip = stripMp3Headers(JINGLE);
      assert.equal(out.length, clip.length * 3);
      assert.equal(out[0], 0xff);
      assert.ok(!latin1(out).includes("ID3"));
    } finally {
      stub.restore();
    }
  });

  it("kastar vid fel och hämtar inga fler repliker", async () => {
    const stub = stubFetch([
      () => new Response(new Uint8Array([1])),
      () => new Response("nope", { status: 400 }),
      () => new Response(new Uint8Array([3])),
    ]);
    try {
      await assert.rejects(synthesizeDialogue(LINES, "key", VOICES), /400/);
      assert.equal(stub.calls, 2);
    } finally {
      stub.restore();
    }
  });
});
