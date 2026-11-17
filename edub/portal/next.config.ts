import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type-check runs as its own step (`npm run typecheck`) in deploy.sh.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  // Do not let `next dev` drop AGENTS.md / CLAUDE.md files into the repo.
  agentRules: false,
  // deploy.sh builds into a staging dir (EDUB_NEXT_DIST_DIR) then swaps it into `.next`.
  distDir: process.env.EDUB_NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
