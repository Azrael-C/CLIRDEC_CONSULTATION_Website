import assert from "node:assert/strict";
import test from "node:test";

import worker, { invokeEmailWorker } from "../src/index.js";

const endpoint = "https://ieuipychazciovjhkpps.supabase.co/functions/v1/send-email-notifications";
const scheduledTime = Date.UTC(2026, 7, 12, 12, 0, 0);

test("invokes the protected Supabase function with the cron secret", async () => {
  let captured;
  const result = await invokeEmailWorker(
    { SUPABASE_EMAIL_FUNCTION_URL: endpoint, EMAIL_CRON_SECRET: "test-secret" },
    scheduledTime,
    async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ processed: 2, sent: 2 }), { status: 200 });
    },
  );

  assert.equal(captured.url, endpoint);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer test-secret");
  assert.deepEqual(JSON.parse(captured.options.body), {
    scheduler: "cloudflare-cron",
    scheduledAt: "2026-08-12T12:00:00.000Z",
  });
  assert.deepEqual(result, { processed: 2, sent: 2 });
});

test("rejects an unexpected target before sending a request", async () => {
  await assert.rejects(
    invokeEmailWorker(
      { SUPABASE_EMAIL_FUNCTION_URL: "https://example.com/worker", EMAIL_CRON_SECRET: "test-secret" },
      scheduledTime,
      async () => assert.fail("fetch should not be called"),
    ),
    /must be the production Supabase email function URL/,
  );
});

test("fails the cron invocation when Supabase returns an error", async () => {
  await assert.rejects(
    invokeEmailWorker(
      { SUPABASE_EMAIL_FUNCTION_URL: endpoint, EMAIL_CRON_SECRET: "test-secret" },
      scheduledTime,
      async () => new Response("Unauthorized", { status: 401 }),
    ),
    /HTTP 401: Unauthorized/,
  );
});

test("scheduled handler registers the invocation with waitUntil", async () => {
  const originalFetch = globalThis.fetch;
  let pending;
  globalThis.fetch = async () => new Response(JSON.stringify({ processed: 0 }), { status: 200 });

  try {
    await worker.scheduled(
      { scheduledTime },
      { SUPABASE_EMAIL_FUNCTION_URL: endpoint, EMAIL_CRON_SECRET: "test-secret" },
      { waitUntil(promise) { pending = promise; } },
    );
    assert.ok(pending instanceof Promise);
    await pending;
  } finally {
    globalThis.fetch = originalFetch;
  }
});
