import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ttsRequests } from "./voice";

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
