# Marsha Agent Guide

Marsha is a standalone BabySea OSS starter for chaining image and video models into one durable workload. Every output becomes the next input, while caller apps use Marsha API keys and provider credentials stay server-side.

## Scope

Use this guide for changes inside the Marsha starter, especially API routes, chain templates, provider execution, persistence, deploy configuration, and starter documentation.

## Working Rules

- State assumptions before changing behavior, especially around chain execution, auth, persistence, or deployment settings.
- Keep changes surgical. Do not refactor route handlers, templates, or migrations unless the requested behavior requires it.
- Prefer the smallest implementation that preserves the public API contract.
- Update only docs, env examples, doctor checks, tests, or changelog entries that are directly affected by the change.
- Verify with the narrowest useful command first, then broaden when shared behavior is touched.

## Layout

| Path                               | Purpose                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `app/api/v1/chains`                | Lists chain templates and input contracts                                     |
| `app/api/v1/chains/runs`           | Creates durable chain runs for caller apps                                    |
| `app/api/v1/chains/get/[runId]`    | Gets run state and auto-advances if still in flight                           |
| `app/api/v1/chains/cancel/[runId]` | Cancels a run and active provider generation when possible                    |
| `app/api/cron/process-runs`        | Vercel Cron entry point for queued/running chains                             |
| `app/api/webhooks/babysea`         | BabySea webhook receiver for terminal generation events                       |
| `lib/chains/templates.ts`          | Chain template DSL and built-in templates                                     |
| `lib/chains/runner.ts`             | Provider-backed chain state machine                                           |
| `lib/chains/store.ts`              | Aurora persistence adapter                                                    |
| `lib/api/auth.ts`                  | Caller API-key auth, scopes, and private-schema verifier lookup               |
| `lib/providers/*`                  | BabySea, BFL, and BytePlus provider adapters                                  |
| `scripts/db-migrate.mjs`           | Private schema for API keys, run state, webhooks, callbacks, and audit tables |
| `scripts/doctor.mjs`               | Deployment wiring validator                                                   |

## Conventions

- Keep every secret described in `.env.example` server-only unless the template explicitly marks it as public. Caller apps authenticate with Marsha API keys, not provider keys.
- Persisted caller API keys must stay in `app_private` with prefix lookup and bcrypt hashes. Env bootstrap keys are for deployment bootstrap and should be rotated toward database-backed keys.
- Chain runs are async by default. Route handlers create, poll, or advance one provider step per invocation.
- Do not change route duration, max runtime, or cron cadence unless explicitly requested.
- Every provider generation step uses a deterministic idempotency key: `marsha:${runId}:${stepKey}:${chainVersion}`.
- Store request params, request ids, generation ids, provider order, provider used, provider metadata, and output URLs for per-model debugging.
- Use the Aurora connection (`DATABASE_URL`) only on the server. Public clients should call Marsha routes and never access `app_private` directly.
- Prefer adding chain behavior through `defineChainTemplate()` instead of branching route handlers.

## Verification

- `pnpm run doctor`
- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:run`
- `pnpm build`
