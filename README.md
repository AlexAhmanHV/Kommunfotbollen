# Kommunfotbollen

Ett hyperlokalt nav för fotbollen i Västervik med omnejd: tabeller, resultat, målskyttar, nyheter och poddar — samlat på ett ställe och hållet uppdaterat helt automatiskt, utan manuell redigering.

**Live:** [systemstatus-sidan](https://kommunfotboll.se/systemstatus) visar i realtid när varje bakgrundsjobb senast kördes och hur mycket data som samlats in.

## Vad appen gör

- **Tabeller & matcher** — hämtas från Everysport för fyra lokala serier, synkas var 15:e minut.
- **Målskyttar** — Everysport saknar målskyttar på den här nivån, så appen skrapar lokaltidningarnas (Dagens Västervik, Vimmerby Tidning) matchreferat direkt och läser ut vem som gjorde mål med Claude, med matchens redan kända resultat som facit för att undvika gissningar.
- **Nyheter** — artiklar om de lokala lagen samlas in via sektionsskrapning av lokaltidningarna, RSS och Google News som djupare/mer motståndskraftigt komplement, med dubblettfiltrering och AI-relevansbedömning.
- **Poddar** — episoder från de lokala fotbollspoddarna Nykritat och Fotbollsviken.
- **Systemstatus** — en öppen vy över driften: senast körda jobb, mängd insamlad data och hur pipelinen är uppbyggd.

## Teknikstack

- [Next.js 16](https://nextjs.org) (App Router, Server Components)
- [PGlite](https://pglite.dev) — inbäddad Postgres (WASM), ingen extern databas att drifta
- [Drizzle ORM](https://orm.drizzle.team)
- [Zod](https://zod.dev) för validering av extern data
- [Tailwind CSS v4](https://tailwindcss.com)
- [Claude](https://www.anthropic.com/claude) (`claude-haiku-4-5`) för relevansbedömning och målskytte-extraktion

## Arkitektur i korthet

```
Everysport, lokaltidningar, Google News, poddflöden
                    │
                    ▼
     AI-extraktion (Claude) — relevans & målskyttar
                    │
                    ▼
        PGlite + Drizzle (inbäddad databas)
                    │
                    ▼
          Next.js Server Components
```

Appen är sin egen cron: `instrumentation.ts` schemalägger matchsynk var 15:e minut och nyhets-/poddsynk dagligen kl 22:00 (svensk tid), utan extern schemaläggare.

## Köra lokalt

```bash
npm install
npm run dev
```

Öppna [http://localhost:3000](http://localhost:3000).

Sätt `ANTHROPIC_API_KEY` i en `.env.local`-fil för att aktivera AI-relevansbedömning och målskytte-extraktion — utan den körs matcher/tabeller som vanligt, men nyheter/målskyttar hoppas över.

`/api/sync` kan anropas manuellt för att köra alla synkjobb direkt, som backup eller för felsökning.

## Bakgrund

Ett portfolioprojekt av [Alex Åhman](https://alexahman.se) — byggt för att visa upp ett komplett, källagnostiskt insamlingssystem: flera datakällor, AI-driven extraktion med strikta regler mot att gissa, och en databas som sköter sig själv.
