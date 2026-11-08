import { applyD1Migrations, env } from 'cloudflare:test';

const migrations = (env as { TEST_MIGRATIONS?: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS ?? [];
if (migrations.length > 0) {
  await applyD1Migrations((env as unknown as { DB: D1Database }).DB, migrations);
}
