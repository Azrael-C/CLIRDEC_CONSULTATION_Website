import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  updateRetentionPolicy,
  type AdminPortal,
  type RetentionPolicy,
} from "./backend";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, headings: string[], rows: unknown[][]) {
  const body = [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function friendlyAction(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function AdminOperations({
  data,
  onRefresh,
  onMessage,
}: {
  data: AdminPortal;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [serviceProbe, setServiceProbe] = useState<{
    loading: boolean;
    healthy: boolean;
    approvedEntries: number | null;
    source: string;
  }>({ loading: true, healthy: false, approvedEntries: null, source: "Checking service" });
  useEffect(() => {
    let active = true;
    async function probe() {
      try {
        const [health, knowledge] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }),
          fetch("/api/knowledge-status", { cache: "no-store" }),
        ]);
        const knowledgeBody = knowledge.ok ? await knowledge.json() : null;
        if (active) setServiceProbe({
          loading: false,
          healthy: health.ok && knowledge.ok,
          approvedEntries: typeof knowledgeBody?.approved_entries === "number" ? knowledgeBody.approved_entries : null,
          source: String(knowledgeBody?.source || (knowledge.ok ? "Knowledge status available" : "Knowledge status unavailable")),
        });
      } catch {
        if (active) setServiceProbe({ loading: false, healthy: false, approvedEntries: null, source: "Chatbot service unavailable" });
      }
    }
    void probe();
    return () => { active = false; };
  }, []);
  const now = Date.now();
  const overdue = data.emailNotifications.filter(
    (item) =>
      (item.status === "queued" || item.status === "processing") &&
      new Date(item.scheduled_for).getTime() < now - 10 * 60_000,
  );
  const failed = data.emailNotifications.filter((item) => item.status === "failed");
  const deliveryProblems = data.deliveryEvents.filter((item) =>
    ["email.bounced", "email.complained", "email.failed", "email.delivery_delayed"].includes(item.event_type),
  );
  const errors24h = data.clientErrors.filter(
    (event) => new Date(event.created_at).getTime() > now - 24 * 60 * 60_000,
  );
  const audit24h = data.auditLogs.filter(
    (event) => new Date(event.created_at).getTime() > now - 24 * 60 * 60_000,
  );
  const serviceState = serviceProbe.loading
    ? "Checking"
    : overdue.length || failed.length || deliveryProblems.length || errors24h.length || !serviceProbe.healthy
      ? "Action required"
      : "Healthy";

  function exportAppointments() {
    downloadCsv(
      `facultyconnect-consultations-${new Date().toISOString().slice(0, 10)}.csv`,
      ["ID", "Topic", "Student", "Faculty", "Start", "End", "Mode", "Location", "Status"],
      data.appointments.map((item) => [
        item.id, item.topic, item.student_name, item.faculty_name, item.starts_at,
        item.ends_at, item.consultation_mode, item.location, item.status,
      ]),
    );
  }

  function exportReviews() {
    downloadCsv(
      `facultyconnect-reviews-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Appointment", "Rating", "Comment", "Year level", "College", "Program", "Submitted"],
      data.reviews.map((item) => [
        item.appointment_id, item.rating, item.comment, item.year_level,
        item.college, item.program, item.created_at,
      ]),
    );
  }

  function exportAudit() {
    downloadCsv(
      `facultyconnect-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      ["ID", "Time", "Actor", "Action", "Resource", "Resource ID", "Previous", "New"],
      data.auditLogs.map((item) => [
        item.id, item.created_at, item.actor_id, item.action, item.resource_type,
        item.resource_id, JSON.stringify(item.old_data), JSON.stringify(item.new_data),
      ]),
    );
  }

  return (
    <>
      <section className="page-head portal-head">
        <div>
          <p className="eyebrow">OPERATIONS AND ACCOUNTABILITY</p>
          <h1>System health and records</h1>
          <p>Monitor delivery, application errors, privileged changes, retention readiness, and release evidence.</p>
        </div>
      </section>
      <div className="metrics">
        <article><b className={serviceState === "Healthy" ? "healthy-text" : "attention-text"}>{serviceState}</b><span>Overall status</span></article>
        <article><b className={serviceProbe.healthy ? "healthy-text" : "attention-text"}>{serviceProbe.loading ? "Checking" : serviceProbe.healthy ? "Online" : "Unavailable"}</b><span>Chatbot API</span></article>
        <article><b>{serviceProbe.approvedEntries ?? "â€”"}</b><span>Approved live answers</span></article>
        <article><b>{overdue.length}</b><span>Emails overdue 10+ min</span></article>
        <article><b>{deliveryProblems.length + failed.length}</b><span>Delivery problems</span></article>
        <article><b>{errors24h.length}</b><span>Client errors in 24 hours</span></article>
      </div>
      <div className="operations-alerts" aria-label="Operational alerts">
        {!overdue.length && !failed.length && !deliveryProblems.length && !errors24h.length && serviceProbe.healthy ? (
          <div className="scope-note success"><b>All monitored checks are clear</b><span>No overdue mail, delivery failure, complaint, bounce, or client error currently needs administrator attention.</span></div>
        ) : (
          <div className="scope-note warning"><b>Administrator review required</b><span>{overdue.length} overdue, {failed.length} failed, {deliveryProblems.length} provider delivery events, {errors24h.length} recent application errors, and chatbot API status {serviceProbe.loading ? "is still being checked" : serviceProbe.healthy ? "is healthy" : "requires attention"}.</span></div>
        )}
      </div>
      <div className="scope-note">
        <b>Knowledge source</b>
        <span>{serviceProbe.source}</span>
      </div>
      <div className="operations-grid">
        <section className="work-card">
          <div className="card-title"><h2>Email delivery health</h2><span>{data.emailNotifications.length} recent messages</span></div>
          <div className="operations-list">
            {[...overdue, ...failed].slice(0, 12).map((item) => (
              <article key={item.id}>
                <span className={`status ${item.status}`}>{item.status}</span>
                <div><b>{item.subject}</b><small>{item.event_type.replace(/_/g, " ")} · {new Date(item.scheduled_for).toLocaleString()}</small><p>{item.last_error || "Awaiting the delivery worker."}</p></div>
              </article>
            ))}
            {!overdue.length && !failed.length && <div className="empty-card">No queued or failed email requires attention.</div>}
          </div>
        </section>
        <section className="work-card">
          <div className="card-title"><h2>Provider delivery events</h2><span>Resend webhook evidence</span></div>
          <div className="operations-list">
            {data.deliveryEvents.slice(0, 12).map((item) => (
              <article key={item.webhook_id}>
                <span className={`status ${item.event_type.includes("delivered") ? "sent" : item.event_type.includes("failed") || item.event_type.includes("bounced") ? "failed" : "processing"}`}>{item.event_type.replace("email.", "")}</span>
                <div><b>{item.subject || "Transactional email"}</b><small>{item.recipient_addresses.join(", ") || "Recipient withheld"}</small><p>{new Date(item.event_created_at).toLocaleString()}</p></div>
              </article>
            ))}
            {!data.deliveryEvents.length && <div className="empty-card">No provider webhook evidence has been received yet.</div>}
          </div>
        </section>
      </div>
      <div className="operations-grid">
        <section className="work-card">
          <div className="card-title"><h2>Privileged audit trail</h2><span>{audit24h.length} changes in 24 hours</span></div>
          <div className="audit-timeline">
            {data.auditLogs.slice(0, 30).map((item) => (
              <article key={item.id}>
                <i />
                <div><b>{friendlyAction(item.action)}</b><span>{item.resource_type} · {item.resource_id.slice(0, 18)}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>
              </article>
            ))}
            {!data.auditLogs.length && <div className="empty-card">No administrative changes are recorded.</div>}
          </div>
        </section>
        <section className="work-card">
          <div className="card-title"><h2>Application monitoring</h2><span>Privacy-filtered errors</span></div>
          <div className="operations-list">
            {data.clientErrors.slice(0, 20).map((item) => (
              <article key={item.id}>
                <span className="status failed">{item.event_type.replace(/_/g, " ")}</span>
                <div><b>{item.route}</b><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()} · release {item.release || "unknown"}</small></div>
              </article>
            ))}
            {!data.clientErrors.length && <div className="empty-card">No authenticated client errors have been recorded.</div>}
          </div>
        </section>
      </div>
      <section className="work-card retention-workspace">
        <div className="card-title"><h2>Retention and restore readiness</h2><span>Preview only · no automatic deletion</span></div>
        <div className="scope-note"><b>Safe retention workflow</b><span>Approve a policy only after the Product Owner and CLSU privacy authority confirm it. Eligible counts are informational; this page never deletes records.</span></div>
        <div className="retention-grid">
          {data.retentionPolicies.map((policy) => (
            <RetentionEditor key={policy.record_type} policy={policy} onRefresh={onRefresh} onMessage={onMessage} />
          ))}
        </div>
        <div className="restore-checklist">
          <h3>Required restore drill evidence</h3>
          <ol><li>Export a schema-only and data backup with the Supabase CLI.</li><li>Restore into an isolated non-production project.</li><li>Run the lifecycle test against the restored project.</li><li>Record the date, operator, duration, and result in the release evidence.</li></ol>
        </div>
      </section>
      <section className="work-card export-center">
        <div className="card-title"><h2>Reports and release evidence</h2><span>Privacy-conscious exports</span></div>
        <div className="export-actions">
          <button className="outline" onClick={exportAppointments}>Export consultations CSV</button>
          <button className="outline" onClick={exportReviews}>Export reviews CSV</button>
          <button className="outline" onClick={exportAudit}>Export audit CSV</button>
          <button className="primary" onClick={() => window.print()}>Print or save PDF report</button>
        </div>
      </section>
    </>
  );
}

function RetentionEditor({
  policy,
  onRefresh,
  onMessage,
}: {
  policy: RetentionPolicy;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const initial = useMemo(() => ({ days: policy.retention_days, rationale: policy.rationale, approved: policy.approved }), [policy]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await updateRetentionPolicy({
        recordType: policy.record_type,
        retentionDays: Number(form.get("days")),
        rationale: String(form.get("rationale") || ""),
        approved: form.get("approved") === "on",
      });
      onMessage(`Retention policy for ${policy.record_type.replace(/_/g, " ")} was updated and audited.`);
      await onRefresh();
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "The retention policy could not be updated.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <header><b>{policy.record_type.replace(/_/g, " ")}</b><span>{policy.eligible_records} eligible now</span></header>
      <label>Retention days<input name="days" type="number" min={30} max={3650} defaultValue={initial.days} /></label>
      <label>Rationale<textarea name="rationale" maxLength={500} defaultValue={initial.rationale} /></label>
      <label className="check-line"><input name="approved" type="checkbox" defaultChecked={initial.approved} /> CLSU-approved period</label>
      <button className="outline" disabled={busy}>{busy ? "Saving…" : "Save audited policy"}</button>
    </form>
  );
}
