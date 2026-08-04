
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Content-Type": "application/json" };

Deno.serve(async (request) => {
  const expected = Deno.env.get("EMAIL_CRON_SECRET");
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const resendKey = Deno.env.get("RESEND_API_KEY")!;
  const from = Deno.env.get("EMAIL_FROM") || "CLSU FacultyConnect <notifications@example.com>";

  const { data: queued, error } = await supabase
    .from("email_notifications")
    .select("id, recipient_id, subject, body, attempts, profiles!recipient_id(email,full_name)")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .lt("attempts", 4)
    .limit(25);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });

  let sent = 0;
  for (const item of queued || []) {
    const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
    await supabase.from("email_notifications").update({ status: "processing", attempts: item.attempts + 1 }).eq("id", item.id);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [profile.email],
          subject: item.subject,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><div style="background:#006b3c;color:white;padding:18px 22px;border-bottom:6px solid #f4c430"><strong>CLSU FacultyConnect</strong><br><small>Managed by MISO · CLIRDEC pilot</small></div><div style="padding:24px;border:1px solid #dbe4dc"><p>Hello ${profile.full_name},</p><p>${item.body}</p><p><a href="${Deno.env.get("PORTAL_URL") || "http://localhost:5173"}" style="background:#006b3c;color:white;padding:10px 16px;text-decoration:none;border-radius:6px">Open FacultyConnect</a></p><p style="color:#68776e;font-size:12px">This is an automated appointment notification. Do not reply with confidential information.</p></div></div>`,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      await supabase.from("email_notifications").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", item.id);
      sent++;
    } catch (cause) {
      await supabase.from("email_notifications").update({ status: "queued", last_error: String(cause) }).eq("id", item.id);
    }
  }
  return new Response(JSON.stringify({ processed: queued?.length || 0, sent }), { headers: cors });
});
