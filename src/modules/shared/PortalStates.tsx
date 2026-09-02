import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function PortalLoader({
  label,
  detail = "Please keep this page open while we prepare your workspace.",
  compact = false,
}: {
  label: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "portal-loader compact" : "portal-loader"}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="portal-loader-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="portal-loader-copy">
        <b>{label}</b>
        <small>{detail}</small>
      </span>
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="portal-state empty-state" role="status">
      <span className="portal-state-icon" aria-hidden="true">∅</span>
      <b>{title}</b>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "We couldn't load this workspace",
  detail = "Your information was not changed. Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="portal-state error-state" role="alert">
      <span className="portal-state-icon" aria-hidden="true">!</span>
      <b>{title}</b>
      <p>{detail}</p>
      {onRetry && <button type="button" className="outline" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-banner" role="status" aria-live="assertive">
      <span aria-hidden="true">⌁</span>
      <div><b>You’re offline</b><small>Changes are paused until your connection returns.</small></div>
    </div>
  );
}
