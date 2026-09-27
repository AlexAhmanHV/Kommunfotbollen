import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tableExcerpt, teamIdBySlug, teamSlug } from "./teams";

describe("teamSlug / teamIdBySlug", () => {
  it("slug åt båda hållen", () => {
    assert.equal(teamSlug("eswidget-9925"), "ifk-vastervik");
    assert.equal(teamIdBySlug("ifk-vastervik"), "eswidget-9925");
    assert.equal(teamIdBySlug("vasterviks-dam"), "eswidget-191798");
  });
  it("okänt lag eller okänd slug ger null", () => {
    assert.equal(teamSlug("eswidget-1"), null);
    assert.equal(teamIdBySlug("finns-inte"), null);
  });
});

describe("tableExcerpt", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ teamId: `t${i + 1}`, position: i + 1 }));
  const ids = (r: { teamId: string }[]) => r.map((x) => x.teamId);

  it("laget i mitten: två över och två under", () => {
    assert.deepEqual(ids(tableExcerpt(rows, "t6")), ["t4", "t5", "t6", "t7", "t8"]);
  });
  it("först i tabellen: fem översta", () => {
    assert.deepEqual(ids(tableExcerpt(rows, "t1")), ["t1", "t2", "t3", "t4", "t5"]);
  });
  it("sist i tabellen: fem nedersta", () => {
    assert.deepEqual(ids(tableExcerpt(rows, "t12")), ["t8", "t9", "t10", "t11", "t12"]);
  });
  it("serie med färre än fem lag: alla", () => {
    assert.deepEqual(ids(tableExcerpt(rows.slice(0, 3), "t2")), ["t1", "t2", "t3"]);
  });
  it("laget saknas: tomt", () => {
    assert.deepEqual(tableExcerpt(rows, "x"), []);
  });
});
