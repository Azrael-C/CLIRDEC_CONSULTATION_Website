import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  updateRetentionPolicy,
  type AdminPortal,
  type RetentionPolicy,
} from "./backend";

type ServiceProbe = {
  loading: boolean;
  healthy: boolean;
  approvedEntries: number | null;
  source: string;
};

async function fetchServiceStatus(): Promise<ServiceProbe> {
  try {
    const [health, knowledge] = await Promise.all([
      fetch("/api/health", { cache: "no-store" }),
      fetch("/api/knowledge-status", { cache: "no-store" }),
    ]);
    const knowledgeBody = knowledge.ok ? await knowledge.json() : null;
    return {
      loading: false,
      healthy: health.ok && knowledge.ok,
      approvedEntries: typeof knowledgeBody?.approved_entries === "number" ? knowledgeBody.approved_entries : null,
      source: String(knowledgeBody?.source || (knowledge.ok ? "Knowledge status available" : "Knowledge status unavailable")),
    };
  } catch {
    return { loading: false, healthy: false, approvedEntries: null, source: "Chatbot service unavailable" };
  }
}

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
  const [serviceProbe, setServiceProbe] = useState<ServiceProbe>({
    loading: true,
    healthy: false,
    approvedEntries: null,
    source: "Checking service",
  });
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  useEffect(() => {
    let active = true;
    void fetchServiceStatus().then((result) => {
      if (!active) return;
      setServiceProbe(result);
      setLastChecked(new Date());
    });
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
  const operationalIssues = [
    ...(!serviceProbe.loading && !serviceProbe.healthy ? [{
      key: "chatbot",
      title: "Chatbot service cannot be reached",
      detail: "Students may not receive answers until the chatbot deployment or environment configuration is restored.",
      href: "#service-details",
      action: "View service details",
    }] : []),
    ...(overdue.length ? [{
      key: "overdue-email",
      title: `${overdue.length} ${overdue.length === 1 ? "email is" : "emails are"} more than 10 minutes overdue`,
      detail: "Appointment confirmations or reminders may reach users late.",
      href: "#email-health",
      action: "Review email queue",
    }] : []),
    ...(failed.length || deliveryProblems.length ? [{
      key: "delivery",
      title: `${failed.length + deliveryProblems.length} email delivery ${failed.length + deliveryProblems.length === 1 ? "problem needs" : "problems need"} review`,
      detail: "Check the failure reason before retrying or contacting the recipient.",
      href: "#provider-events",
      action: "Inspect delivery events",
    }] : []),
    ...(errors24h.length ? [{
      key: "client-error",
      title: `${errors24h.length} application ${errors24h.length === 1 ? "error was" : "errors were"} recorded today`,
      detail: "Review the affected page and release before the next pilot session.",
      href: "#application-errors",
      action: "Inspect app errors",
    }] : []),
  ];

  async function refreshStatus() {
    setRefreshing(true);
    try {
      const [result] = await Promise.all([fetchServiceStatus(), onRefresh()]);
      setServiceProbe(result);
      setLastChecked(new Date());
      onMessage("Operations data and service status were refreshed.");
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "Operations status could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

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
          <h1>Operations and system health</h1>
          <p>See what is working, what needs attention, and the records required for a safe pilot.</p>
        </div>
      </section>
      <section className={`operations-overview ${serviceState === "Healthy" ? "healthy" : serviceProbe.loading ? "checking" : "attention"}`}>
        <div className="operations-overview-copy">
          <span className="operations-state"><i aria-hidden="true" />{serviceState}</span>
          <h2>{serviceState === "Healthy" ? "Core services are ready" : serviceProbe.loading ? "Checking the live services" : "Some items need administrator attention"}</h2>
          <p>{serviceState === "Healthy"
            ? "The chatbot, email queue, and monitored application activity have no current warning signs."
            : serviceProbe.loading
              ? "This normally takes only a few seconds. The page remains usable while checks finish."
              : `${operationalIssues.length} ${operationalIssues.length === 1 ? "issue has" : "issues have"} been prioritized below with a recommended next action.`}</p>
          <small>{lastChecked ? `Last checked ${lastChecked.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting for first check"}</small>
        </div>
        <button type="button" className="outline operations-refresh" onClick={() => void refreshStatus()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </section>

      <div className="operations-summary-grid" aria-label="System health summary">
        <article>
          <span>Chatbot service</span>
          <b className={serviceProbe.healthy ? "healthy-text" : "attention-text"}>{serviceProbe.loading ? "Checking" : serviceProbe.healthy ? "Online" : "Unavailable"}</b>
          <small>{serviceProbe.approvedEntries ?? "—"} approved answers available</small>
        </article>
        <article className={overdue.length ? "attention" : ""}>
          <span>Email queue</span><b>{overdue.length}</b><small>more than 10 minutes overdue</small>
        </article>
        <article className={failed.length + deliveryProblems.length ? "attention" : ""}>
          <span>Delivery problems</span><b>{failed.length + deliveryProblems.length}</b><small>failed, bounced, delayed, or complained</small>
        </article>
        <article className={errors24h.length ? "attention" : ""}>
          <span>Application errors</span><b>{errors24h.length}</b><small>recorded in the last 24 hours</small>
        </article>
      </div>

      <section className="work-card operations-priority-card" aria-labelledby="operations-priority-title">
        <div className="card-title">
          <div><span className="section-kicker">NEXT ACTIONS</span><h2 id="operations-priority-title">What needs attention</h2></div>
          <span>{operationalIssues.length ? `${operationalIssues.length} open` : "All clear"}</span>
        </div>
        {operationalIssues.length ? (
          <div className="operations-issue-list">
            {operationalIssues.map((issue, index) => (
              <article key={issue.key}>
                <i aria-hidden="true">{index + 1}</i>
                <div><b>{issue.title}</b><p>{issue.detail}</p></div>
                <a href={issue.href}>{issue.action}<span aria-hidden="true">→</span></a>
              </article>
            ))}
          </div>
        ) : (
          <div className="operations-all-clear">
            <i aria-hidden="true">✓</i>
            <div><b>No immediate action is required</b><span>Continue routine monitoring and run the full lifecycle test before each pilot release.</span></div>
          </div>
        )}
      </section>

      <section className="operations-section-heading">
        <div><span className="section-kicker">SERVICE DETAILS</span><h2>Delivery and application diagnostics</h2></div>
        <p>Open a panel only when you need the underlying evidence.</p>
      </section>
      <div className="operations-details-grid">
        <details id="email-health" className="work-card operations-detail" open={Boolean(overdue.length || failed.length)}>
          <summary><span><b>Email queue</b><small>Messages waiting or unable to send</small></span><em>{overdue.length + failed.length}</em></summary>
          <div className="operations-list">
            {[...overdue, ...failed].slice(0, 12).map((item) => (
              <article key={item.id}>
                <span className={`status ${item.status}`}>{item.status}</span>
                <div><b>{item.subject}</b><small>{item.event_type.replace(/_/g, " ")} · {new Date(item.scheduled_for).toLocaleString()}</small><p>{item.last_error || "Awaiting the delivery worker."}</p></div>
              </article>
            ))}
            {!overdue.length && !failed.length && <div className="empty-card">No queued or failed email requires attention.</div>}
          </div>
        </details>
        <details id="provider-events" className="work-card operations-detail" open={Boolean(deliveryProblems.length)}>
          <summary><span><b>Email provider events</b><small>Delivery, bounce, complaint, and delay evidence</small></span><em>{data.deliveryEvents.length}</em></summary>
          <div className="operations-list">
            {data.deliveryEvents.slice(0, 12).map((item) => (
              <article key={item.webhook_id}>
                <span className={`status ${item.event_type.includes("delivered") ? "sent" : item.event_type.includes("failed") || item.event_type.includes("bounced") ? "failed" : "processing"}`}>{item.event_type.replace("email.", "")}</span>
                <div><b>{item.subject || "Transactional email"}</b><small>{item.recipient_addresses.join(", ") || "Recipient withheld"}</small><p>{new Date(item.event_created_at).toLocaleString()}</p></div>
              </article>
            ))}
            {!data.deliveryEvents.length && <div className="empty-card">No provider webhook evidence has been received yet.</div>}
          </div>
        </details>
        <details id="application-errors" className="work-card operations-detail" open={Boolean(errors24h.length)}>
          <summary><span><b>Application errors</b><small>Privacy-filtered errors reported by signed-in browsers</small></span><em>{errors24h.length}</em></summary>
          <div className="operations-list">
            {data.clientErrors.slice(0, 20).map((item) => (
              <article key={item.id}>
                <span className="status failed">{item.event_type.replace(/_/g, " ")}</span>
                <div><b>{item.route}</b><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString()} · release {item.release || "unknown"}</small></div>
              </article>
            ))}
            {!data.clientErrors.length && <div className="empty-card">No authenticated application errors have been recorded.</div>}
          </div>
        </details>
        <details id="service-details" className="work-card operations-detail">
          <summary><span><b>Chatbot knowledge service</b><small>Live API and approved-answer source</small></span><em className={serviceProbe.healthy ? "healthy" : "attention"}>{serviceProbe.loading ? "…" : serviceProbe.healthy ? "Online" : "Check"}</em></summary>
          <div className="operations-service-copy">
            <dl>
              <div><dt>API status</dt><dd>{serviceProbe.loading ? "Checking" : serviceProbe.healthy ? "Available" : "Unavailable"}</dd></div>
              <div><dt>Approved answers</dt><dd>{serviceProbe.approvedEntries ?? "Not reported"}</dd></div>
              <div><dt>Knowledge source</dt><dd>{serviceProbe.source}</dd></div>
            </dl>
            <p>If this service is unavailable, check the production chatbot deployment and its server-side Supabase environment variables.</p>
          </div>
        </details>
      </div>

      <section className="operations-section-heading">
        <div><span className="section-kicker">ACCOUNTABILITY</span><h2>Administrative records</h2></div>
        <p>Use these records for investigation, privacy review, and release evidence.</p>
      </section>
      <div className="operations-details-grid">
        <details className="work-card operations-detail">
          <summary><span><b>Admin activity log</b><small>Role, content, and configuration changes</small></span><em>{audit24h.length} today</em></summary>
          <div className="audit-timeline">
            {data.auditLogs.slice(0, 30).map((item) => (
              <article key={item.id}>
                <i />
                <div><b>{friendlyAction(item.action)}</b><span>{item.resource_type} · {item.resource_id.slice(0, 18)}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>
              </article>
            ))}
            {!data.auditLogs.length && <div className="empty-card">No administrative changes are recorded.</div>}
          </div>
        </details>
        <details className="work-card operations-detail operations-retention-detail">
          <summary><span><b>Retention and restore readiness</b><small>Policy settings and backup drill checklist</small></span><em>{data.retentionPolicies.length} policies</em></summary>
          <div className="scope-note"><b>Preview only</b><span>This page reports eligible records and saves approved policy settings. It never deletes records automatically.</span></div>
          <div className="retention-grid">
            {data.retentionPolicies.map((policy) => (
              <RetentionEditor key={policy.record_type} policy={policy} onRefresh={onRefresh} onMessage={onMessage} />
            ))}
          </div>
          <div className="restore-checklist">
            <h3>Restore drill checklist</h3>
            <ol><li>Export a schema-only and data backup with the Supabase CLI.</li><li>Restore into an isolated non-production project.</li><li>Run the lifecycle test against the restored project.</li><li>Record the date, operator, duration, and result in the release evidence.</li></ol>
          </div>
        </details>
      </div>
      <section className="work-card export-center">
        <div className="card-title"><div><span className="section-kicker">REPORTS</span><h2>Export release evidence</h2></div><span>CSV or print-ready PDF</span></div>
        <p className="export-description">Exports contain operational records and may include personal data. Store them only in an approved CLSU location.</p>
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
