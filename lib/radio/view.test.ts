import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { radioView } from "./view";

describe("radioView", () => {
  it("ger veckonummer och datumspann måndag–söndag i svensk tid", () => {
    const view = radioView({
      id: "2026-W40",
      weekStart: new Date("2026-09-27T22:00:00Z"),
      script: "Manus",
      audioUrl: "https://example.test/radio/2026-W40.mp3",
    });
    assert.equal(view.title, "Vecka 40");
    assert.equal(view.dateLabel, "28 sep. – 4 okt.");
    assert.equal(view.script, "Manus");
    assert.equal(view.audioUrl, "https://example.test/radio/2026-W40.mp3");
  });

  it("landar på söndagen även veckan sommartiden slutar", () => {
    const view = radioView({
      id: "2026-W43",
      weekStart: new Date("2026-10-18T22:00:00Z"),
      script: "",
      audioUrl: "",
    });
    assert.equal(view.dateLabel, "19 okt. – 25 okt.");
  });
});
