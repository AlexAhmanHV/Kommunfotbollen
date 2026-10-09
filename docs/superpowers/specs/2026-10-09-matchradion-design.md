# Matchradion: veckans omgång som radioprogram — design

Datum: 2026-10-09

## Bakgrund och mål

Ett AI-genererat radioprogram på ca 2,5–3 minuter per vecka som går igenom de
lokala lagens matcher (resultat, målskyttar, citat från tränare/spelare när
tidningen har sådana, nästa match) och avslutas med en tabellrunda. Claude
skriver manuset, ElevenLabs läser upp det, och sajten spelar upp det med jingel
och publikljud mixat i webbläsaren.

Datan per match är tunn (slutresultat, tabell, målskyttar och citat *ibland*).
Därför är formatet en veckosammanfattning i stället för referat per match, och
manuset får aldrig hitta på händelser eller citat om riktiga personer.

## 1. Citat ur matchrapporterna (ändring i `lib/goals.ts`)

DV:s och Vimmerby Tidnings matchrapporter läses redan i sin helhet, och
Haiku-anropet i `processReports` får hela artikeltexten. Samma anrop utökas
till att även returnera citat:

`"quotes":[{"speaker":"","role":"","team":"","quote":""}]`

- **Ny tabell `match_quotes`**: `match_id`, `ord`, `speaker`, `role` (t.ex.
  "tränare", "spelare"; null om okänd), `team_id` (null om laget inte kan
  resolvas), `quote`, `source_url`. PK (`match_id`, `ord`).
- **Ordagrann-spärr** (ren funktion i `lib/quotes.ts`): ett citat sparas bara om
  det finns ordagrant i artikeltexten — jämförelse efter normalisering av
  blanksteg, citattecken, tankstreck och versaler. Annat kastas.
- Högst **2 citat per match**, vart och ett 10–200 tecken; talaren måste vara
  namngiven.
- Citat sparas när rapporten kopplats entydigt till en lokal match (samma
  koppling som målskyttarna), även om målskyttarna för matchen redan fanns.
  Finns citat för matchen redan sparas inga nya.
- Gäller nya rapporter framåt; redan lästa rapporter körs inte om. VT ligger
  bakom betalvägg, så citat kommer bara från DV och Vimmerby Tidning.
- Källnamn härleds ur URL:en (`dagensvastervik.se` → "Dagens Västervik",
  `vimmerbytidning.se` → "Vimmerby Tidning").

## 2. Pipeline och schemaläggning

**När:** nytt schemalagt jobb i `instrumentation.ts`, **dagligen 23:30
Europe/Stockholm** — efter lagsynken 23:00. Jobbet gäller alltid *senast
avslutade* vecka (mån–sön) och gör ingenting om det avsnittet redan finns.
I praktiken skapas avsnittet måndag 23:30 (helgens resultat och DV:s
målskyttar har hunnit in); misslyckas det försöker tisdagens körning igen.
Exponeras även som `target=radio` i `/api/sync` och som nytt val i
`.github/workflows/sync.yml` för manuell körning.

**Ny modul `lib/radio/`:**

1. **`week.ts`** — senast avslutade vecka i svensk tid: ISO-veckonyckel,
   start (måndag 00:00) och slut (nästa måndag 00:00).
2. **`episode-data.ts`** — ren funktion som bygger veckans underlag:
   - per lokalt lag som spelat under veckan: resultat (motståndare,
     hemma/borta, mål, utfall), lagets målskyttar, citat (med talare, roll
     och källa) och nästa match;
   - **tabellrunda**: per serie med lokala lag — serieledaren (namn, poäng)
     och de lokala lagens placering, poäng och placering vid förra avsnittet;
   - `null` om inget lokalt lag spelat (då görs inget mer).

   `table_rows` har ingen historik (skrivs över vid varje synk), så varje
   avsnitt sparar en ögonblicksbild av de lokala lagens placering och poäng;
   "förra placeringen" läses från förra avsnittets ögonblicksbild. Första
   avsnittet (eller saknat föregående) nämner bara aktuell placering.
3. **`script.ts`** — skickar underlaget till Claude **Sonnet** och får ett
   svenskt manus, mål 350–450 ord. Promptregler:
   - nämn bara fakta som finns i underlaget — inga påhittade händelser,
     matchminuter eller citat;
   - citat återges bara ordagrant ur underlaget, alltid med talare och källa
     ("säger tränaren X till Dagens Västervik");
   - saknas målskyttar för en match: säg bara resultatet;
   - avsluta med tabellrundan;
   - ren löptext för uppläsning (inga rubriker, listor eller markdown).
4. **`voice.ts`** — manus → ElevenLabs text-to-speech (svensk röst) → MP3 →
   uppladdning till Supabase Storage.
5. **`generate.ts`** — orkestrering: hämtar data ur databasen, kör stegen i
   ordning och skriver avsnittet.

**Ny tabell `radio_episodes`** (läggs till i `lib/db/schema.ts` och i den
befintliga `CREATE TABLE IF NOT EXISTS`-DDL:en i `lib/db/client.ts`):

