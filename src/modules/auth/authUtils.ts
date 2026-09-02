export const STUDENT_EMAIL_DOMAINS = ["gmail.com", "clsu2.edu.ph"] as const;

export const studentPasswordRules = [
  { id: "length", label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { id: "uppercase", label: "One uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { id: "lowercase", label: "One lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { id: "number", label: "One number", test: (value: string) => /\d/.test(value) },
  { id: "symbol", label: "One symbol (for example: ! @ # $ %)", test: (value: string) => /[^A-Za-z0-9\s]/.test(value) },
] as const;

export function studentPasswordIsValid(value: string) {
  return studentPasswordRules.every((rule) => rule.test(value));
}

export function isAllowedStudentEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@").at(-1);
  return STUDENT_EMAIL_DOMAINS.some((allowed) => domain === allowed);
}

export type AuthAction = "login" | "signup" | "reset";

export function friendlyAuthError(message: string, action: AuthAction) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "The email address or password is incorrect. Check your details and try again.";
  if (normalized.includes("email not confirmed")) return "Confirm your email address using the link we sent before signing in.";
  if (normalized.includes("already registered") || normalized.includes("already been registered") || normalized.includes("user already exists")) return "We couldn't create this account. Review the information, or use sign in or password recovery if you may already be registered.";
  if (normalized.includes("rate limit")) return "Too many attempts were made. Wait a few minutes, then try again.";
  if (normalized.includes("invalid email")) return "Enter a valid email address.";
  if (action === "signup" && (normalized.includes("database error") || normalized.includes("student registration requires") || normalized.includes("saving new user"))) return "We couldn't create this account. Use a Gmail or CLSU student email address and confirm that the student number is not already registered.";
  if (action === "reset") return "We couldn't send the reset link right now. Check the email address and try again shortly.";
  return action === "signup" ? "We couldn't create the account right now. Review the information and try again." : "We couldn't sign you in right now. Please try again.";
}
