# Redesign steg 1: visuell grund + startsida — design

Datum: 2026-09-27

## Bakgrund

Sajten upplevs som tråkig: startsidan är en lång rad likvärdiga sektioner,
toppen är bara text, färgerna används knappt och mono-typsnittet i etiketter ger
en instrumentpanelskänsla. Redesignen görs i fyra steg:

1. **Visuell grund + startsida** (den här specen)
2. Seriesidan med egen mörk topp (tabell + omgång)
3. Ny lagsida per lokalt lag (`/lag/[id]`)
4. "Så funkar det" och systemstatus i ny stil; gamla färgtokens tas bort

Riktning: **matchdag** — sportigt och energiskt, stora siffror. Sidan har en
**mörk matchdagszon** överst och **ljusa läszoner** under.

## Mål

- Startsidan har en tydlig huvudattraktion (veckans match) och visar alltid vad
  som händer för de lokala lagen just nu.
- Ett gemensamt visuellt system (färger, typografi, navigering, sidfot,
  matchlista) som steg 2–4 bygger vidare på.
- Startsidans kod delas upp i ren logik + små komponenter.

Utanför scope: seriesidans, lagsidans och övriga sidors innehållslayout (steg
2–4), nya datakällor, bilder till nyheter.

## Startsidans innehåll

### Mörk zon (matchdag)

**Veckans match.** Väljs bland de lokala lagens matcher med avspark inom de
närmaste 7 dagarna (från nu):

1. Ett **lokalderby** (båda lagen lokala) vinner alltid. Flera derbyn → det
   tidigaste.
2. Annars matchen där det lokala laget har **bäst tabellplacering** (lägst
   position). Lika → tidigast avspark.

Visas med: etikett "Veckans match", serie och datum, båda lagens emblem,
lagnamn, placering och poäng (om de finns i tabellen), och stor avsparkstid
(eller resultat, se lägen nedan). Arena visas inte (finns inte i datan).

**Omgången.** Övriga lokala matcher inom samma 7 dagar som små kort: lag, serie,
dag och avsparkstid — eller resultat om matchen är spelad.

**Lokala lag.** Alla tio lokala lag som kort, sorterade efter tabellplacering
(bäst först; lag utan tabellrad sist). Varje kort: emblem, namn, placering,
form (fem senaste spelade: V/O/F) och nästa match på två rader:

- rad 1: liten grön etikett "Nästa · <veckodag> <d/m>"
- rad 2: "<hemma|borta>" (dämpad) + motståndarens namn (vit, större)

Saknas kommande match: rad 2 blir "Ingen match inlagd" och etiketten utgår.

**Lägen** (bestäms av `lib/matchday.ts`):

| Läge | Villkor | Toppen visar |
|---|---|---|
| `upcoming` | minst en lokal match med avspark inom 7 dagar framåt | Veckans match (tid) + omgången |
| `recent` | inga kommande inom 7 dagar, men minst en spelad (`FINISHED`) lokal match de senaste 7 dagarna | Rubrik "Senaste omgången"; mest intressanta spelade matchen stort (samma urvalsregel) med resultat; övriga spelade som små kort med resultat |
| `offseason` | inget av ovan | Rubrik "Säsongen är slut" + lagkorten (slutplaceringar) |

Lagkorten visas i alla lägen. Finns varken matcher eller tabellrader visas en
kort text i stället för lagkorten.

Matcher med "Resultat saknas" (`isResultMissing`) räknas varken som kommande
eller spelade i urvalet.

### Ljus zon (läsning)

**Nyheter** (huvudspalt, ankare `#nyheter`):

- **Toppnyhet:** den senaste godkända nyheten, i ett **mörkt kort**: grön
  lagetikett, rubrik i Barlow Condensed (versaler), ingress, källa och datum.
- **Lista:** efterföljande nyheter med lagetikett, rubrik, ingress (om den
  finns), källa och datum. "Visa äldre" behålls.
- Inga nyheter → kort text, inget tomt kort.

**Sidospalt:**

- **Serier:** länkar till seriesidorna.
- **Poddar** (ankare `#poddar`): senaste avsnitten per podd, "Visa äldre"
  behålls.

**Den nuvarande sektionen "Matcher" längst ner tas bort** — omgången syns i
toppen och fullständiga listor finns på serie- och lagsidorna. Nav-länken
`/#kommande` ersätts.

### Mobil

Veckans match staplas (lag – tid – lag), omgången och lagkorten i två kolumner,
sidospalten under nyheterna.

## Visuellt system

### Färger

