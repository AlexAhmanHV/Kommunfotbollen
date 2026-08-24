import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
