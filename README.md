# workbench.pub

A social site for makers who show their work as it happens. Post a project (a guitar pedal, a recording, a ceramic piece) and add updates over days or weeks: photos, notes, links, parts lists. Follow projects and topics, and reply to individual updates.

Built on the [AT Protocol](https://atproto.com): you sign in with an existing Bluesky/AT account, and your projects, updates and replies are stored as records in your own account (`pub.workbench.*`), not on our servers. This site indexes and displays them.

Status: deployed at https://workbench.pub (web Worker, ingest cron and D1 are live). Still to be verified live: sign-in against a real account and first posts.

## How it works

```
your account (PDS) --> Jetstream --> cron Worker --> D1 index --> Hono API --> React app
```

- `src/`: React app (Vite, React Router)
- `functions/`: Hono API (reads, link cards, image proxy, reports, admin)
- `ingest/`: cron Worker copying new `pub.workbench.*` records from Jetstream into D1
- `shared/`, `lexicons/`, `migrations/`: record schemas and validation, D1 schema
- Runs on the Cloudflare free tier.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars          # set ADMIN_TOKEN (and DEV_PLACEHOLDERS=1 for demo images)
npm run db:migrate:local
npm run db:seed:local                   # optional: fake demo content, local database only
npx wrangler dev --port 8787            # API
npm run dev                             # site: open http://127.0.0.1:5173 (not localhost: sign-in needs the IP)
```

Posts you make while signed in are written to your own account. To see them locally, run the ingest Worker against the same local database and trigger it now and then:

```bash
npx wrangler dev --config ingest/wrangler.toml --test-scheduled --persist-to .wrangler/state --port 8788
curl "http://localhost:8788/__scheduled?cron=*+*+*+*+*"
```

## Commands

`npm test` (all tests), `npm run typecheck`, `npm run build`, `npm run seed:topics`, and for deploys `npm run db:migrate:remote`, `npm run deploy:web`, `npm run deploy:ingest`.

## More

- [docs/deploy.md](docs/deploy.md): free-tier limits, deploy steps, smoke test, rollback, known risks, seeding topics
- [docs/dev-notes.md](docs/dev-notes.md): platform choice, test layout, ingest drain, sign-in client
- [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md): the visual system and product context
- `docs/superpowers/specs/` and `docs/superpowers/plans/`: the design and the build plan
