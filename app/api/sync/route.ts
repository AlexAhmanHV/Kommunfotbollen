import { NextRequest, NextResponse } from "next/server";
import { syncAll, syncMatches, syncNewsAndFilter } from "@/lib/sync";

// Manuell/cron-endpoint. Anropas av GitHub Actions (var 15:e min för
// matcher, dagligen för nyheter) och kan även köras manuellt utan
// target-param för en full synk (backup/felsökning).
// Kräver Authorization: Bearer <CRON_SECRET> om CRON_SECRET är satt.
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const target = req.nextUrl.searchParams.get("target");
  const started = Date.now();
  try {
    if (target === "matches") {
      await syncMatches();
    } else if (target === "news") {
      await syncNewsAndFilter();
    } else {
      await syncAll();
    }
    return NextResponse.json({ ok: true, target: target ?? "all", ms: Date.now() - started });
  } catch (err) {
    console.error("[sync] /api/sync misslyckades:", err);
    return NextResponse.json({
      ok: false,
      error: String(err),
      ms: Date.now() - started,
    });
  }
}
