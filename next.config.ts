import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // E:\Kodning innehåller en lös package-lock.json som annars gör att
  // Turbopack gissar fel workspace-rot (bryter bl.a. CSS-uppdateringar).
  turbopack: { root: __dirname },
  // En förrendering som slår i databasens anslutningstak ska försöka igen,
  // inte fälla hela bygget.
  experimental: { staticGenerationRetryCount: 3 },
  // Everysports publika logo-CDN (lag-emblem).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.api.everysport.com" },
    ],
  },
};

export default nextConfig;
