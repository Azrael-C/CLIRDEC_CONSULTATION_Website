import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

type NotificationItem = {
  id: string;
  appointment_id: string | null;
  recipient_id: string;
  event_type: string;
  subject: string;
  body: string;
  attempts: number;
};

type AvailabilitySummary = {
  starts_at: string;
  ends_at: string;
  location: string | null;
  consultation_mode: "in_person" | "online";
};

type AppointmentSummary = {
  id: string;
  topic: string;
  status: string;
  availability: AvailabilitySummary | AvailabilitySummary[] | null;
};

const eventPresentation: Record<string, { label: string; color: string; background: string }> = {
  request_submitted: { label: "Request received", color: "#075f3f", background: "#e6f4ed" },
  request_approved: { label: "Appointment approved", color: "#075f3f", background: "#e6f4ed" },
  request_declined: { label: "Request declined", color: "#9b2c2c", background: "#fdecec" },
  schedule_changed: { label: "Schedule updated", color: "#7a4d00", background: "#fff4d6" },
  appointment_cancelled: { label: "Appointment cancelled", color: "#9b2c2c", background: "#fdecec" },
  appointment_reminder: { label: "Appointment reminder", color: "#075f3f", background: "#e6f4ed" },
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeTextBlock(value: unknown) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function availabilityFor(appointment?: AppointmentSummary) {
  if (!appointment?.availability) return null;
  return Array.isArray(appointment.availability)
    ? appointment.availability[0] ?? null
    : appointment.availability;
}

function appointmentDetails(appointment?: AppointmentSummary) {
  const availability = availabilityFor(appointment);
  if (!appointment || !availability) return "";

  const startsAt = new Date(availability.starts_at);
  const endsAt = new Date(availability.ends_at);
  const date = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(startsAt);
  const time = `${new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(startsAt)}–${new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(endsAt)}`;
  const rows = [
    ["Consultation", appointment.topic],
    ["Date", date],
    ["Time", `${time} (Philippine Time)`],
    ["Mode", availability.consultation_mode === "online" ? "Online" : "In person"],
    ["Location", availability.location || "To be confirmed in the portal"],
  ];

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border:1px solid #d8e3dc;border-radius:12px;background:#f7faf8;border-collapse:separate;overflow:hidden">
    ${rows.map(([label, value], index) => `<tr>
      <td style="padding:${index === 0 ? "18px" : "10px"} 18px 10px;color:#617067;font-size:13px;font-weight:700;width:32%;${index > 0 ? "border-top:1px solid #e3ebe6;" : ""}">${escapeHtml(label)}</td>
      <td style="padding:${index === 0 ? "18px" : "10px"} 18px 10px;color:#10251a;font-size:14px;font-weight:600;${index > 0 ? "border-top:1px solid #e3ebe6;" : ""}">${escapeHtml(value)}</td>
    </tr>`).join("")}
  </table>`;
}

function emailTemplate(options: {
  profileName: string;
  item: NotificationItem;
  appointment?: AppointmentSummary;
  portalUrl: string;
}) {
  const { profileName, item, appointment, portalUrl } = options;
  const presentation = eventPresentation[item.event_type] ?? {
    label: "Appointment update",
    color: "#075f3f",
    background: "#e6f4ed",
  };

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#eef3ef;font-family:Arial,Helvetica,sans-serif;color:#10251a">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(item.subject)} — view the appointment details in FacultyConnect.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3ef;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d8e3dc">
          <tr><td style="background:#005b3a;padding:24px 28px;border-bottom:6px solid #f4c430">
            <div style="color:#ffffff;font-size:21px;font-weight:800;letter-spacing:-.2px">CLSU FacultyConnect</div>
            <div style="color:#cfe3d7;font-size:12px;margin-top:5px">Central Luzon State University · Managed by MISO</div>
          </td></tr>
          <tr><td style="padding:30px 28px 10px">
            <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:${presentation.background};color:${presentation.color};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">${escapeHtml(presentation.label)}</span>
            <h1 style="margin:18px 0 12px;color:#10251a;font-size:27px;line-height:1.2">${escapeHtml(item.subject)}</h1>
            <p style="margin:0 0 12px;color:#41564a;font-size:15px;line-height:1.65">Hello ${escapeHtml(profileName || "there")},</p>
            <p style="margin:0;color:#41564a;font-size:15px;line-height:1.65">${escapeTextBlock(item.body)}</p>
            ${appointmentDetails(appointment)}
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 18px"><tr><td style="border-radius:8px;background:#007a4b">
              <a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:13px 20px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800">Open FacultyConnect →</a>
            </td></tr></table>
            <p style="margin:0;padding:16px 18px;border-radius:10px;background:#f7faf8;color:#607168;font-size:12px;line-height:1.55">For your privacy, open the secure portal to review or manage the full request. Do not send passwords or confidential student information by email.</p>
          </td></tr>
          <tr><td style="padding:18px 28px 26px;color:#718078;font-size:11px;line-height:1.5">
            This automated message was sent by CLSU FacultyConnect. Please do not reply to this notification.<br>
            MISO · Faculty consultation pilot
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return respond({ error: "Method not allowed" }, 405);

  const expected = Deno.env.get("EMAIL_CRON_SECRET");
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const portalUrl = Deno.env.get("PORTAL_URL") || "https://www.clsufacultyconnect.com";
  const from = Deno.env.get("EMAIL_FROM") || "CLSU FacultyConnect <notifications@clsufacultyconnect.com>";
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    return respond({ error: "Required server configuration is missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: remindersQueued, error: reminderError } = await supabase.rpc(
    "queue_due_appointment_reminders",
  );
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_email_notifications",
    { batch_size: 25 },
  );
  if (claimError) return respond({ error: claimError.message }, 500);
  if (!claimed?.length) {
    return respond({
      processed: 0,
      sent: 0,
      failed: 0,
      remindersQueued: remindersQueued ?? 0,
      reminderError: reminderError?.message ?? null,
    });
  }

  const typedClaimed = claimed as NotificationItem[];
  const recipientIds = [...new Set(typedClaimed.map((item) => item.recipient_id))];
  const appointmentIds = [
    ...new Set(typedClaimed.map((item) => item.appointment_id).filter((id): id is string => Boolean(id))),
  ];
  const [{ data: profiles, error: profileError }, { data: appointments, error: appointmentError }] = await Promise.all([
    supabase.from("profiles").select("id,email,full_name").in("id", recipientIds),
    appointmentIds.length
      ? supabase
        .from("appointments")
        .select("id,topic,status,availability:availability_id(starts_at,ends_at,location,consultation_mode)")
        .in("id", appointmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profileError || appointmentError) {
    const fetchError = profileError ?? appointmentError;
    await supabase
      .from("email_notifications")
      .update({
        status: "queued",
        processing_started_at: null,
        scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString(),
        last_error: fetchError?.message ?? "Unable to load notification details",
      })
      .in("id", typedClaimed.map((item) => item.id));
    return respond({ error: fetchError?.message }, 500);
  }

  const recipientById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const appointmentById = new Map(
    ((appointments || []) as AppointmentSummary[]).map((appointment) => [appointment.id, appointment]),
  );

  let sent = 0;
  let failed = 0;
  for (const item of typedClaimed) {
    const profile = recipientById.get(item.recipient_id);
    const appointment = item.appointment_id
      ? appointmentById.get(item.appointment_id)
      : undefined;
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
          html: emailTemplate({
            profileName: profile.full_name,
            item,
            appointment,
            portalUrl,
          }),
        }),
      });
      if (!response.ok) throw new Error(`Resend ${response.status}: ${await response.text()}`);
      const { error: updateError } = await supabase
        .from("email_notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          processing_started_at: null,
          last_error: null,
        })
        .eq("id", item.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (cause) {
      const terminal = item.attempts >= 4;
      const retryAt = new Date(Date.now() + 5 * 60_000 * 2 ** Math.max(0, item.attempts - 1));
      await supabase
        .from("email_notifications")
        .update({
          status: terminal ? "failed" : "queued",
          processing_started_at: null,
          scheduled_for: retryAt.toISOString(),
          last_error: String(cause).slice(0, 1000),
        })
        .eq("id", item.id);
      failed += 1;
    }
  }

  return respond({
    processed: typedClaimed.length,
    sent,
    failed,
    remindersQueued: remindersQueued ?? 0,
    reminderError: reminderError?.message ?? null,
  });
});
