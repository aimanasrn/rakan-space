import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    instantInsights: {
      // The workspace (/w/[org]) is a client-rendered, authenticated area
      // (see the Next.js SPA guide): its content depends on the signed-in user
      // and loads in the browser behind page-level <Suspense> skeletons, so the
      // dev-time instant-navigation validator cannot render those segments on
      // the server. Only validate segments that explicitly export `instant`.
      validationLevel: "manual-warning",
    },
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
