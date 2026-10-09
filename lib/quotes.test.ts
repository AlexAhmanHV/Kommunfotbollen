import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paperName, verifiedQuotes } from "./quotes";

const ARTICLE =
  "Västerviks FF vann med 3–1 mot Tuna. – Vi var bättre i andra halvlek och förtjänade segern, " +
  "säger tränaren Anna Berg. ”Det här ger oss självförtroende inför derbyt”, sa lagkaptenen Erik Ek.";

describe("verifiedQuotes", () => {
  it("godkänner ett ordagrant citat", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Vi var bättre i andra halvlek och förtjänade segern" }],
      ARTICLE,
    );
    assert.equal(out.length, 1);
  });

  it("avvisar reporterns egen text", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Västerviks FF vann med 3–1" }],
      ARTICLE,
    );
    assert.equal(out.length, 0);
  });

  it("avvisar ett citat som kapats i början", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "bättre i andra halvlek och förtjänade segern" }],
      ARTICLE,
    );
    assert.equal(out.length, 0);
  });

  it("avvisar ett citat som kapats i slutet", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Vi var bättre i andra halvlek" }],
      ARTICLE,
    );
    assert.equal(out.length, 0);
  });

  it("avvisar ett kapat citat som vänder på betydelsen", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "vi förtjänade segern" }],
      "– Jag tycker inte att vi förtjänade segern, säger Anna Berg.",
    );
    assert.equal(out.length, 0);
  });

  it("godkänner ett citat som slutar vid kommatecken före 'säger'", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Vi var bättre i andra halvlek och förtjänade segern" }],
      ARTICLE,
    );
    assert.equal(out.length, 1);
  });

  it("godkänner en mening inom citattecken, även med avslutande punkt i citatet", () => {
    const out = verifiedQuotes(
      [{ speaker: "Erik Ek", quote: "Det här ger oss självförtroende inför derbyt." }],
      "”Det här ger oss självförtroende inför derbyt.” Så sa Erik Ek.",
    );
    assert.equal(out.length, 1);
  });

  it("avvisar en påhittad talare vars efternamn inte finns i artikeln", () => {
    const out = verifiedQuotes(
      [{ speaker: "Lars Svensson", quote: "Vi var bättre i andra halvlek och förtjänade segern" }],
      ARTICLE,
    );
    assert.equal(out.length, 0);
  });

  it("godkänner om någon förekomst av texten uppfyller start och slut", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Vi var bättre i andra halvlek" }],
      "Anna Berg tyckte vi var bättre i andra halvlek idag. – Vi var bättre i andra halvlek. Så var det, säger Anna Berg.",
    );
    assert.equal(out.length, 1);
  });

  it("avvisar ett citat där ett ord ändrats", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Vi var mycket bättre i andra halvlek" }],
      ARTICLE,
    );
    assert.equal(out.length, 0);
  });

  it("bryr sig inte om citattecken och blanksteg, och tar bort dem runt citatet", () => {
    const out = verifiedQuotes(
      [{ speaker: " Erik Ek ", quote: "”Det här ger oss  självförtroende inför derbyt”" }],
      ARTICLE,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].speaker, "Erik Ek");
    assert.equal(out[0].quote, "Det här ger oss  självförtroende inför derbyt");
  });

  it("tar bort inledande pratminus", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "– Vi var bättre i andra halvlek och förtjänade segern" }],
      ARTICLE,
    );
    assert.equal(out[0].quote, "Vi var bättre i andra halvlek och förtjänade segern");
  });

  it("avvisar citat utan namngiven talare", () => {
    const out = verifiedQuotes(
      [{ speaker: "  ", quote: "Vi var bättre i andra halvlek och förtjänade segern" }],
      ARTICLE,
    );
    assert.equal(out.length, 0);
  });

  it("avvisar för korta och för långa citat", () => {
    const long = "ord ".repeat(60).trim(); // 239 tecken
    const out = verifiedQuotes(
      [
        { speaker: "Anna Berg", quote: "Vi var" },
        { speaker: "Anna Berg", quote: long },
      ],
      `${ARTICLE} ${long}`,
    );
    assert.equal(out.length, 0);
  });

  it("behåller högst två citat per match", () => {
    const out = verifiedQuotes(
      [
        { speaker: "Anna Berg", quote: "Vi var bättre i andra halvlek och förtjänade segern" },
        { speaker: "Erik Ek", quote: "Det här ger oss självförtroende inför derbyt" },
        { speaker: "Anna Berg", quote: "Vi var bättre i andra halvlek och förtjänade segern" },
      ],
      ARTICLE,
    );
    assert.deepEqual(out.map((q) => q.speaker), ["Anna Berg", "Erik Ek"]);
  });
});

