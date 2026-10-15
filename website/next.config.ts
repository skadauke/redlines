import type { NextConfig } from 'next';

// Static export for GitHub Pages: `next build` writes a plain static site to
// out/, with no server at runtime. Consequences of that host:
//   - No API routes, server actions, redirects or custom headers.
//   - Images can't be optimized on request, so they're served as they are.
//   - trailingSlash keeps every route as dir/index.html, which Pages serves at
//     /dir/ (and redirects /dir to /dir/).
//
// BASE_PATH: without a custom domain, Pages serves a project site under
// /<repository>/, so every asset URL needs that prefix. The deploy workflow
// passes the base path that actions/configure-pages reports; it becomes ''
// once a custom domain is set, so the same build works before and after.
// Local builds leave it unset and serve from /.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: process.env.BASE_PATH || '',
  images: { unoptimized: true },
  // website/ is its own npm project, outside the pnpm workspace. Without this
  // pin, Next finds the repository's pnpm-workspace.yaml and silently makes the
  // whole monorepo the project root. npm scripts run from website/.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
