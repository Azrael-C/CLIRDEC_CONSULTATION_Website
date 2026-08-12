const baseUrl = (process.env.PRODUCTION_URL || "https://clsu-faculty-connect.vercel.app").replace(/\/$/, "");

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
const healthBody = await health.json();
if (healthBody.status !== "ok" || healthBody.nlp !== "spaCy") {
  throw new Error(`Unexpected chatbot health payload: ${JSON.stringify(healthBody)}`);
}

const chat = await request("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "How do I request a consultation?" }),
});
const answer = await chat.json();
if (!answer.answer || !answer.source || answer.escalation) {
  throw new Error(`Unexpected approved chatbot response: ${JSON.stringify(answer)}`);
}

console.log(`Production smoke checks passed for ${baseUrl}.`);
