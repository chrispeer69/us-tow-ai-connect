import type { MetadataRoute } from "next";

const SITE_URL = "https://www.ustowaiconnect.com";

// Serves /sitemap.xml — lists the public, indexable pages. Authenticated /
// app routes (admin, onboarding, driver, etc.) are intentionally excluded and
// are also disallowed in robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const routes: Array<{ path: string; priority: number }> = [
    { path: "", priority: 1 },
    { path: "/demo", priority: 0.8 },
    { path: "/schedule-demo", priority: 0.8 },
    { path: "/inquire-shares", priority: 0.7 },
    { path: "/sign-up", priority: 0.6 },
    { path: "/sign-in", priority: 0.5 },
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
  ];

  return routes.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: "monthly",
    priority,
  }));
}