| Token | Värde | Användning |
|---|---|---|
| `surface-dark` | `#0e1116` | mörk zon, nav, sidfot, toppnyhetens kort |
| `surface-dark-raised` | `#171b22` | kort i mörk zon |
| `line-dark` | `#2a2f38` | linjer, formruta "F" |
| `on-dark` | `#f2f2f0` | text på mörkt |
| `on-dark-muted` | `#9aa0a8` | dämpad text på mörkt |
| `surface` | `#f4f2f2` | ljus sidbas (som i dag) |
| `surface-raised` | `#fbfafa` | kort på ljust |
| `line` | `#e4e2e3` | linjer på ljust |
| `ink` | `#1d2128` | text på ljust |
| `ink-muted` | `#565459` | sekundär text på ljust |
| `accent` | `#c6f432` | signaturfärg (neongrön) |

Regel: `accent` får vara **text** på mörka ytor men bara **fyllning** på ljusa
(etiketter, markeringar, streck) med `ink` ovanpå. Orange (`brand`) och teal
utgår som accenter.

Formrutor: V = `accent` med mörk text, O = `#4a515c` med ljus text, F =
`line-dark` med dämpad text.

**Lokala lag** markeras med fetstil + ett kort grönt streck framför namnet
(fungerar på både ljust och mörkt) i stället för teal text.

### Typografi

- **Barlow Condensed** (600/700/800): lagnamn, siffror (tider, resultat,
  placeringar, poäng), sektionsrubriker, lagetiketter, toppnyhetens rubrik.
- **Geist:** brödtext, ingresser, små etiketter.
- Geist Mono används inte längre för etiketter; siffror får
  `font-variant-numeric: tabular-nums`.

### Gemensamma komponenter

- **Navigering** (`SiteNav`): mörk, sammanhängande med den mörka zonen; logotyp
  med grön markör. Länkar: Serier (meny), Lag (meny → seriesidor tills steg 3),
  Nyheter (`/#nyheter`), Poddar (`/#poddar`), Om (Så funkar det, Systemstatus).
- **Sidfot** (`SiteFooter`, bryts ut ur `layout.tsx`): mörk.
- **Sektionsrubrik** (`SectionHeading`): versaler i Barlow Condensed med kort
  grönt streck framför; ljus och mörk variant.
- **Matchlista** (`MatchList`): resultat och tider i Barlow Condensed, lokala lag
  med grönt streck, målskyttar, "Målskyttar ej rapporterade" och "Resultat
  saknas" som i dag.
- **Emblem** (`TeamCrest`): som i dag (Everysport-emblem, monogram som
  reserv), med större storlek för veckans match.

## Arkitektur

- **`lib/matchday.ts`** — ren logik utan databas/rendering, med `now` som
  parameter:
  - `pickFeatured(matches, positions, localIds)` → veckans match
  - `matchdayMode(matches, localIds, now)` → `upcoming | recent | offseason`
    + de matcher som hör till läget
  - `teamSummaries(...)` → per lokalt lag: placering, poäng, form (fem senaste),
    nästa match (datum, hemma/borta, motståndare)
- **`app/page.tsx`** — hämtar data (matcher, tabellrader, nyheter, poddar),
  anropar `lib/matchday.ts`, sätter ihop sidan.
- **`app/components/home/`** — `MatchdayHero`, `RoundStrip`, `TeamGrid`,
  `TeamCard`, `NewsFeed`, `Sidebar`.
- **Färgtokens:** de nya namngivna färgerna läggs i `globals.css` **bredvid** de
  befintliga omskrivna Tailwind-färgerna (`neutral-*`, `emerald-*`, `brand`),
  som seriesidan, "Så funkar det" och systemstatus fortfarande använder. De
  gamla tas bort i steg 4. Steg 1 använder bara de nya.
- **Typsnitt:** Barlow Condensed laddas via `next/font/google` i `layout.tsx`.

## Test

- **Enhetstester** för `lib/matchday.ts` med Nodes testkörare via `tsx` (redan
  devDependency), nytt script `npm test`. Fall:
  - derby vinner över bättre placerad icke-derbymatch
  - bästa placering vinner när derby saknas; lika placering → tidigast
  - läge `upcoming` / `recent` / `offseason`, inklusive gräns exakt 7 dagar
  - `isResultMissing`-matcher räknas inte
  - lagsammanfattning: form i rätt ordning, nästa match hemma/borta, lag utan
    kommande match
- **Visuell kontroll** i lokal dev-server på datorbredd och mobilbredd, alla tre
  lägen. Lägena framkallas med miljövariabeln `MATCHDAY_NOW` (ISO-datum) som
  `app/page.tsx` skickar som `now` till `lib/matchday.ts` när den är satt —
  bara lokalt, aldrig i Render. Ingen query-parameter (skulle göra sidan
  dynamisk) och databasen ändras inte.
- `tsc`, lint (inga nya fel) och `next build` före push.
