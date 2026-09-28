import { test } from "node:test";
import assert from "node:assert/strict";
import { isRobotArticle } from "./newspaper-sections";

test("isRobotArticle: United Robots-nyckelordet i JSON-LD", () => {
  assert.equal(isRobotArticle('"keywords": ["Fotboll", "United Robots Sport", "United Robots", "Jobb"]'), true);
});

test("isRobotArticle: sidornas gemensamma tagglista räknas inte", () => {
  assert.equal(isRobotArticle('{"tagCategoryID":4,"name":"United Robots Sport","entityTypeID":0}'), false);
  assert.equal(isRobotArticle('"author": { "@type": "Person", "name": "Alexander Åhman" }'), false);
});
