# Matchradion: veckans omgång som radioprogram — design

Datum: 2026-10-09

## Bakgrund och mål

Ett AI-genererat radioprogram på ca 2–2,5 minuter per vecka som går igenom de
lokala lagens matcher: resultat, målskyttar, tabelländringar och vad som väntar.
Claude skriver manuset, ElevenLabs läser upp det, och sajten spelar upp det med
jingel och publikljud mixat i webbläsaren.

Datan per match är tunn (slutresultat, tabell, form, målskyttar *ibland*). Därför
är formatet en veckosammanfattning i stället för referat per match, och manuset
får aldrig hitta på händelser om riktiga spelare.

## 1. Pipeline och schemaläggning

**När:** nytt schemalagt jobb i `instrumentation.ts`, **måndagar 23:30
Europe/Stockholm** — efter lagsynken 23:00, så helgens resultat och DV:s
målskyttar har hunnit in. Exponeras även som `target=radio` i `/api/sync` och
som nytt val i `.github/workflows/sync.yml` för manuell körning.

**Ny modul `lib/radio/`:**

1. **`episode-data.ts`** — bygger veckans underlag för de lokala lagen
   (`LOCAL_TEAM_IDS`) i fönstret måndag 00:00 – söndag 23:59 svensk tid närmast
   före körningen: spelade matcher med resultat, målskyttar från `match_goals`,
   tabellplacering före/efter veckan, form och nästa match. Returnerar ett rent
   JSON-objekt, eller `null` om ingen lokal match spelats (då görs inget mer).
   DB-hämtningen och den rena sammanställningslogiken hålls isär så logiken kan
   testas utan databas.
2. **`script.ts`** — skickar underlaget till Claude **Sonnet** (senaste
   Sonnet-modellen) och får ett svenskt manus, mål 300–400 ord. Promptregler:
   - nämn bara fakta som finns i underlaget — inga påhittade händelser,
     matchminuter eller citat;
   - saknas målskyttar för en match: säg bara resultatet;
   - ren löptext för uppläsning (inga rubriker, listor eller markdown).
3. **`voice.ts`** — manus → ElevenLabs text-to-speech (svensk röst) → MP3 →
   uppladdning till Supabase Storage.

**Ny tabell `radio_episodes`** (läggs till i `lib/db/schema.ts` och i den
befintliga `CREATE TABLE IF NOT EXISTS`-DDL:en i `lib/db/client.ts`):

| kolumn      | typ         | not                                   |
|-------------|-------------|---------------------------------------|
| `id`        | text, PK    | ISO-veckonyckel, t.ex. `2026-W41`     |
| `weekStart` | timestamptz | måndag 00:00 svensk tid               |
| `script`    | text        | manuset, visas även som transkript    |
| `audioUrl`  | text        | publik URL i Supabase Storage         |
| `createdAt` | timestamptz |                                       |

Veckonyckeln gör jobbet idempotent: finns raden redan görs inga API-anrop.

## 2. Ljud och lagring

**Statiska ljud, genereras en gång:** `scripts/generate-radio-sounds.mts`
(samma stil som `images:lag`, nytt npm-skript `radio:sounds`) anropar ElevenLabs
Sound Effects och skriver:

- `public/radio/jingle.mp3` — radiojingel 3–5 s, används som intro och outro;
- `public/radio/crowd.mp3` — loopbar publikbädd ca 20 s.

Skriptet körs manuellt tills ljuden låter rätt; filerna checkas in.

**Röst:** ElevenLabs TTS med röst-id från `ELEVENLABS_VOICE_ID`. Rösten väljs
genom att testa 2–3 röster ur ElevenLabs bibliotek på ett riktigt manus
(svenskt uttal varierar mellan röster). Modell: en flerspråkig modell med
svenskt stöd; väljs i samma lyssningstest.

**Lagring:** publik Supabase Storage-bucket `radio`, filnamn `<veckonyckel>.mp3`.
Uppladdning via `fetch` mot Storage REST-API:t med service role-nyckeln — inget
nytt beroende (`@supabase/supabase-js` behövs inte).

**Nya env-variabler:** `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Spelaren på sajten

**Placering:** överst i startsidans sidebar (`app/components/home/sidebar.tsx`),
ovanför Nykritat/Fotbollsviken. Visar senaste avsnittet: "Matchradion · vecka
41" + datum. Inget avsnitt → ingenting renderas.

**`app/components/home/radio-player.tsx`** (klientkomponent):

- egen play/paus-knapp, förloppsindikator och tid i sajtens mörka stil;
- mixning med Web Audio: jingel → röst med publikbädden intonad och loopad
  på ca 15–20 % volym → publiken tonas ut → jingel;
- ljudfilerna hämtas först vid första klick (ingen påverkan på sidladdning);
- transkript i `<details>` ("Läs manuset");
- om ElevenLabs gratisnivå används: en rad "Röst: ElevenLabs" under spelaren.

**Utanför scope:** arkivsida, nedladdning, podd-RSS, delningslänkar.

## 4. Felhantering

Samma fail-open-mönster som `lib/relevance.ts`:

- saknad nyckel (Anthropic, ElevenLabs eller Supabase) → logga och hoppa över;
  sajten fungerar som vanligt utan radio;
- ordning: manus → ljud → uppladdning → **sist** DB-raden. Fel i något steg →
  ingen rad skrivs, nästa körning försöker igen. Ett halvfärdigt avsnitt kan
  aldrig visas;
- manuset Zod-valideras innan TTS: inte tomt, max 4 000 tecken (skydd mot att
  ett skenande manus bränner krediter);
- ingen spelad lokal match → inget avsnitt, inga API-anrop;
- `/systemstatus` får en rad "Matchradion – senaste avsnitt".

## 5. Test

`tsx --test`, samma upplägg som `lib/matchday.test.ts`:

- `episode-data`: veckofönstret i svensk tid, tabelländring före/efter, match
  utan målskyttar kommer med, tom vecka → `null`;
- veckonyckel inklusive årsskifte (ISO-vecka 1 kan börja i december,
  vecka 53 finns vissa år);
- manusvalidering: tomt eller för långt manus avvisas.

Claude- och ElevenLabs-anropen enhetstestas inte; de verifieras genom en
`target=radio`-körning mot riktig data och genom att lyssna på resultatet.

## Öppet att kontrollera före implementation

- ElevenLabs villkor för gratisnivån (attribution, kommersiellt bruk) och
  aktuell kreditkostnad per tecken — avgör om attributionsraden behövs.
