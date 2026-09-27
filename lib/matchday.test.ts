import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UiMatch } from "./queries";
import {
  isResultMissing,
  matchdayMode,
  pickFeatured,
  teamSummaries,
  type LocalTeamRow,
  type Standing,
} from "./matchday";

const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const LOCAL = new Set(["L1", "L2"]);

let seq = 0;
function match(p: Partial<UiMatch>): UiMatch {
  seq++;
  return {
    id: `m${seq}`,
    round: null,
    startsAt: at(1),
    status: "UPCOMING",
    homeId: "X1",
    awayId: "X2",
    homeName: "Hemma",
    awayName: "Borta",
    homeLogo: null,
    awayLogo: null,
    homeScore: null,
    awayScore: null,
    leagueId: "lg",
    leagueName: "Division 4 Småland norra",
    ...p,
  };
}

describe("isResultMissing", () => {
  it("kommande match mer än ett dygn efter avspark saknar resultat", () => {
    assert.equal(isResultMissing(match({ startsAt: at(-2) }), NOW), true);
  });
  it("kommande match mindre än ett dygn efter avspark saknar inte resultat än", () => {
    assert.equal(isResultMissing(match({ startsAt: at(-0.5) }), NOW), false);
  });
  it("spelad match saknar aldrig resultat", () => {
    assert.equal(isResultMissing(match({ status: "FINISHED", startsAt: at(-3) }), NOW), false);
  });
});

describe("matchdayMode", () => {
  it("upcoming när en lokal match spelas inom 7 dagar", () => {
    const local = match({ homeId: "L1", startsAt: at(3) });
    const other = match({ startsAt: at(2) });
    const r = matchdayMode([other, local], LOCAL, NOW);
    assert.equal(r.mode, "upcoming");
    assert.deepEqual(r.matches.map((m) => m.id), [local.id]);
  });
  it("exakt 7 dagar fram räknas, en millisekund till gör det inte", () => {
    const edge = match({ homeId: "L1", startsAt: at(7) });
    assert.equal(matchdayMode([edge], LOCAL, NOW).mode, "upcoming");
    const beyond = match({ homeId: "L1", startsAt: new Date(at(7).getTime() + 1) });
    assert.equal(matchdayMode([beyond], LOCAL, NOW).mode, "offseason");
  });
  it("upcoming sorteras efter avspark", () => {
    const later = match({ homeId: "L1", startsAt: at(5) });
    const sooner = match({ awayId: "L2", startsAt: at(1) });
    const r = matchdayMode([later, sooner], LOCAL, NOW);
    assert.deepEqual(r.matches.map((m) => m.id), [sooner.id, later.id]);
  });
  it("recent när inget är kommande men en lokal match spelats senaste 7 dagarna", () => {
    const played = match({ homeId: "L1", status: "FINISHED", startsAt: at(-2), homeScore: 2, awayScore: 1 });
    const r = matchdayMode([played], LOCAL, NOW);
    assert.equal(r.mode, "recent");
    assert.deepEqual(r.matches.map((m) => m.id), [played.id]);
  });
  it("exakt 7 dagar bakåt räknas, en millisekund till gör det inte", () => {
    const edge = match({ homeId: "L1", status: "FINISHED", startsAt: at(-7), homeScore: 0, awayScore: 0 });
    assert.equal(matchdayMode([edge], LOCAL, NOW).mode, "recent");
    const older = match({ homeId: "L1", status: "FINISHED", startsAt: new Date(at(-7).getTime() - 1), homeScore: 0, awayScore: 0 });
    assert.equal(matchdayMode([older], LOCAL, NOW).mode, "offseason");
  });
  it("matcher utan resultat räknas inte", () => {
    const missing = match({ homeId: "L1", startsAt: at(-3) });
    assert.equal(matchdayMode([missing], LOCAL, NOW).mode, "offseason");
  });
  it("offseason utan lokala matcher", () => {
    const r = matchdayMode([], LOCAL, NOW);
    assert.equal(r.mode, "offseason");
    assert.deepEqual(r.matches, []);
  });
});

