import { NextRequest, NextResponse } from "next/server";
import { syncAll, syncNewsAndFilter, syncTeams } from "@/lib/sync";

// Manuell endpoint (backup/felsökning) — den schemalagda synken körs av
// instrumentation.ts. Anropas t.ex. via GitHub Actions workflow_dispatch;
// utan target-param körs en full synk.
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
    if (target === "teams") {
      await syncTeams();
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
