# Redesign steg 2–4: seriesida, lagsidor, övriga sidor — design

Datum: 2026-09-27

Bygger på steg 1 (`2026-09-27-redesign-steg1-design.md`): samma färgtokens,
typsnitt (Barlow Condensed `font-display` + Geist), mörk/ljus zonindelning,
`MatchList`, `TeamCrest`, `SectionHeading`, lagbilder (`lib/team-images.ts`)
och rörelseklasser (`kenburns`, `rise`, `reveal`).

## Steg 2: Seriesidan (`/serie/[id]`)

**Mörk topp** (full bredd, `bg-surface-dark`):

- "← Alla serier" (länk till `/`), rad med nivå · distrikt · klass, seriens
  namn stort i Barlow Condensed (`h1`).
- **Tabellen som resultattavla:** kolumner #, Lag (emblem + namn), S, V, O, F,
  +/-, P. Poäng i Barlow Condensed och `accent`. Lokala lag i fetstil med svag
  grön bakgrund (`accent` ~10 %), och deras namn länkar till lagsidan.
- **Zoner** från `table_rows.position_status`: `promotion` = tydlig grön
  vänsterkant, `playoff` = svag grön vänsterkant, `relegation` = röd
  vänsterkant.
- Mobil: tabellen kan scrollas i sidled; ingen sidledes scroll på sidan i
  övrigt.

**Ljus del:** "Kommande", "Senaste omgången" och "Tidigare resultat" (bakom
`<details>`) som i dag, med den befintliga `MatchList`. Omgångslogiken
(4-dygnsfönstret) behålls oförändrad.

## Steg 3: Lagsidor (`/lag/[slug]`)

**Adresser:** slug per lokalt lag = samma som lagbildernas
(`TEAM_IMAGE_SLUGS` i `lib/team-images.ts`, t.ex. `ifk-vastervik`). Okänd slug
→ 404 (`notFound()`). Startsidans lagkort och menyn "Lag" (desktop och mobil)
länkar hit i stället för till seriesidan.

**Mörk topp:**

- **Affisch:** lagbild (eller reserv: mörk gradient med stort svagt emblem)
  med långsam zoom, mörkad nedåt. Emblem, serie + klass (liten rad), lagnamn
  stort (`h1`), och till höger placering (`N:a`), poäng och form (fem senaste,
  samma formrutor som lagkorten). Saknas tabellrad: placering och poäng
  utelämnas.
- **Nästa match:** etikett "Nästa match · {veckodag} {d/m}", "Hemma mot X" /
  "Borta mot X" och avsparkstid stort i `accent`, serien under. Saknas
  kommande match: "Ingen match inlagd".
- **Tabellutdrag:** laget med upp till två lag ovanför och två under (fem rader
  när det går; vid tabellens topp/botten flyttas fönstret så att fem rader
  visas om serien har minst fem lag). Lagets rad markerad. Länk "Hela
  tabellen →" till seriesidan.

**Ljus del** (två spalter från `lg`, huvudspalt + sidospalt):

- **Matcher** (huvudspalt): kommande (tidigast först), sedan spelade (senast
  först) med målskyttar via `MatchList`. Visa de 10 senaste spelade; resten
  bakom "Visa fler matcher (N)".
- **Nyheter** (sidospalt): de 6 senaste nyheterna taggade med laget (AI-avvisade
  taggar döljs, obedömda visas, max 60 dagar gamla) som mörka kort — samma
  kortkomponent som startsidan, som bryts ut till en delad komponent. Äldre
  nyheter om laget visas inte på lagsidan.

## Steg 4: Övriga sidor, städning

- **"Så funkar det", systemstatus och 404:** mörk rubrikrad (full bredd,
  `bg-surface-dark`, rubrik i Barlow Condensed) och ljust innehåll med de nya
  tokens. Textinnehållet ändras inte.
- **Gamla tokens bort:** de omskrivna `neutral-*`, `emerald-*` och `brand` tas
  bort ur `app/globals.css`; all kod använder bara de namngivna tokens från
  steg 1. `font-mono` och Geist Mono tas bort (siffror behåller
  `tabular-nums`). Global fokus-/markeringsfärg behåller den mörka teal-tonen
  som fungerar på ljust (mörka ytor har redan `accent`-fokus).
- **Bredd:** `PageContainer` blir `max-w-5xl` så att innehåll linjerar med
  navigering och sidfot; textsidor har en smalare läsbredd (`max-w-3xl`) inuti.
- **Lint:** systemstatus-sidans `Date.now()` i rendering flyttas till en
  hjälpfunktion (det befintliga lintfelet försvinner).

## Arkitektur

- `lib/teams.ts` (ny, ren): `teamIdBySlug(slug)`, `teamSlug(teamId)`, och
  `tableExcerpt(rows, teamId, radius = 2)` → utdragsrader. Slug-tabellen flyttas
  hit från `lib/team-images.ts` (som importerar den).
- `app/lag/[slug]/page.tsx` (ny) + komponenter i `app/components/team/`.
- `app/components/news-card.tsx` (ny, delad): det mörka nyhetskortet.
- Seriesidans tabell som egen komponent `app/components/league-table.tsx`.

## Test

- Enhetstester (`npm test`) för `lib/teams.ts`: slug ↔ id åt båda hållen och
  okänd slug; `tableExcerpt` i mitten, först, sist, serie med färre än fem lag,
  lag som saknas.
- `tsc`, lint (inga problem kvar utom `lib/goals.ts` oanvänd `now`),
  `next build`, visuell kontroll av `/`, `/serie/...`, `/lag/...`,
  `/sa-funkar-det`, `/systemstatus` och 404 på dator och mobil (375 px).