describe("pickFeatured", () => {
  const standings = new Map<string, Standing>([
    ["L1", { position: 6, pts: 27 }],
    ["L2", { position: 1, pts: 48 }],
  ]);

  it("derby vinner över bättre placerat lag", () => {
    const derby = match({ homeId: "L1", awayId: "L2", startsAt: at(5) });
    const top = match({ homeId: "L2", startsAt: at(1) });
    assert.equal(pickFeatured([top, derby], standings, LOCAL)?.id, derby.id);
  });
  it("flera derbyn: det tidigaste", () => {
    const late = match({ homeId: "L1", awayId: "L2", startsAt: at(6) });
    const early = match({ homeId: "L2", awayId: "L1", startsAt: at(2) });
    assert.equal(pickFeatured([late, early], standings, LOCAL)?.id, early.id);
  });
  it("utan derby: bäst placerade lokala laget", () => {
    const l1 = match({ homeId: "L1", startsAt: at(1) });
    const l2 = match({ awayId: "L2", startsAt: at(4) });
    assert.equal(pickFeatured([l1, l2], standings, LOCAL)?.id, l2.id);
  });
  it("lika placering: tidigast avspark", () => {
    const same = new Map<string, Standing>([
      ["L1", { position: 3, pts: 20 }],
      ["L2", { position: 3, pts: 20 }],
    ]);
    const later = match({ homeId: "L1", startsAt: at(4) });
    const sooner = match({ awayId: "L2", startsAt: at(2) });
    assert.equal(pickFeatured([later, sooner], same, LOCAL)?.id, sooner.id);
  });
  it("lag utan tabellrad hamnar efter lag med placering", () => {
    const unplaced = match({ homeId: "L1", startsAt: at(1) });
    const placed = match({ awayId: "L2", startsAt: at(3) });
    const only = new Map<string, Standing>([["L2", { position: 9, pts: 5 }]]);
    assert.equal(pickFeatured([unplaced, placed], only, LOCAL)?.id, placed.id);
  });
  it("inga matcher ger null", () => {
    assert.equal(pickFeatured([], standings, LOCAL), null);
  });
});

describe("teamSummaries", () => {
  const teams: LocalTeamRow[] = [
    { teamId: "L1", name: "Ankarsrums IS", logoUrl: null, leagueId: "lg", leagueName: "Div 6", position: 9, pts: 12 },
    { teamId: "L2", name: "Gunnebo IF", logoUrl: null, leagueId: "lg", leagueName: "Div 6", position: 1, pts: 41 },
    { teamId: "L3", name: "Blackstads IF", logoUrl: null, leagueId: null, leagueName: null, position: null, pts: null },
  ];

  it("form: fem senaste spelade, äldst först, ur lagets perspektiv", () => {
    const played = [
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-30), homeScore: 5, awayScore: 0 }), // för gammal (6:e)
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-25), homeScore: 1, awayScore: 0 }), // V
      match({ awayId: "L1", status: "FINISHED", startsAt: at(-20), homeScore: 2, awayScore: 0 }), // F (borta)
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-15), homeScore: 1, awayScore: 1 }), // O
      match({ awayId: "L1", status: "FINISHED", startsAt: at(-10), homeScore: 0, awayScore: 3 }), // V (borta)
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-5), homeScore: 0, awayScore: 1 }), // F
    ];
    const l1 = teamSummaries(teams, played, NOW).find((t) => t.teamId === "L1");
    assert.deepEqual(l1?.form, ["V", "F", "O", "V", "F"]);
  });
  it("nästa match: tidigaste kommande, hemma/borta och motståndare", () => {
    const later = match({ homeId: "L1", awayName: "Storebro IF", startsAt: at(9) });
    const next = match({ awayId: "L1", homeName: "Gunnebo IF", startsAt: at(2) });
    const l1 = teamSummaries(teams, [later, next], NOW).find((t) => t.teamId === "L1");
    assert.deepEqual(l1?.next, { startsAt: next.startsAt, home: false, opponent: "Gunnebo IF" });
  });
  it("lag utan kommande match får next = null", () => {
    const l2 = teamSummaries(teams, [], NOW).find((t) => t.teamId === "L2");
    assert.equal(l2?.next, null);
    assert.deepEqual(l2?.form, []);
  });
  it("sorteras efter placering, lag utan placering sist", () => {
    assert.deepEqual(
      teamSummaries(teams, [], NOW).map((t) => t.teamId),
      ["L2", "L1", "L3"],
    );
  });
});
