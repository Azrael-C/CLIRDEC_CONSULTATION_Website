import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1.69.0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const acceptedEvents = new Set([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
]);

type ResendEvent = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    to?: string[];
    subject?: string;
    bounce?: unknown;
    failed?: unknown;
  };
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Required server configuration is missing" }, 500);
  }

  const webhookId = request.headers.get("svix-id");
  const webhookTimestamp = request.headers.get("svix-timestamp");
  const webhookSignature = request.headers.get("svix-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return json({ error: "Webhook signature headers are missing" }, 400);
  }

  let event: ResendEvent;
  const rawBody = await request.text();
  try {
    event = new Webhook(webhookSecret).verify(rawBody, {
      "svix-id": webhookId,
      "svix-timestamp": webhookTimestamp,
      "svix-signature": webhookSignature,
    }) as ResendEvent;
  } catch {
    return json({ error: "Invalid webhook signature" }, 400);
  }
  if (!acceptedEvents.has(event.type)) return json({ ignored: true });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: eventError } = await supabase.from("email_delivery_events").insert({
    webhook_id: webhookId,
    provider_email_id: event.data.email_id,
    event_type: event.type,
    event_created_at: event.created_at,
    recipient_addresses: event.data.to || [],
    subject: event.data.subject || null,
    details: event.data.bounce || event.data.failed || {},
  });
  if (eventError?.code === "23505") return json({ duplicate: true });
  if (eventError) return json({ error: eventError.message }, 500);

  // Webhook delivery order is not guaranteed. Update the summary only when
  // this event is newer than the last provider status already recorded.
  const { error: updateError } = await supabase
    .from("email_notifications")
    .update({ provider_status: event.type, provider_status_at: event.created_at })
    .eq("provider_email_id", event.data.email_id)
    .or(`provider_status_at.is.null,provider_status_at.lt.${event.created_at}`);
  if (updateError) return json({ error: updateError.message }, 500);
  return json({ received: true });
});
