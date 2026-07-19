import type { MetadataRoute } from "next";

const SITE_URL = "https://www.ustowaiconnect.com";

// Private/authenticated app areas that should stay out of every index.
const DISALLOW = [
  "/admin",
  "/super-admin",
  "/onboarding",
  "/accept-invite",
  "/auth-callback",
  "/driver",
  "/api/",
];

// AI answer-engine / LLM crawlers we explicitly welcome. Being crawlable is
// the prerequisite for being cited in ChatGPT, Perplexity, Google AI
// Overviews, Gemini, Claude, etc. (Many sites block these by default.)
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "Amazonbot",
  "CCBot",
];

// Serves /robots.txt — welcomes AI + traditional crawlers on public pages,
// keeps the app's authenticated areas out, and links the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_CRAWLERS, allow: "/", disallow: DISALLOW },
      { userAgent: "*", allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