describe("verifiedQuotes, strängare gränser", () => {
  const ok = (speaker: string, quote: string, article: string) =>
    verifiedQuotes([{ speaker, quote }], article).length === 1;

  it("godkänner citat som slutar på egna skiljetecken", () => {
    assert.ok(ok("Anna Berg", "Det var fantastiskt!", "– Det var fantastiskt! säger Anna Berg."));
    assert.ok(
      ok("Anna Berg", "Vi vann rättvist idag.", "”Vi vann rättvist idag. Det var skönt”, säger Anna Berg."),
    );
    assert.ok(
      ok("Anna Berg", "Vi får se vad som händer…", "– Vi får se vad som händer… säger Anna Berg."),
    );
  });

  it("avvisar reporterns text efter ett slutcitattecken", () => {
    assert.ok(
      !ok("Anna Berg", "Det tyckte Anna Berg efter matchen", "”Vi var bäst.” Det tyckte Anna Berg efter matchen."),
    );
  });

  it("avvisar tankstreck mitt i en mening", () => {
    assert.ok(
      !ok(
        "Anna Berg",
        "hemmalaget föll med 0–2 mot Kalmar",
        "Det blev en tuff match – hemmalaget föll med 0–2 mot Kalmar. Anna Berg var besviken.",
      ),
    );
  });

  it("godkänner pratminus i början av ett stycke", () => {
    assert.ok(
      ok("Anna Berg", "Vi var bättre i andra halvlek", "Text här.\n– Vi var bättre i andra halvlek, säger Anna Berg."),
    );
  });

  it("avvisar citat som kapats av artikelns slut", () => {
    assert.ok(
      !ok(
        "Anna Berg",
        "Vi spelade hela matchen utan att tappa",
        "Matchen var jämn, säger Anna Berg. – Vi spelade hela matchen utan att tappa",
      ),
    );
  });

  it("matchar talarens efternamn som helt ord", () => {
    const article = "– Vi var bättre än Kalmar, säger tränaren. Det var bekväma segrar.";
    assert.ok(!ok("Erik Ek", "Vi var bättre än Kalmar", article));
    assert.ok(!ok("Anna B.rg", "Vi var bättre än Kalmar", "– Vi var bättre än Kalmar, säger Anna Berg."));
  });

  it("avvisar ett citat som kapats vid ett kommatecken inne i meningen", () => {
    const article = "– Vi var bäst på planen, eller nej, det var vi inte, säger Anna Berg.";
    assert.ok(!ok("Anna Berg", "Vi var bäst på planen", article));
    assert.ok(!ok("Anna Berg", "Vi var bäst på planen,", article));
    assert.ok(ok("Anna Berg", "Vi var bäst på planen, eller nej, det var vi inte", article));
    assert.ok(ok("Anna Berg", "Vi var bäst på planen, eller nej, det var vi inte,", article));
  });

  it("godkänner kommatecken före slutcitattecken", () => {
    assert.ok(ok("Anna Berg", "Vi vann rättvist idag", "”Vi vann rättvist idag,” sa Anna Berg."));
    assert.ok(!ok("Anna Berg", "Vi vann rättvist idag", "”Vi vann rättvist idag, tycker jag”, sa Anna Berg."));
  });
});

describe("paperName", () => {
  it("känner igen de skrapade tidningarna", () => {
    assert.equal(paperName("https://www.dagensvastervik.se/sport/fotboll/e/1/x/"), "Dagens Västervik");
    assert.equal(paperName("https://vimmerbytidning.se/a/b"), "Vimmerby Tidning");
  });

  it("faller tillbaka på värdnamnet", () => {
    assert.equal(paperName("https://www.vt.se/sport/x"), "vt.se");
  });
});
