// Netlify Scheduled Function.
//
// Recovers the Marsha run queue on a cron tick so queued or running chains keep
// advancing even when no owner browser is open. Marsha already processes runs
// immediately after creation; this scheduled function is the safety net for
// closed tabs and long-running provider polls that resume across ticks.
//
// The schedule is declared in `netlify.toml` under
// `[functions."process-runs"]`. It calls the idempotent, bearer-guarded
// `GET /api/cron/process-runs` endpoint using the shared `APP_CRON_SECRET`.
//
// Setup: set `APP_CRON_SECRET` in the Netlify site environment with the
// Functions scope (values from `netlify.toml` are NOT exposed to functions).
// `URL` is a Netlify read-only variable available at runtime. Without
// `APP_CRON_SECRET` the recovery sweep is skipped and runs still advance
// after creation.
//
// Scheduled functions have a short execution limit, so a slower run finishes
// its poll on the route's own invocation and resumes on the next tick.

const SCHEDULED_FUNCTION_BUDGET_MS = 25_000;
const PROCESS_RUNS_BATCH_LIMIT = 5;

export default async function processRuns(): Promise<Response> {
  const cronSecret = process.env.APP_CRON_SECRET;
  const siteUrl = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;

  if (!cronSecret || !siteUrl) {
    return new Response(
      'APP_CRON_SECRET or site URL not configured; skipping scheduled run recovery.',
      { status: 200 },
    );
  }

  const target = new URL('/api/cron/process-runs', siteUrl);
  target.searchParams.set('limit', String(PROCESS_RUNS_BATCH_LIMIT));

  try {
    const response = await fetch(target, {
      method: 'GET',
      headers: { authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(SCHEDULED_FUNCTION_BUDGET_MS),
    });

    return new Response(`Run recovery responded ${response.status}.`, {
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';

    return new Response(`Run recovery kick issued (${message}).`, {
      status: 200,
    });
  }
}
