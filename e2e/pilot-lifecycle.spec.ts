import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "TEST_STUDENT_EMAIL",
  "TEST_FACULTY_EMAIL",
  "TEST_ADMIN_EMAIL",
  "TEST_USER_PASSWORD",
] as const;

function environment() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing E2E configuration: ${missing.join(", ")}`);
  return Object.fromEntries(required.map((key) => [key, process.env[key]!])) as Record<(typeof required)[number], string>;
}

async function signIn(page: Page, admin: SupabaseClient, email: string) {
  // Production authentication is intentionally protected by a real Turnstile
  // challenge, which a CI browser must never try to solve. Generate a one-time
  // test-only magic link with the server-side admin client so the lifecycle test
  // can exercise the authenticated application without weakening CAPTCHA.
  const redirectTo = process.env.E2E_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:4173";
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  const actionLink = data?.properties?.action_link;
  if (error || !actionLink) throw error || new Error(`Could not generate a test sign-in link for ${email}.`);

  await page.goto(actionLink);
  await expect(page.getByRole("button", { name: /Sign out/i })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect(page.getByRole("heading", { name: "Log in to your portal" })).toBeVisible();
}

test("student to admin consultation lifecycle queues and sends email", async ({ page }) => {
  test.setTimeout(180_000);
  const env = environment();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const topic = `E2E lifecycle ${Date.now()}`;
  const reviewComment = `E2E review ${Date.now()}: clear and helpful consultation.`;

  await test.step("student books a faculty-published time", async () => {
    await signIn(page, admin, env.TEST_STUDENT_EMAIL);
    await page.getByRole("button", { name: "Faculty availability", exact: true }).click();
    await page.getByRole("button", { name: /Review and request/ }).first().click();
    await page.getByLabel("Consultation topic and concern").fill(topic);
    await page.getByRole("button", { name: /Submit request/ }).click();
    await expect(page.getByText(/request was submitted/i)).toBeVisible();
    await signOut(page);
  });

  let appointmentId = "";
  let availabilityId = "";
  await test.step("faculty approves the request", async () => {
    await signIn(page, admin, env.TEST_FACULTY_EMAIL);
    await page.getByRole("button", { name: "Requests", exact: true }).click();
    const request = page.locator("article").filter({ hasText: topic });
    await expect(request).toBeVisible();
    await request.getByRole("button", { name: /Accept \+ email/ }).click();
    await page.getByRole("button", { name: /Approved/ }).click();
    await expect(page.locator("article").filter({ hasText: topic })).toBeVisible();
    const { data, error } = await admin.from("appointments").select("id,availability_id").eq("topic", topic).single();
    if (error || !data) throw error || new Error("The E2E appointment was not stored.");
    appointmentId = data.id;
    availabilityId = data.availability_id;
  });

  await test.step("queued appointment emails are delivered", async () => {
    const functionUrl = process.env.SUPABASE_EMAIL_FUNCTION_URL;
    const cronSecret = process.env.EMAIL_CRON_SECRET;
    if (!functionUrl || !cronSecret) throw new Error("SUPABASE_EMAIL_FUNCTION_URL and EMAIL_CRON_SECRET are required to verify delivery.");
    const response = await fetch(functionUrl, { method: "POST", headers: { Authorization: `Bearer ${cronSecret}` } });
    expect(response.ok, await response.text()).toBeTruthy();
    const { data, error } = await admin.from("email_notifications").select("event_type,status").eq("appointment_id", appointmentId).in("event_type", ["request_submitted", "request_approved"]);
    if (error) throw error;
    expect(data?.length).toBeGreaterThanOrEqual(4);
    expect(data?.every((item) => item.status === "sent")).toBeTruthy();
  });

  await test.step("faculty completes the elapsed consultation", async () => {
    const endsAt = new Date(Date.now() - 60_000);
    const startsAt = new Date(endsAt.getTime() - 30 * 60_000);
    const { error } = await admin.from("availability").update({ starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }).eq("id", availabilityId);
    if (error) throw error;
    await page.reload();
    await page.getByRole("button", { name: "Requests", exact: true }).click();
    await page.getByRole("button", { name: /Approved/ }).click();
    const request = page.locator("article").filter({ hasText: topic });
    await request.getByRole("button", { name: "Mark completed" }).click();
    await page.getByRole("button", { name: /Completed/ }).click();
    await expect(page.locator("article").filter({ hasText: topic })).toBeVisible();
    await signOut(page);
  });

  await test.step("student submits a review", async () => {
    await signIn(page, admin, env.TEST_STUDENT_EMAIL);
    await page.getByRole("button", { name: "My requests" }).click();
    const request = page.locator("article").filter({ hasText: topic });
    await request.getByRole("button", { name: "5 stars" }).click();
    await request.getByLabel("Optional comment").fill(reviewComment);
    await request.getByRole("button", { name: "Submit review" }).click();
    await expect(request.getByText("Saved")).toBeVisible();
    await signOut(page);
  });

  await test.step("administrator sees the review report", async () => {
    await signIn(page, admin, env.TEST_ADMIN_EMAIL);
    await page.getByRole("button", { name: /Reviews and insights/ }).click();
    await expect(page.getByText(reviewComment)).toBeVisible();
  });
});

test("public authentication page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Log in to your portal" })).toBeVisible();
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""))).toEqual([]);
});
