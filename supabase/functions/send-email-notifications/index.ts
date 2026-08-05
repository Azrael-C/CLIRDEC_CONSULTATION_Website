
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = { "Content-Type": "application/json" };

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("EMAIL_CRON_SECRET");
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const portalUrl = Deno.env.get("PORTAL_URL") || "https://clsu-faculty-connect.vercel.app";
  const from = Deno.env.get("EMAIL_FROM") || "CLSU FacultyConnect <onboarding@resend.dev>";
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    return respond({ error: "Required server configuration is missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_email_notifications", { batch_size: 25 });
  if (claimError) return respond({ error: claimError.message }, 500);
  if (!claimed?.length) return respond({ processed: 0, sent: 0, failed: 0 });

  const recipientIds = [...new Set(claimed.map((item: { recipient_id: string }) => item.recipient_id))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .in("id", recipientIds);
  if (profileError) return respond({ error: profileError.message }, 500);
  const recipientById = new Map((profiles || []).map((profile) => [profile.id, profile]));

  let sent = 0;
  let failed = 0;
  for (const item of claimed) {
    const profile = recipientById.get(item.recipient_id);
    try {
      if (!profile?.email) throw new Error("Recipient profile or email is missing");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `facultyconnect-notification-${item.id}`,
        },
        body: JSON.stringify({
          from,
          to: [profile.email],
          subject: item.subject,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><div style="background:#006b3c;color:white;padding:18px 22px;border-bottom:6px solid #f4c430"><strong>CLSU FacultyConnect</strong><br><small>Managed by MISO · CLIRDEC pilot</small></div><div style="padding:24px;border:1px solid #dbe4dc"><p>Hello ${escapeHtml(profile.full_name)},</p><p>${escapeHtml(item.body)}</p><p><a href="${escapeHtml(portalUrl)}" style="background:#006b3c;color:white;padding:10px 16px;text-decoration:none;border-radius:6px">Open FacultyConnect</a></p><p style="color:#68776e;font-size:12px">This is an automated appointment notification. Do not reply with confidential information.</p></div></div>`,
        }),
      });
      if (!response.ok) throw new Error(`Resend ${response.status}: ${await response.text()}`);
      const { error: updateError } = await supabase
        .from("email_notifications")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", item.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (cause) {
      const terminal = item.attempts >= 4;
      const retryAt = new Date(Date.now() + 5 * 60_000 * 2 ** Math.max(0, item.attempts - 1));
      await supabase.from("email_notifications").update({
        status: terminal ? "failed" : "queued",
        scheduled_for: retryAt.toISOString(),
        last_error: String(cause).slice(0, 1000),
      }).eq("id", item.id);
      failed += 1;
    }
  }

  return respond({ processed: claimed.length, sent, failed });
});
