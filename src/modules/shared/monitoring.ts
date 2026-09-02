import { recordClientError, type ClientErrorEvent } from "../../backend";

const recentEvents = new Map<string, number>();
const DEDUPE_WINDOW_MS = 30_000;

/**
 * Sends privacy-filtered client telemetry to the RLS-protected operations log.
 * Duplicate browser errors are coalesced so an outage cannot create a second
 * outage by filling the telemetry table.
 */
export async function captureClientError(
  userId: string | null | undefined,
  eventType: ClientErrorEvent["event_type"],
  cause: unknown,
) {
  const message = cause instanceof Error ? cause.message : String(cause || "Unknown client error");
  const key = `${eventType}:${message.slice(0, 240)}`;
  const now = Date.now();
  const previous = recentEvents.get(key);
  if (previous && now - previous < DEDUPE_WINDOW_MS) return;
  recentEvents.set(key, now);
  for (const [eventKey, timestamp] of recentEvents) {
    if (now - timestamp > DEDUPE_WINDOW_MS) recentEvents.delete(eventKey);
  }
  console.error(JSON.stringify({
    level: "error",
    message,
    event_type: eventType,
    route: typeof window === "undefined" ? "unknown" : window.location.pathname,
    release: String(import.meta.env.VITE_RELEASE || "unknown"),
  }));
  if (!userId) return;
  try {
    await recordClientError(userId, eventType, message);
  } catch {
    // Telemetry must never interrupt the user workflow or create an error loop.
  }
}
