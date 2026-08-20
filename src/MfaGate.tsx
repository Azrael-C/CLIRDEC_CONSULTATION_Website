import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { ThemeToggle } from "./theme";

type GateState = "checking" | "enroll" | "verify" | "ready" | "error";

export function PrivilegedMfaGate({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  const [state, setState] = useState<GateState>("checking");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function inspect() {
      const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] =
        await Promise.all([
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
          supabase.auth.mfa.listFactors(),
        ]);
      if (!active) return;
      if (assuranceError || factorsError) {
        setMessage(assuranceError?.message || factorsError?.message || "MFA status could not be checked.");
        setState("error");
        return;
      }
      if (assurance.currentLevel === "aal2") {
        setState("ready");
        return;
      }
      const verified = factors?.totp?.find((factor) => factor.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setState("verify");
        return;
      }
      // An interrupted first-time enrollment cannot be resumed because the QR
      // secret is intentionally not persisted. Remove stale unverified factors
      // before creating a fresh QR code for this authenticated session.
      for (const factor of factors?.totp || []) {
        if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "CLSU FacultyConnect",
      });
      if (!active) return;
      if (error || !data) {
        setMessage(error?.message || "MFA enrollment could not be started.");
        setState("error");
        return;
      }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setState("enroll");
    }
    void inspect();
    return () => {
      active = false;
    };
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessage("Enter the current six-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }
    await supabase.auth.refreshSession();
    setState("ready");
    setBusy(false);
  }

  if (state === "ready") return <>{children}</>;

  return (
    <main className="mfa-gate" id="main-content">
      <div className="public-theme-control"><ThemeToggle /></div>
      <section className="mfa-card" aria-labelledby="mfa-title">
        <p className="eyebrow">PRIVILEGED ACCOUNT SECURITY</p>
        <h1 id="mfa-title">Two-step verification required</h1>
        <p>
          Faculty and administrator accounts must confirm a time-based code before
          schedules, student requests, or administrative records can be accessed.
        </p>
        {state === "checking" && <div className="empty-card">Checking account security…</div>}
        {state === "enroll" && (
          <div className="mfa-enrollment">
            <img src={qrCode} alt="Authenticator enrollment QR code" />
            <div>
              <h2>Connect an authenticator app</h2>
              <ol>
                <li>Open Google Authenticator, Microsoft Authenticator, or another TOTP app.</li>
                <li>Scan this QR code.</li>
                <li>Enter the six-digit code below.</li>
              </ol>
              <details>
                <summary>Cannot scan the code?</summary>
                <code>{secret}</code>
              </details>
            </div>
          </div>
        )}
        {(state === "enroll" || state === "verify") && (
          <form className="mfa-form" onSubmit={verify}>
            <label htmlFor="mfa-code">Six-digit verification code</label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              required
            />
            <button className="primary" disabled={busy}>
              {busy ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
        )}
        {message && <p className="form-notice error" role="alert">{message}</p>}
        <button type="button" className="outline" onClick={onSignOut}>Sign out</button>
      </section>
    </main>
  );
}
