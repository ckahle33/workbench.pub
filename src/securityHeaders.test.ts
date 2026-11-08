import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// public/_headers is copied to dist/ by Vite and applied by Workers static assets to asset
// responses (the HTML shell, JS/CSS, client-metadata.json). /api/* responses come from the
// Worker and are not affected.
const text = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8');

function rules(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      out.set(line.trim(), current);
    } else if (current) {
      const i = line.indexOf(':');
      current.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
  }
  return out;
}

describe('public/_headers', () => {
  const all = rules().get('/*');

  it('applies security headers to every asset path', () => {
    expect(all).toBeDefined();
    expect(all!.get('x-content-type-options')).toBe('nosniff');
    expect(all!.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(all!.get('x-frame-options')).toBe('DENY');
  });

  it('has a CSP that locks down scripts, framing, plugins and base, and allows what the app needs', () => {
    const csp = new Map(
      all!.get('content-security-policy')!.split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values.join(' ')] as const;
      }),
    );
    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('script-src')).toBe("'self'");
    expect(csp.get('object-src')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('frame-ancestors')).toBe("'none'");
    expect(csp.get('form-action')).toBe("'self'");
    // Link-card images and avatars are arbitrary https URLs; blobs come through /api/blob (self).
    expect(csp.get('img-src')).toBe("'self' data: https:");
    // The OAuth client talks to the user's own PDS and authorization server: arbitrary https origins.
    expect(csp.get('connect-src')).toBe("'self' https:");
    expect(all!.get('content-security-policy')).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it('leaves the OAuth client metadata readable as JSON (no rule overrides its content type)', () => {
    for (const [, headers] of rules()) expect(headers.has('content-type')).toBe(false);
  });
});
