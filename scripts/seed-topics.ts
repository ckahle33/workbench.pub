import { AtpAgent } from '@atproto/api';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Session } from '../src/auth/oauth';
import { createTopic } from '../src/records/write';

export interface SeedTopic {
  slug: string;
  name: string;
  description: string;
}

export const SEED_TOPICS: SeedTopic[] = [
  { slug: 'electronics', name: 'Electronics', description: 'Circuits, microcontrollers, soldering and anything that runs on a battery or a wall plug.' },
  { slug: 'music-production', name: 'Music production', description: 'Recording, synthesis, sampling, mixing and the gear and software used to make music.' },
  { slug: 'ceramics', name: 'Ceramics', description: 'Hand-building, wheel throwing, glazing and firing clay.' },
  { slug: 'woodworking', name: 'Woodworking', description: 'Furniture, joinery and other projects built with hand tools and machines.' },
  { slug: 'illustration', name: 'Illustration', description: 'Drawing, painting and digital art, from sketchbook pages to finished pieces.' },
  { slug: '3d-printing', name: '3D printing', description: 'Designing, printing and finishing parts on filament and resin printers.' },
];

async function existingSlugs(session: Session): Promise<Set<string>> {
  const slugs = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await session.agent.com.atproto.repo.listRecords({
      repo: session.did,
      collection: 'pub.workbench.topic',
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      const slug = (r.value as { slug?: unknown }).slug;
      if (typeof slug === 'string') slugs.add(slug);
    }
    cursor = res.data.cursor;
  } while (cursor);
  return slugs;
}

/** Creates the seed topics that do not exist yet. Returns the slugs it created. */
export async function seed(session: Session): Promise<string[]> {
  const present = await existingSlugs(session);
  const created: string[] = [];
  for (const t of SEED_TOPICS) {
    if (present.has(t.slug)) continue;
    try {
      await createTopic(session, { name: t.name, description: t.description });
    } catch {
      throw new Error(
        `Seeding stopped at topic "${t.slug}". Created before the failure: ${created.length ? created.join(', ') : 'none'}. Re-run to continue.`,
      );
    }
    created.push(t.slug);
  }
  return created;
}

export function readSeedEnv(env: Record<string, string | undefined>): { identifier: string; password: string } {
  const identifier = env.SEED_IDENTIFIER?.trim();
  const password = env.SEED_APP_PASSWORD?.trim();
  const missing = [!identifier && 'SEED_IDENTIFIER', !password && 'SEED_APP_PASSWORD'].filter(Boolean);
  if (missing.length || !identifier || !password) {
    throw new Error(`Missing environment variable(s): ${missing.join(', ')}. Set the site account handle and an app password.`);
  }
  return { identifier, password };
}

async function main(): Promise<void> {
  const { identifier, password } = readSeedEnv(process.env);
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier, password });
  const did = agent.did;
  if (!did) throw new Error('Login did not return a DID');
  const handle = agent.session?.handle ?? identifier;
  const session = { did, handle, agent } as unknown as Session;
  console.log(`Signed in as ${handle}`);
  const created = await seed(session);
  const skipped = SEED_TOPICS.map((t) => t.slug).filter((s) => !created.includes(s));
  console.log(`Created: ${created.length ? created.join(', ') : 'none'}`);
  console.log(`Skipped (already present): ${skipped.length ? skipped.join(', ') : 'none'}`);
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : 'Seeding failed');
    process.exit(1);
  });
}
