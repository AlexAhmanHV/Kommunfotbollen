import { NextResponse } from "next/server";
import { desc, isNull, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { articles, articleTeams, teams } from "@/lib/db/schema";

// Debug/admin: relevans-statistik + rejekterade taggar.
export async function GET() {
  const db = await getDb();
  const [pending] = await db
    .select({ n: sql<number>`count(*)` })
    .from(articleTeams)
    .where(isNull(articleTeams.checkedAt));
  const [rejected] = await db
    .select({ n: sql<number>`count(*)` })
    .from(articleTeams)
    .where(eq(articleTeams.relevant, false));
  const [approved] = await db
    .select({ n: sql<number>`count(*)` })
    .from(articleTeams)
    .where(eq(articleTeams.relevant, true));

  const rejectedRows = await db
    .select({ title: articles.title, team: teams.name })
    .from(articleTeams)
    .innerJoin(articles, eq(articleTeams.articleId, articles.id))
    .innerJoin(teams, eq(articleTeams.teamId, teams.id))
    .where(eq(articleTeams.relevant, false))
    .orderBy(desc(articles.publishedAt))
    .limit(24);

  // artiklar där ALLA taggar avvisades (helt dolda) — det verkligt intressanta
  const fullyHidden = await db.execute(sql`
    SELECT a.title, a.source
    FROM articles a
    WHERE a.published_at >= now() - interval '60 days'
      AND NOT EXISTS (
        SELECT 1 FROM article_teams t
        WHERE t.article_id = a.id AND (t.relevant IS NULL OR t.relevant = true)
      )
      AND EXISTS (SELECT 1 FROM article_teams t WHERE t.article_id = a.id)
    ORDER BY a.published_at DESC
    LIMIT 30
  `);

  // synliga artiklar (minst en tagg relevant≠false) grupperat per källa + ålder
  const visible = await db.execute(sql`
    SELECT a.title, a.source,
           (a.published_at >= now() - interval '7 days') AS recent
    FROM articles a
    WHERE a.published_at >= now() - interval '60 days'
      AND EXISTS (
        SELECT 1 FROM article_teams t
        WHERE t.article_id = a.id AND (t.relevant IS NULL OR t.relevant = true)
      )
    ORDER BY a.published_at DESC
  `);
  const rows = visible.rows as { title: string; source: string; recent: boolean }[];
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;

  return NextResponse.json({
    pending: pending.n,
    approved: approved.n,
    rejected: rejected.n,
    visibleTotal: rows.length,
    visibleRecent: rows.filter((r) => r.recent).length,
    visibleBySource: bySource,
    dvTitles: rows.filter((r) => /Dagens Västervik/i.test(r.source)).map((r) => r.title),
    rejectedPairs: rejectedRows,
    fullyHidden: fullyHidden.rows,
  });
}
