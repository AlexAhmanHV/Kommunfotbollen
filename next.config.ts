import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite laddar sin Postgres-WASM via filsökvägar i runtime — den får inte
  // bundlas av Turbopack, utan måste köras som vanligt Node-paket.
  serverExternalPackages: ["@electric-sql/pglite"],
  // E:\Kodning innehåller en lös package-lock.json som annars gör att
  // Turbopack gissar fel workspace-rot (bryter bl.a. CSS-uppdateringar).
  turbopack: { root: __dirname },
  // Everysports publika logo-CDN (lag-emblem).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.api.everysport.com" },
    ],
  },
};

export default nextConfig;
