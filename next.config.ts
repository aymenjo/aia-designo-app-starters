import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Les liens de connexion du Supabase local ramènent sur 127.0.0.1 (site_url). Sans cette ligne, un
  // `next dev` lancé sans -H bloque le JS client pour cette origine, et les pages ne s'hydratent pas.
  allowedDevOrigins: ["127.0.0.1"],
  // Les polices du rapport mensuel (src/lib/rapport/polices.ts) sont lues sur le disque au rendu du PDF : le traçage
  // de Vercel ne les voit pas. @react-pdf/renderer, lui, est déjà hors du bundle (liste par défaut de Next).
  outputFileTracingIncludes: {
    "/api/cron/rapport-mensuel": [
      "./node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-{700,800}-normal.woff",
      "./node_modules/@fontsource/geist/files/geist-latin-{400,500,600}-normal.woff",
      "./node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
