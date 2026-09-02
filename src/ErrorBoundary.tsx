import { Component, type ErrorInfo, type ReactNode } from "react";
import { supabase } from "./supabase";
import { captureClientError } from "./modules/shared";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, information: ErrorInfo) {
    console.error("[facultyconnect:ui] render failed", {
      message: error.message,
      componentStack: information.componentStack,
    });
    void supabase.auth.getUser().then(({ data }) => {
      void captureClientError(data.user?.id, "render_error", error);
    }).catch(() => undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" id="main-content">
        <section>
          <p className="eyebrow">PORTAL RECOVERY</p>
          <h1>FacultyConnect could not display this page.</h1>
          <p>
            Your information was not changed. Reload the secure portal and try
            the action again.
          </p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reload FacultyConnect
          </button>
        </section>
      </main>
    );
  }
}
