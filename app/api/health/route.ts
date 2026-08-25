import { NextResponse } from "next/server";

// Minimal liveness endpoint for uptime/keep-alive pingers — the homepage's
// full HTML payload exceeds some pingers' response-size limits.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
