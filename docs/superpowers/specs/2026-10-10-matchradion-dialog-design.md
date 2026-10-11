# Matchradion som dialog: Tommy och Peter — design

Datum: 2026-10-10
Bygger på: `2026-10-09-matchradion-design.md`

## Mål

Programmet leds av två jämlika värdar, Tommy och Peter, som turas om med
lagen och pratar med varandra i stället för en ensam berättare. Allt annat
(underlag, faktaregler, lagring, spelare, arkiv) är oförändrat.

Röstteknik vald efter lyssningstest 2026-10-10: **en replik i taget med
`eleven_multilingual_v2`**, ihopsatt till en MP3 (alternativ B). ElevenLabs
dialog-API (`eleven_v3`) valdes bort — sämre svenska med dessa röster och max
2 000 tecken per anrop.

## 1. Manusformat

Claude skriver manuset som repliker, en per rad:

```
Tommy: Välkomna till Matchradion, vecka 40! Jag heter Tommy.
Peter: Och jag är Peter. Vilken helg för Hjorted/Totebo!
```

Promptändringar i `lib/radio/script.ts` (alla befintliga faktaregler kvar):

- två jämlika värdar som turas om med lagen och reagerar på varandra;
- båda presenterar sig i början;
- citat kan läsas av vem som helst, alltid ordagrant med talare och källa;
- varje replik är en rad som börjar med `Tommy:` eller `Peter:`, högst
  400 tecken, inga andra rader;
- längd som i dag (350–450 ord).

**`parseDialogue(text)`** (ren funktion, ny fil `lib/radio/dialogue.ts`):

- returnerar `{ speaker: "Tommy" | "Peter"; text: string }[]`;
- tomma rader ignoreras; blanksteg runt talare och text trimmas;
- kastar fel om: en rad saknar känd talare, en replik är tom eller över
  400 tecken, eller bara en av värdarna förekommer.

`writeScript` validerar som i dag (200–4 000 tecken totalt) och dessutom med
`parseDialogue`; ogiltig dialog → fel → inget avsnitt, nästa körning försöker
igen. Manuset sparas som samma text (med talarprefix) i `radio_episodes.script`
— transkriptet i spelaren blir läsbart utan ändring, ingen schemaändring.

## 2. Röster och ljud

- Tommy: `ELEVENLABS_VOICE_ID` (som i dag). Peter: ny env
  `ELEVENLABS_VOICE_ID_2` (`oJEeOXECH9V31Oci9WHK`), i `.env` och Render.
  Saknas den → `generateEpisode` hoppar över med logg som andra saknade nycklar.
- `synthesize` tar emot repliker och röst-id per talare och anropar
  text-to-speech **en replik i taget, i ordning**, med `previous_text` och
  `next_text` (grannreplikernas text) för naturligare intonation. Tidsgräns
  per anrop som i dag (2 min).
- Ljudsvaren sätts ihop i ordning till en MP3 (`Buffer.concat`) och laddas
  upp som i dag. Spelare, lagring och arkiv oförändrade.
- Misslyckas en replik kastas fel → ingen rad skrivs (befintlig ordning
  manus → ljud → uppladdning → rad gäller).

## 3. Kostnad

Samma antal tecken som en ensam berättare → samma ElevenLabs-kostnad.
Ca 20–30 anrop per avsnitt i stället för ett (påverkar inte priset).

## 4. Test

- `lib/radio/dialogue.test.ts`: giltig dialog, tomma rader, okänd talare,
  för lång replik, bara en talare, blanksteg.
- Ihopsättningen verifieras manuellt: en ihopsatt fil ska avkodas och spelas i
  spelaren (Web Audio `decodeAudioData`) utan fel — görs vid första riktiga
  dialogavsnittet (kräver ElevenLabs-krediter).

## Utanför scope

Byte av röster per avsnitt, fler än två värdar, pauser/ljudeffekter mellan
repliker, omgörning av vecka 40 (görs när krediter finns).
