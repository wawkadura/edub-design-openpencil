import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type-check runs as its own step (`npm run typecheck`) in deploy.sh.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  // deploy.sh builds into a staging dir (EDUB_NEXT_DIST_DIR) then swaps it into `.next`.
  distDir: process.env.EDUB_NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
