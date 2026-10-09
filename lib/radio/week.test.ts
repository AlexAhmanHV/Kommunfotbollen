import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lastCompletedWeek } from "./week";

describe("lastCompletedWeek", () => {
  it("måndag kväll ger veckan som just tog slut", () => {
    const w = lastCompletedWeek(new Date("2026-10-12T21:30:00Z")); // mån 23:30 svensk tid
    assert.equal(w.key, "2026-W41");
    assert.equal(w.start.toISOString(), "2026-10-04T22:00:00.000Z");
    assert.equal(w.end.toISOString(), "2026-10-11T22:00:00.000Z");
  });

  it("söndag kväll ger veckan före den pågående", () => {
    const w = lastCompletedWeek(new Date("2026-10-11T20:00:00Z")); // sön 22:00 svensk tid
    assert.equal(w.key, "2026-W40");
    assert.equal(w.start.toISOString(), "2026-09-27T22:00:00.000Z");
    assert.equal(w.end.toISOString(), "2026-10-04T22:00:00.000Z");
  });

  it("räknar datum i svensk tid, inte UTC", () => {
    // sön 22:30 UTC = mån 00:30 svensk tid → vecka 41 är avslutad
    assert.equal(lastCompletedWeek(new Date("2026-10-11T22:30:00Z")).key, "2026-W41");
  });

  it("veckan med övergång till vintertid slutar en timme senare i UTC", () => {
    const w = lastCompletedWeek(new Date("2026-10-27T12:00:00Z"));
    assert.equal(w.key, "2026-W43");
    assert.equal(w.start.toISOString(), "2026-10-18T22:00:00.000Z");
    assert.equal(w.end.toISOString(), "2026-10-25T23:00:00.000Z");
  });

  it("vecka 53 över årsskiftet hör till det gamla året", () => {
    const w = lastCompletedWeek(new Date("2027-01-05T12:00:00Z"));
    assert.equal(w.key, "2026-W53");
    assert.equal(w.start.toISOString(), "2026-12-27T23:00:00.000Z");
    assert.equal(w.end.toISOString(), "2027-01-03T23:00:00.000Z");
  });

  it("första veckan på nya året", () => {
    assert.equal(lastCompletedWeek(new Date("2027-01-12T12:00:00Z")).key, "2027-W01");
  });
});
