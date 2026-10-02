/** @type {import('next').NextConfig} */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let baked = '';
try {
  baked = readFileSync(resolve(here, 'src/generated/explorer-snapshot.json'), 'utf8');
} catch {
  baked = ''; // build without a baked snapshot (runtime file mode etc.)
}

const nextConfig = {
  poweredByHeader: false,
  env: {
    // Inlined into the server bundle at build time; runtime EXPLORER_RUNTIME_JSON overrides it.
    BAKED_SNAPSHOT_JSON: baked,
  },
  // Redirects handled by the routing layer (edge config) instead of a page:
  // every page.route.tsx costs one serverless function, and the free Hobby
  // plan allows 12 — see DEPLOY.md.
  async redirects() {
    return [
      // The root path now serves the project landing page (app/page.tsx);
      // only the legacy /search alias points into the localized explorer.
      { source: '/search', destination: '/th/search', permanent: false },
    ];
  },
  // Baseline hardening. No CSP: the App Router injects inline bootstrap
  // scripts, and a wrong policy would silently break hydration.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
