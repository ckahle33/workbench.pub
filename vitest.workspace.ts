import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';

// Tests that need the Workers runtime and a D1 database. Everything else under
// shared/, ingest/ and scripts/ runs in plain Node.
const workersTests = ['shared/db.test.ts', 'ingest/src/apply.test.ts', 'ingest/src/drain.test.ts', 'functions/**/*.test.ts'];

const migrationsDir = fileURLToPath(new URL('./migrations', import.meta.url));

async function workersProject(): Promise<TestProjectConfiguration> {
  // migrations/ is added in a later task; tolerate its absence.
  const migrations = existsSync(migrationsDir) ? await readD1Migrations(migrationsDir) : [];
  return defineConfig({
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-01-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      name: 'workers',
      include: workersTests,
      setupFiles: ['./test/apply-migrations.ts'],
    },
  });
}

export default [
  {
    test: {
      name: 'node',
      environment: 'node',
      include: ['shared/**/*.test.ts', 'ingest/**/*.test.ts', 'scripts/**/*.test.ts'],
      exclude: ['**/node_modules/**', ...workersTests],
    },
  },
  await workersProject(),
  {
    plugins: [react()],
    test: {
      name: 'jsdom',
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./test/setup-jsdom.ts'],
    },
  },
] satisfies TestProjectConfiguration[];
