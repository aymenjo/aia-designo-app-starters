import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Les liens de connexion du Supabase local ramènent sur 127.0.0.1 (site_url). Sans cette ligne, un
  // `next dev` lancé sans -H bloque le JS client pour cette origine, et les pages ne s'hydratent pas.
  allowedDevOrigins: ["127.0.0.1"],
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
