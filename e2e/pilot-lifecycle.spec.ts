import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import * as OTPAuth from "otpauth";

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

let mfaSecrets: Record<string, string> = {};
try {
  mfaSecrets = JSON.parse(readFileSync(".e2e-mfa.json", "utf8")) as Record<string, string>;
} catch {
  // Public accessibility checks can run without seeded privileged accounts.
  // The lifecycle seeder creates this ignored file before authenticated tests.
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
  const mfaSecret = mfaSecrets[email];
  if (mfaSecret) {
    await expect(page.getByRole("heading", { name: "Two-step verification required" })).toBeVisible();
    const totp = new OTPAuth.TOTP({
      issuer: "CLSU FacultyConnect",
      label: email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: mfaSecret,
    });
    await page.getByLabel("Six-digit verification code").fill(totp.generate());
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page.getByRole("button", { name: /Sign out/i })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect(page.getByRole("heading", { name: "Log in to your portal" })).toBeVisible();
}

async function dismissFacultyOnboarding(page: Page) {
  const skipButton = page.getByRole("button", { name: "Skip for now" });
  await skipButton.waitFor({ state: "visible", timeout: 10_000 });
  await skipButton.click();
  await expect(skipButton).toBeHidden();
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
    await expect(page.getByText(/request (?:was submitted|sent to)/i)).toBeVisible();
    await signOut(page);
  });

  let appointmentId = "";
  await test.step("faculty approves the request", async () => {
    await signIn(page, admin, env.TEST_FACULTY_EMAIL);
    await dismissFacultyOnboarding(page);
    await page.getByRole("button", { name: "Requests", exact: true }).click();
    const request = page.locator("article").filter({ hasText: topic });
    await expect(request).toBeVisible();
    await request.getByRole("button", { name: /Accept \+ email/ }).click();
    await page.getByRole("button", { name: /Approved/ }).click();
    await expect(page.locator("article").filter({ hasText: topic })).toBeVisible();
    const { data, error } = await admin.from("appointments").select("id,availability_id").eq("topic", topic).single();
    if (error || !data) throw error || new Error("The E2E appointment was not stored.");
    appointmentId = data.id;
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

  await test.step("completed consultation appears in the faculty portal", async () => {
    // Production correctly prevents moving published availability inside the
    // 24-hour notice window. Transition only this dedicated E2E appointment
    // with the server-side test client, then verify the completed UI and review
    // workflow without weakening the live scheduling rule.
    const { error } = await admin.from("appointments").update({ status: "completed" }).eq("id", appointmentId);
    if (error) throw error;
    await page.reload();
    await page.getByRole("button", { name: "Requests", exact: true }).click();
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

test("@a11y public authentication and policy pages have no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Log in to your portal" })).toBeVisible();
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""))).toEqual([]);
  await page.goto("/privacy-policy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  const policyResults = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(policyResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""))).toEqual([]);
});

test("@a11y dark appearance persists across public pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const authResults = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(authResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""))).toEqual([]);

  await page.goto("/privacy-policy");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
});
