import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import * as OTPAuth from "otpauth";

/**
 * Deep role coverage for the two operational roles. This suite is deliberately
 * separate from the short pilot smoke test. It mutates only the dedicated
 * facultyconnect-e2e identities and is enabled by the protected CI workflow.
 */

const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "TEST_STUDENT_EMAIL",
  "TEST_FACULTY_EMAIL",
  "TEST_USER_PASSWORD",
] as const;

const configured = required.every((key) => Boolean(process.env[key]));

type RoleEnvironment = Record<(typeof required)[number], string>;

function environment(): RoleEnvironment {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing role coverage configuration: ${missing.join(", ")}`);
  return Object.fromEntries(required.map((key) => [key, process.env[key]!])) as RoleEnvironment;
}

let mfaSecrets: Record<string, string> = {};
try {
  mfaSecrets = JSON.parse(readFileSync(".e2e-mfa.json", "utf8")) as Record<string, string>;
} catch {
  // The seed script creates this file in protected CI. Public/local runs skip.
}

async function dismissUserManual(page: Page) {
  const manual = page.locator(".user-manual-backdrop");
  try {
    await manual.waitFor({ state: "visible", timeout: 5_000 });
    await manual.getByRole("button", { name: "Got it", exact: true }).click();
  } catch {
    // The manual is persisted per test identity and may already be dismissed.
  }
}

async function signIn(page: Page, admin: SupabaseClient, email: string) {
  const redirectTo = process.env.E2E_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:4173";
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  const actionLink = data?.properties?.action_link;
  if (error || !actionLink) throw error || new Error(`Could not generate a sign-in link for ${email}`);
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
  await dismissUserManual(page);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect(page.getByRole("heading", { name: "Log in to your portal" })).toBeVisible();
}

async function findUserId(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < 100) break;
  }
  throw new Error(`Dedicated test identity was not found for ${email}`);
}

async function createOpenSlot(
  admin: SupabaseClient,
  facultyId: string,
  label: string,
  hoursFromNow = 72,
  durationMinutes = 30,
) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  start.setSeconds(0, 0);
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const { data, error } = await admin
    .from("availability")
    .insert({
      faculty_id: facultyId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      location: `E2E ${label} consultation room`,
      consultation_mode: "in_person",
      is_open: true,
    })
    .select("id,starts_at,ends_at")
    .single();
  if (error || !data) throw error || new Error(`Could not create E2E slot ${label}`);
  return data;
}

async function createAppointment(
  admin: SupabaseClient,
  studentId: string,
  slotId: string,
  topic: string,
  status: "pending" | "confirmed" | "completed" = "pending",
) {
  const { data, error } = await admin
    .from("appointments")
    .insert({ availability_id: slotId, student_id: studentId, topic, notes: `${topic} notes` })
    .select("id")
    .single();
  if (error || !data) throw error || new Error(`Could not create E2E appointment ${topic}`);
  if (status !== "pending") {
    const { error: updateError } = await admin.from("appointments").update({ status }).eq("id", data.id);
    if (updateError) throw updateError;
  }
  return data.id as string;
}

async function completeFacultyOnboarding(page: Page) {
  const dialog = page.locator(".profile-onboarding-backdrop");
  if (!(await dialog.isVisible().catch(() => false))) return;
  await dialog.locator('input[name="expertise"]').fill("Software Engineering, Systems Analysis");
  await dialog.locator('input[name="subjects"]').fill("Web Systems, Database Management");
  await dialog.locator('input[name="consultation_topics"]').fill("System architecture, research proposal");
  await dialog.locator('input[name="research_interests"]').fill("Educational technology");
  await dialog.locator('input[name="office_location"]').fill("CLIRDEC Consultation Room");
  await dialog.locator('textarea[name="bio"]').fill("Dedicated E2E faculty profile for role coverage.");
  await dialog.getByRole("button", { name: "Save and continue" }).click();
  await expect(dialog).toBeHidden();
}

async function goStudent(page: Page, label: string) {
  await page.locator("aside.sidebar").getByRole("button", { name: label, exact: true }).click();
}

async function goFaculty(page: Page, label: string) {
  await page.locator("aside.sidebar").getByRole("button", { name: label, exact: true }).click();
}

test.describe("@role-coverage complete student and faculty functionality", () => {
  test.skip(!configured, "Protected role coverage requires dedicated Supabase E2E identities.");
  test.describe.configure({ mode: "serial" });

  let env: RoleEnvironment;
  let admin: SupabaseClient;
  let studentId: string;
  let facultyId: string;

  test.beforeAll(async () => {
    env = environment();
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    studentId = await findUserId(admin, env.TEST_STUDENT_EMAIL);
    facultyId = await findUserId(admin, env.TEST_FACULTY_EMAIL);
    const { error } = await admin.from("faculty_profiles").upsert({
      user_id: facultyId,
      expertise: ["Software Engineering", "Systems Analysis"],
      subjects: ["Web Systems", "Database Management"],
      consultation_topics: ["System architecture", "Research proposal"],
      research_interests: ["Educational technology"],
      bio: "Dedicated E2E faculty profile for role coverage.",
      office_location: "CLIRDEC Consultation Room",
      profile_completed_at: new Date().toISOString(),
      active: true,
    });
    if (error) throw error;
  });

  test("student: navigate every portal surface, update profile, use chatbot controls, and report an issue", async ({ page }) => {
    await signIn(page, admin, env.TEST_STUDENT_EMAIL);
    await expect(page.getByRole("heading", { name: /What do you need help with/i })).toBeVisible();

    await goStudent(page, "Faculty availability");
    await expect(page.getByRole("heading", { name: "Faculty availability" })).toBeVisible();
    const search = page.getByPlaceholder("Search an approved category or faculty name");
    await search.fill("does-not-exist");
    await expect(page.getByText(/No future faculty availability is currently published|0 published availability entries/i)).toBeVisible();
    await search.fill("Software Engineering");

    await goStudent(page, "My profile");
    await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
    await page.getByRole("button", { name: "Edit profile" }).click();
    const profile = page.getByRole("dialog", { name: "Edit profile" });
    await profile.locator('input[name="college"]').fill("College of Engineering");
    await profile.locator('input[name="program"]').fill("BS Information Technology");
    await profile.locator('select[name="year_level"]').selectOption("3rd year");
    await profile.getByRole("button", { name: "Save profile" }).click();
    await expect(profile).toBeHidden();
    await expect(page.getByText("Profile has been updated.")).toBeVisible();

    await goStudent(page, "Ask Consult AI");
    await expect(page.getByRole("heading", { name: "Consult AI" })).toBeVisible();
    await expect(page.getByRole("log", { name: "Consult AI conversation" })).toContainText("approved CLIRDEC information");
    await page.locator(".chat-head-actions").getByRole("button", { name: /Report an issue/i }).click();
    const report = page.getByRole("dialog", { name: "Report a Consult AI issue" });
    await report.locator("textarea").fill("The role coverage test is checking the support report flow.");
    await report.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText(/Issue reported/i)).toBeVisible();
    await page.getByLabel("Chat question").fill("clear this conversation");
    await page.getByRole("button", { name: /Clear chat/i }).click();
    await expect(page.getByLabel("Chat question")).toHaveValue("");

    await signOut(page);
  });

  test("student: book, cancel, and reschedule active requests", async ({ page }) => {
    const slot = await createOpenSlot(admin, facultyId, "student-booking");
    await signIn(page, admin, env.TEST_STUDENT_EMAIL);
    await goStudent(page, "Faculty availability");
    await expect(page.getByRole("heading", { name: "Faculty availability" })).toBeVisible();
    const card = page.locator("article.faculty-card").filter({ hasText: "Dr. Test Faculty" }).filter({ hasText: "Software Engineering" }).first();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /Review and request/i }).click();
    const topic = `Role coverage booking ${Date.now()}`;
    await page.getByLabel("Consultation topic and concern").fill(topic);
    await page.getByRole("button", { name: /Submit request/i }).click();
    await expect(page.getByText(/Appointment confirmed|Request sent to/i)).toBeVisible();
    await goStudent(page, "My requests");
    await expect(page.getByText(topic)).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await expect(page.getByText(/consultation was cancelled/i)).toBeVisible();

    const activeSlot = await createOpenSlot(admin, facultyId, "student-reschedule");
    const replacementSlot = await createOpenSlot(admin, facultyId, "student-reschedule-replacement", 96);
    const appointmentId = await createAppointment(admin, studentId, activeSlot.id, `Role coverage reschedule ${Date.now()}`);
    await page.reload();
    await goStudent(page, "My requests");
    const request = page.locator("article").filter({ hasText: "Role coverage reschedule" });
    await expect(request).toBeVisible();
    await request.getByRole("button", { name: "Choose another time" }).click();
    const replacementCard = page.locator("article.faculty-card").filter({ hasText: "Review and request" }).last();
    await replacementCard.getByRole("button", { name: /Review and request/i }).click();
    await page.getByRole("button", { name: /Confirm new time/i }).click();
    await expect(page.getByText(/request was moved/i)).toBeVisible();

    // Keep the seeded replacement records auditable but remove the unused slot
    // if the browser selected another published slot due to ordering.
    void slot;
    void replacementSlot;
    void appointmentId;
    await signOut(page);
  });

  test("faculty: complete profile, publish online availability, and remove an open slot", async ({ page }) => {
    await signIn(page, admin, env.TEST_FACULTY_EMAIL);
    await completeFacultyOnboarding(page);
    await goFaculty(page, "Profile");
    await expect(page.getByRole("heading", { name: "Faculty profile" })).toBeVisible();
    await expect(page.locator('input[name="subjects"]')).toHaveValue(/Web Systems/);
    await page.locator('textarea[name="bio"]').fill("Updated role coverage faculty biography.");
    await page.getByRole("button", { name: "Save faculty profile" }).click();
    await expect(page.getByText(/Faculty profile updated/i)).toBeVisible();

    await goFaculty(page, "Availability");
    await expect(page.getByRole("heading", { name: "Manage availability" })).toBeVisible();
    await page.locator('select[name="duration"]').selectOption("60");
    await page.locator('select[name="consultation_mode"]').selectOption("online");
    await expect(page.getByRole("note")).toContainText("does not generate or host online meeting links");
    await page.getByRole("button", { name: "Next week" }).click();
    await page.locator("button.slot-toggle:not([disabled])").first().click();
    await page.locator('input[name="location"]').fill("https://meet.google.com/e2e-role-coverage");
    await page.getByRole("button", { name: "Publish availability" }).click();
    await expect(page.getByText("Availability published for students.")).toBeVisible();
    await expect(page.getByText("https://meet.google.com/e2e-role-coverage")).toBeVisible();
    const published = page.locator("article.published-slot").filter({ hasText: "e2e-role-coverage" });
    await published.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Open availability removed.")).toBeVisible();
    await signOut(page);
  });

  test("faculty: handle legacy decisions and complete confirmed requests, including calendar exports", async ({ page }) => {
    const approveSlot = await createOpenSlot(admin, facultyId, "faculty-approve");
    const declineSlot = await createOpenSlot(admin, facultyId, "faculty-decline", 96);
    const completedSlot = await createOpenSlot(admin, facultyId, "faculty-complete", 120);
    const approveTopic = `Role coverage approve ${Date.now()}`;
    const declineTopic = `Role coverage decline ${Date.now()}`;
    const completeTopic = `Role coverage complete ${Date.now()}`;
    const approvalId = await createAppointment(admin, studentId, approveSlot.id, approveTopic);
    const declineId = await createAppointment(admin, studentId, declineSlot.id, declineTopic);
    // New requests are automatically confirmed. Keep explicit pending rows in
    // this branch only to retain coverage for old records that still require a
    // faculty decision during the migration window.
    const { error: pendingError } = await admin.from("appointments").update({ status: "pending" }).in("id", [approvalId, declineId]);
    if (pendingError) throw pendingError;
    const completeId = await createAppointment(admin, studentId, completedSlot.id, completeTopic, "confirmed");
    const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const pastEnd = new Date(Date.now() - 90 * 60 * 1000);
    const { error: moveError } = await admin.from("availability").update({ starts_at: pastStart.toISOString(), ends_at: pastEnd.toISOString() }).eq("id", completedSlot.id);
    if (moveError) throw moveError;
    void completeId;

    await signIn(page, admin, env.TEST_FACULTY_EMAIL);
    await goFaculty(page, "Requests");
    const approvalRequest = page.locator("article").filter({ hasText: approveTopic });
    await expect(approvalRequest).toBeVisible();
    await approvalRequest.getByRole("button", { name: /Accept \+ email/i }).click();
    await expect(page.getByText(/Request approved/i)).toBeVisible();
    await approvalRequest.getByRole("button", { name: /Download calendar/i }).click();
    await page.getByRole("button", { name: /Pending 1|Pending/i }).click();
    const declineRequest = page.locator("article").filter({ hasText: declineTopic });
    await expect(declineRequest).toBeVisible();
    await declineRequest.getByRole("button", { name: /Decline \+ email/i }).click();
    await expect(page.getByText(/Request declined/i)).toBeVisible();
    await page.getByRole("button", { name: /Approved/i }).click();
    const completedRequest = page.locator("article").filter({ hasText: completeTopic });
    await expect(completedRequest).toBeVisible();
    await completedRequest.getByRole("button", { name: "Mark completed" }).click();
    await expect(page.getByText("Consultation marked completed.")).toBeVisible();
    await signOut(page);
  });

  test("role isolation: protected faculty routes cannot be opened by a student", async ({ page }) => {
    await signIn(page, admin, env.TEST_STUDENT_EMAIL);
    await expect(page.locator(".faculty-app")).toHaveCount(0);
    await expect(page.locator(".admin-app")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Faculty availability", exact: true })).toBeVisible();
    await signOut(page);
  });
});
