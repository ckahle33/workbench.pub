/**
 * The security headers public/_headers applies to static assets. Cloudflare documents that
 * `_headers` rules are not applied to responses a Worker produces, so the share-meta routes
 * (functions/shareMeta.ts), which return the HTML shell through the Worker, set these themselves.
 * functions/shareMeta.test.ts checks this object equals the `/*` block of public/_headers.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
