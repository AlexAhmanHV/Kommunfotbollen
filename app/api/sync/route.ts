import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";

// Manuell/cron-endpoint för full synk (matcher + nyheter + AI-filter).
// Svarar alltid 200 med en status så en cron-klient inte fastnar i retry-loop.
export async function POST() {
  const started = Date.now();
  try {
    await syncAll();
    return NextResponse.json({ ok: true, ms: Date.now() - started });
  } catch (err) {
    console.error("[sync] /api/sync misslyckades:", err);
    return NextResponse.json({
      ok: false,
      error: String(err),
      ms: Date.now() - started,
    });
  }
}
