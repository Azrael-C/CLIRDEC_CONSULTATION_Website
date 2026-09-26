import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(repoRoot, "supabase", "config.toml");
const config = readFileSync(configPath, "utf8");

const expectedTemplates = [
  {
    section: "[auth.email.template.recovery]",
    path: "./supabase/templates/recovery.html",
    file: resolve(repoRoot, "supabase", "templates", "recovery.html"),
  },
  {
    section: "[auth.email.notification.password_changed]",
    path: "./templates/password-changed.html",
    file: resolve(repoRoot, "supabase", "templates", "password-changed.html"),
  },
];

for (const template of expectedTemplates) {
  if (!config.includes(template.section)) {
    throw new Error(`Supabase template section is missing: ${template.section}`);
  }
  if (!config.includes(`content_path = "${template.path}"`)) {
    throw new Error(`Unexpected content_path for ${template.section}: ${template.path}`);
  }
  if (!existsSync(template.file)) {
    throw new Error(`Configured Supabase template file is missing: ${template.file}`);
  }
}

if (config.includes("./supabase/templates/password-changed.html")) {
  throw new Error("Password-change notification must not resolve to supabase/supabase/templates.");
}

console.log("Supabase email template paths passed.");
