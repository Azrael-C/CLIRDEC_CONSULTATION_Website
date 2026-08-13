const baseUrl = (process.env.PRODUCTION_URL || "https://www.clsufacultyconnect.com").replace(/\/$/, "");

const request = async (path, options) => {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response;
};

const root = await request("/");
const html = await root.text();
if (!html.includes("CLSU FacultyConnect")) throw new Error("Production shell is not FacultyConnect.");
if (!root.headers.get("content-security-policy")) throw new Error("Production CSP header is missing.");

const robots = await request("/robots.txt");
const robotsBody = await robots.text();
if (!robotsBody.includes("Sitemap: https://www.clsufacultyconnect.com/sitemap.xml")) {
  throw new Error("Production robots.txt does not reference the sitemap.");
}
if (!robotsBody.includes("Disallow: /api/") || /User-agent:\s*(Googlebot|Bingbot)/i.test(robotsBody)) {
  throw new Error("Production robots.txt must apply the API exclusion to every crawler.");
}
const sitemap = await request("/sitemap.xml");
const sitemapBody = await sitemap.text();
if (!sitemapBody.includes("/privacy-policy")) {
  throw new Error("Production sitemap does not include the privacy policy.");
}

const privacy = await request("/privacy-policy");
const privacyBody = await privacy.text();
if (!privacyBody.includes("Privacy Policy | CLSU FacultyConnect")) {
  throw new Error("Production privacy policy entry point is missing or incorrectly titled.");
}

const missing = await fetch(`${baseUrl}/production-smoke-missing-page`, {
  redirect: "follow",
  signal: AbortSignal.timeout(20_000),
});
const missingBody = await missing.text();
if (missing.status !== 404 || !missingBody.includes("This page is not available.")) {
  throw new Error(`Custom 404 failed with status ${missing.status}.`);
}

const health = await request("/api/health");
if (health.headers.get("cache-control") !== "no-store") {
  throw new Error("Dynamic API responses must not be cached.");
}
const healthBody = await health.json();
if (healthBody.status !== "ok" || healthBody.nlp !== "spaCy") {
  throw new Error(`Unexpected chatbot health payload: ${JSON.stringify(healthBody)}`);
}

const knowledgeStatus = await request("/api/knowledge-status");
const knowledgeBody = await knowledgeStatus.json();
if (
  knowledgeBody.source !== "Supabase approved FAQ entries" ||
  !Number.isInteger(knowledgeBody.approved_entries) ||
  knowledgeBody.approved_entries < 1
) {
  throw new Error(
    `Production chatbot has no approved database knowledge: ${JSON.stringify(knowledgeBody)}`,
  );
}

const preflight = await request("/api/chat", {
  method: "OPTIONS",
  headers: {
    Origin: "https://www.clsufacultyconnect.com",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type",
  },
});
if (preflight.headers.get("access-control-allow-origin") !== "https://www.clsufacultyconnect.com") {
  throw new Error("The production custom domain is missing from chatbot CORS.");
}

const chat = await fetch(`${baseUrl}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "How do I request a consultation?" }),
  signal: AbortSignal.timeout(20_000),
});
const chatBody = await chat.json();
if (chat.status !== 403 || !String(chatBody.detail || "").includes("security check")) {
  throw new Error(
    `Chatbot must reject requests without Turnstile: ${chat.status} ${JSON.stringify(chatBody)}`,
  );
}

console.log(`Production smoke checks passed for ${baseUrl}.`);
