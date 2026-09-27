import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UiMatch } from "./queries";
import {
  isResultMissing,
  latestRowPerTeam,
  matchdayMode,
  pickFeatured,
  scoreText,
  teamSummaries,
  tickerItems,
  type LocalTeamRow,
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
  it("en gammal pågående match (30 dagar) räknas inte som kommande", () => {
    const stale = match({ homeId: "L1", status: "ONGOING", startsAt: at(-30) });
    const r = matchdayMode([stale], LOCAL, NOW);
    assert.equal(r.mode, "offseason");
  });
});

describe("pickFeatured", () => {
  // L1 har högre prioritet än L2 i dessa tester.
  const priority = ["L1", "L2"];

  it("derby vinner över match med högre prioriterat lag", () => {
    const derby = match({ homeId: "L1", awayId: "L2", startsAt: at(5) });
    const top = match({ homeId: "L1", startsAt: at(1) });
    assert.equal(pickFeatured([top, derby], priority, LOCAL)?.id, derby.id);
  });
  it("flera derbyn: det tidigaste", () => {
    const late = match({ homeId: "L1", awayId: "L2", startsAt: at(6) });
    const early = match({ homeId: "L2", awayId: "L1", startsAt: at(2) });
    assert.equal(pickFeatured([late, early], priority, LOCAL)?.id, early.id);
  });
  it("utan derby: högst prioriterade laget vinner även om motståndaren spelar tidigare", () => {
    const l1 = match({ homeId: "L1", startsAt: at(4) });
    const l2 = match({ awayId: "L2", startsAt: at(1) });
    assert.equal(pickFeatured([l1, l2], priority, LOCAL)?.id, l1.id);
  });
  it("lika prioritet (samma lag i två matcher): tidigast avspark", () => {
    const later = match({ homeId: "L1", startsAt: at(4) });
    const sooner = match({ homeId: "L1", startsAt: at(2) });
    assert.equal(pickFeatured([later, sooner], priority, LOCAL)?.id, sooner.id);
  });
  it("lag som saknas i prioritetslistan hamnar sist", () => {
    const unlisted = match({ homeId: "L3", startsAt: at(1) });
    const listed = match({ homeId: "L2", startsAt: at(3) });
    const localWithL3 = new Set(["L1", "L2", "L3"]);
    assert.equal(pickFeatured([unlisted, listed], priority, localWithL3)?.id, listed.id);
  });
  it("inga matcher ger null", () => {
    assert.equal(pickFeatured([], priority, LOCAL), null);
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

describe("tickerItems", () => {
  it("varje lags senaste resultat och nästa match, äldre resultat och senare matcher uteslutna", () => {
    const oldResult = match({ homeId: "L1", status: "FINISHED", startsAt: at(-6), homeScore: 1, awayScore: 0 });
    const latestResult = match({ homeId: "L1", status: "FINISHED", startsAt: at(-2), homeScore: 3, awayScore: 1 });
    const nextMatch = match({ homeId: "L1", startsAt: at(2) });
    const laterMatch = match({ homeId: "L1", startsAt: at(5) });
    const items = tickerItems([oldResult, latestResult, nextMatch, laterMatch], LOCAL, NOW);
    assert.deepEqual(
      items.map((i) => [i.kind, i.match.id]),
      [
        ["result", latestResult.id],
        ["upcoming", nextMatch.id],
      ],
    );
  });
  it("en derby (två lokala lag) förekommer bara en gång", () => {
    const derbyResult = match({ homeId: "L1", awayId: "L2", status: "FINISHED", startsAt: at(-1), homeScore: 2, awayScore: 1 });
    const derbyUpcoming = match({ homeId: "L2", awayId: "L1", startsAt: at(3) });
    const items = tickerItems([derbyResult, derbyUpcoming], LOCAL, NOW);
    assert.deepEqual(
      items.map((i) => [i.kind, i.match.id]),
      [
        ["result", derbyResult.id],
        ["upcoming", derbyUpcoming.id],
      ],
    );
  });
  it("ordning: alla resultat nyast först, sedan alla kommande tidigast först", () => {
    const l1Result = match({ homeId: "L1", status: "FINISHED", startsAt: at(-5), homeScore: 1, awayScore: 0 });
    const l2Result = match({ homeId: "L2", status: "FINISHED", startsAt: at(-1), homeScore: 2, awayScore: 2 });
    const l1Upcoming = match({ homeId: "L1", startsAt: at(6) });
    const l2Upcoming = match({ homeId: "L2", startsAt: at(2) });
    const items = tickerItems([l1Result, l2Result, l1Upcoming, l2Upcoming], LOCAL, NOW);
    assert.deepEqual(
      items.map((i) => [i.kind, i.match.id]),
      [
        ["result", l2Result.id],
        ["result", l1Result.id],
        ["upcoming", l2Upcoming.id],
        ["upcoming", l1Upcoming.id],
      ],
    );
  });
  it("lag utan kommande match bidrar bara med sitt resultat", () => {
    const result = match({ homeId: "L1", status: "FINISHED", startsAt: at(-3), homeScore: 1, awayScore: 0 });
    assert.deepEqual(
      tickerItems([result], LOCAL, NOW).map((i) => [i.kind, i.match.id]),
      [["result", result.id]],
    );
  });
  it("utelämnar icke-lokala matcher", () => {
    const other = match({ status: "FINISHED", startsAt: at(-1), homeScore: 1, awayScore: 1 });
    const otherUpcoming = match({ startsAt: at(2) });
    assert.deepEqual(tickerItems([other, otherUpcoming], LOCAL, NOW), []);
  });
});

describe("latestRowPerTeam", () => {
  it("dubblett: behåller raden med senast computedAt", () => {
    const older = { teamId: "L1", computedAt: at(-2) };
    const newer = { teamId: "L1", computedAt: at(-1) };
    assert.deepEqual(latestRowPerTeam([older, newer]), [newer]);
    assert.deepEqual(latestRowPerTeam([newer, older]), [newer]);
  });
  it("null computedAt förlorar mot en daterad rad", () => {
    const dated = { teamId: "L1", computedAt: at(-1) };
    const undated = { teamId: "L1", computedAt: null };
    assert.deepEqual(latestRowPerTeam([undated, dated]), [dated]);
    assert.deepEqual(latestRowPerTeam([dated, undated]), [dated]);
  });
  it("alla null: behåller första", () => {
    const first = { teamId: "L1", computedAt: null };
    const second = { teamId: "L1", computedAt: null };
    assert.deepEqual(latestRowPerTeam([first, second]), [first]);
  });
  it("lag med en enda rad passerar oförändrat och i ordning", () => {
    const l1 = { teamId: "L1", computedAt: at(-1) };
    const l2 = { teamId: "L2", computedAt: null };
    assert.deepEqual(latestRowPerTeam([l1, l2]), [l1, l2]);
  });
});

describe("scoreText", () => {
  it("visar resultatet", () => {
    assert.equal(scoreText(4, 1), "4–1");
  });
  it("saknat mål blir ett streck i stället för null", () => {
    assert.equal(scoreText(null, 2), "––2");
    assert.equal(scoreText(null, null), "–––");
  });
});