| kolumn      | typ         | not                                    |
|-------------|-------------|----------------------------------------|
| `id`        | text, PK    | ISO-veckonyckel, t.ex. `2026-W41`      |
| `weekStart` | timestamptz | måndag 00:00 svensk tid                |
| `script`    | text        | manuset, visas även som transkript     |
| `audioUrl`  | text        | publik URL i Supabase Storage          |
| `standings` | jsonb       | `{teamId: {position, pts}}` lokala lag |
| `createdAt` | timestamptz |                                        |

Veckonyckeln gör jobbet idempotent: finns raden redan görs inga API-anrop.

## 3. Ljud och lagring

**Statiska ljud, genereras en gång:** `scripts/generate-radio-sounds.mts`
(samma stil som `images:lag`, nytt npm-skript `radio:sounds`) anropar ElevenLabs
Sound Effects och skriver:

- `public/radio/jingle.mp3` — radiojingel ca 4 s, används som intro och outro;
- `public/radio/crowd.mp3` — loopbar publikbädd ca 20 s.

Skriptet körs manuellt tills ljuden låter rätt; filerna checkas in.

**Röst:** ElevenLabs TTS (`eleven_multilingual_v2`) med röst-id från
`ELEVENLABS_VOICE_ID`. Rösten väljs genom att testa 2–3 röster ur ElevenLabs
bibliotek på ett riktigt manus (svenskt uttal varierar mellan röster).

**Lagring:** publik Supabase Storage-bucket `radio`, filnamn `<veckonyckel>.mp3`.
Uppladdning via `fetch` mot Storage REST-API:t med service role-nyckeln — inget
nytt beroende (`@supabase/supabase-js` behövs inte).

**Nya env-variabler:** `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Spelaren på sajten

**Placering:** överst i startsidans sidebar (`app/components/home/sidebar.tsx`),
ovanför Nykritat/Fotbollsviken. Visar senaste avsnittet: "Vecka 41" + datum.
Inget avsnitt → ingenting renderas.

**`app/components/home/radio-player.tsx`** (klientkomponent):

- egen play/paus-knapp, förloppsindikator och tid i sajtens stil;
- hela programmet mixas med Web Audio och schemaläggs på ljudklockan vid
  klicket: jingel → röst med publikbädden intonad och loopad på ca 18 %
  volym → publiken tonas ut → jingel. Paus = `suspend()` på klockan;
- ljudfilerna hämtas först vid första klick (ingen påverkan på sidladdning);
- transkript i `<details>` ("Läs manuset");
- en rad "AI-genererat · Röst: ElevenLabs" under spelaren (attribution krävs
  på gratisnivån).

**Utanför scope:** arkivsida, nedladdning, podd-RSS, delningslänkar, spolning.

## 5. Felhantering

Samma fail-open-mönster som `lib/relevance.ts`:

- saknad nyckel (Anthropic, ElevenLabs eller Supabase) → logga och hoppa över;
  sajten fungerar som vanligt utan radio;
- ordning: manus → ljud → uppladdning → **sist** DB-raden. Fel i något steg →
  ingen rad skrivs, nästa körning försöker igen. Ett halvfärdigt avsnitt kan
  aldrig visas;
- manuset Zod-valideras innan TTS: minst 200, max 4 000 tecken (skydd mot att
  ett skenande manus bränner krediter);
- ingen spelad lokal match → inget avsnitt, inga API-anrop;
- citat som inte finns ordagrant i artikeln sparas aldrig;
- `/systemstatus` får ett jobbkort "Matchradion" (senaste avsnittets `createdAt`).

## 6. Test

`tsx --test`, samma upplägg som `lib/matchday.test.ts`:

- `week`: veckofönstret i svensk tid, vecka med sommartidsbyte, årsskifte
  med ISO-vecka 53;
- `episode-data`: resultat och skyttar, match utan skyttar, derby, matcher
  utanför veckan ignoreras, citat kopplas till rätt lag, nästa match,
  tabellrunda med förra placeringen, tom vecka → `null`;
- `quotes`: ordagrant citat godkänns, ändrat ord avvisas, skillnad i
  citattecken/blanksteg godkänns, längd- och antalsgränser, källnamn;
- manusvalidering: tomt eller för långt manus avvisas.

Claude- och ElevenLabs-anropen enhetstestas inte; de verifieras genom en
`target=radio`-körning mot riktig data och genom att lyssna på resultatet.

## ElevenLabs-nivå

Gratisnivån: 10 000 krediter/månad, 1 kredit/tecken med Multilingual v2,
attribution krävs, ej kommersiellt bruk. Ett avsnitt på ~2 500–3 000 tecken ×
4–5 veckor ligger kring taket; ljudeffekterna kostar också krediter vid
generering. Räcker det inte är Starter (~5 USD/mån, 30 000 krediter,
kommersiell rätt) nästa steg. Attributionsraden visas alltid.
