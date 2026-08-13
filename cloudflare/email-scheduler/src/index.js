const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 500;
const EXPECTED_FUNCTION_PATH = "/functions/v1/send-email-notifications";

function schedulerConfiguration(env) {
  const endpoint = env.SUPABASE_EMAIL_FUNCTION_URL;
  const secret = env.EMAIL_CRON_SECRET;

  if (!endpoint) throw new Error("SUPABASE_EMAIL_FUNCTION_URL is not configured");
  if (!secret) throw new Error("EMAIL_CRON_SECRET is not configured");

  const url = new URL(endpoint);
  const isSupabaseFunction =
    url.protocol === "https:" &&
    url.hostname.endsWith(".supabase.co") &&
    url.pathname === EXPECTED_FUNCTION_PATH &&
    !url.search &&
    !url.hash;

  if (!isSupabaseFunction) {
    throw new Error("SUPABASE_EMAIL_FUNCTION_URL must be the production Supabase email function URL");
  }

  return { secret, url: url.toString() };
}

export async function invokeEmailWorker(env, scheduledTime, fetchImpl = fetch) {
  const { secret, url } = schedulerConfiguration(env);
  const startedAt = Date.now();
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "User-Agent": "clirdec-cloudflare-email-scheduler/1.0",
    },
    body: JSON.stringify({
      scheduler: "cloudflare-cron",
      scheduledAt: new Date(scheduledTime).toISOString(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase email worker returned HTTP ${response.status}: ${responseBody.slice(0, MAX_ERROR_BODY_LENGTH)}`,
    );
  }

  let result = null;
  if (responseBody) {
    try {
      result = JSON.parse(responseBody);
    } catch {
      throw new Error("Supabase email worker returned an invalid JSON response");
    }
  }

  console.log(JSON.stringify({
    event: "email_worker_completed",
    scheduledAt: new Date(scheduledTime).toISOString(),
    durationMs: Date.now() - startedAt,
    result,
  }));

  return result;
}

export default {
  async scheduled(controller, env, context) {
    context.waitUntil(
      invokeEmailWorker(env, controller.scheduledTime).catch((error) => {
        console.error(JSON.stringify({
          event: "email_worker_failed",
          scheduledAt: new Date(controller.scheduledTime).toISOString(),
          message: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }),
    );
  },
};
