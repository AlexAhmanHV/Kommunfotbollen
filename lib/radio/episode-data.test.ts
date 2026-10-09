import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UiMatch } from "../queries";
import { buildEpisodeData, standingsSnapshot, type TableRow } from "./episode-data";

const WEEK = {
  key: "2026-W41",
  start: new Date("2026-10-04T22:00:00Z"),
  end: new Date("2026-10-11T22:00:00Z"),
};
const LOCAL = new Set(["L1", "L2"]);
const UPCOMING = { status: "UPCOMING", homeScore: null, awayScore: null } as const;

let seq = 0;
function match(p: Partial<UiMatch>): UiMatch {
  seq++;
  return {
    id: `m${seq}`,
    round: null,
    startsAt: new Date("2026-10-10T13:00:00Z"),
    status: "FINISHED",
    homeId: "L1",
    awayId: "X1",
    homeName: "Lokal Ett",
    awayName: "Gäst",
    homeLogo: null,
    awayLogo: null,
    homeScore: 2,
    awayScore: 1,
    leagueId: "lg",
    leagueName: "Division 4",
    ...p,
  };
}

const base = { week: WEEK, localIds: LOCAL, goals: [], quotes: [], table: [], previous: null };

describe("buildEpisodeData", () => {
  it("ger null när inget lokalt lag spelat", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [match({ ...UPCOMING, startsAt: new Date("2026-10-17T13:00:00Z") })],
    });
    assert.equal(data, null);
  });

  it("ignorerar matcher utanför veckan och ospelade matcher", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({ startsAt: new Date("2026-10-04T21:59:00Z") }), // sön 23:59 veckan innan
        match({ startsAt: new Date("2026-10-11T22:00:00Z") }), // mån 00:00 veckan efter
        match({ ...UPCOMING }),
      ],
    });
    assert.equal(data, null);
  });

  it("tar med vinst och lagets egna skyttar i rapportordning", () => {
    const m = match({});
    const data = buildEpisodeData({
      ...base,
      matches: [m],
      goals: [
        { matchId: m.id, teamId: "L1", player: "Bertil", ord: 1 },
        { matchId: m.id, teamId: "L1", player: "Adam", ord: 0 },
        { matchId: m.id, teamId: "X1", player: "Gästskytt", ord: 2 },
      ],
    });
    assert.equal(data?.week, 41);
    assert.equal(data?.teams.length, 1);
    assert.equal(data?.teams[0].team, "Lokal Ett");
    assert.equal(data?.teams[0].league, "Division 4");
    assert.deepEqual(data?.teams[0].results, [
      {
        opponent: "Gäst",
        home: true,
        goalsFor: 2,
        goalsAgainst: 1,
        outcome: "vinst",
        scorers: ["Adam", "Bertil"],
        quotes: [],
      },
    ]);
  });

  it("tar med bortamatch utan kända skyttar", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({ homeId: "X1", homeName: "Värd", awayId: "L1", awayName: "Lokal Ett", homeScore: 3, awayScore: 3 }),
      ],
    });
    assert.deepEqual(data?.teams[0].results[0], {
      opponent: "Värd",
      home: false,
      goalsFor: 3,
      goalsAgainst: 3,
      outcome: "oavgjort",
      scorers: [],
      quotes: [],
    });
  });

  it("lägger ett derby hos båda lagen", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({ awayId: "L2", awayName: "Lokal Två", homeScore: 0, awayScore: 2 }),
      ],
    });
    assert.equal(data?.teams.length, 2);
    assert.equal(data?.teams[0].results[0].outcome, "förlust");
    assert.equal(data?.teams[1].team, "Lokal Två");
    assert.equal(data?.teams[1].results[0].outcome, "vinst");
    assert.equal(data?.teams[1].results[0].home, false);
  });

  it("kopplar citat till rätt lag med tidningens namn", () => {
    const m = match({});
    const data = buildEpisodeData({
      ...base,
      matches: [m],
      quotes: [
        {
          matchId: m.id,
          ord: 0,
          teamId: "X1",
          speaker: "Gästtränare",
          role: "tränare",
          quote: "Vi borde ha fått straff",
          sourceUrl: "https://www.dagensvastervik.se/a",
        },
        {
          matchId: m.id,
          ord: 1,
          teamId: "L1",
          speaker: "Anna Berg",
          role: "tränare",
          quote: "Vi förtjänade segern",
          sourceUrl: "https://www.dagensvastervik.se/sport/fotboll/e/1/x/",
        },
      ],
    });
    assert.deepEqual(data?.teams[0].results[0].quotes, [
      { speaker: "Anna Berg", role: "tränare", quote: "Vi förtjänade segern", source: "Dagens Västervik" },
    ]);
  });

  it("väljer första kommande match efter veckan som nästa match", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({}),
        match({
          ...UPCOMING,
          startsAt: new Date("2026-10-24T12:00:00Z"),
          homeId: "X2",
          homeName: "Senare",
          awayId: "L1",
          awayName: "Lokal Ett",
        }),
        match({ ...UPCOMING, startsAt: new Date("2026-10-17T12:00:00Z"), awayName: "Nästa" }),
      ],
    });
    assert.deepEqual(data?.teams[0].next, { opponent: "Nästa", home: true, date: "lördag 17 oktober" });
  });

  it("bygger tabellrundan för serier med lokala lag", () => {
    const table: TableRow[] = [
      { groupId: "g1", leagueName: "Division 4", teamId: "L1", teamName: "Lokal Ett", position: 4, pts: 12 },
      { groupId: "g1", leagueName: "Division 4", teamId: "X1", teamName: "Topp", position: 1, pts: 20 },
      { groupId: "g2", leagueName: "Division 6", teamId: "X3", teamName: "Annan", position: 1, pts: 18 },
    ];
    const withPrevious = buildEpisodeData({
      ...base,
      matches: [match({})],
      table,
      previous: { L1: { position: 6, pts: 9 } },
    });
    assert.deepEqual(withPrevious?.tables, [
      {
        league: "Division 4",
        leader: { team: "Topp", pts: 20 },
        localTeams: [{ team: "Lokal Ett", position: 4, pts: 12, previousPosition: 6 }],
      },
    ]);

    const firstEpisode = buildEpisodeData({ ...base, matches: [match({})], table });
    assert.equal(firstEpisode?.tables[0].localTeams[0].previousPosition, null);
  });
});

describe("standingsSnapshot", () => {
  it("sparar bara de lokala lagen", () => {
    const snap = standingsSnapshot(
      [
        { groupId: "g1", leagueName: "D4", teamId: "L1", teamName: "Lokal Ett", position: 4, pts: 12 },
        { groupId: "g1", leagueName: "D4", teamId: "X1", teamName: "Topp", position: 1, pts: 20 },
      ],
      LOCAL,
    );
    assert.deepEqual(snap, { L1: { position: 4, pts: 12 } });
  });
});
