import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_SCRIPT_CHARS, scriptSchema } from "./script";

describe("scriptSchema", () => {
  it("godkänner och trimmar ett rimligt manus", () => {
    const s = "Hej och välkommen. ".repeat(20).trim();
    assert.equal(scriptSchema.parse(`  ${s}  `), s);
  });

  it("avvisar tomt manus", () => {
    assert.throws(() => scriptSchema.parse("   "));
  });

  it("avvisar för kort manus", () => {
    assert.throws(() => scriptSchema.parse("Kort."));
  });

  it("avvisar för långt manus", () => {
    assert.throws(() => scriptSchema.parse("a".repeat(MAX_SCRIPT_CHARS + 1)));
  });
});
