import type { MetadataRoute } from "next";

// Serves /manifest.webmanifest — PWA/mobile metadata (install name, colors,
// icon). Icon reuses the brand SVG favicon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "US Tow AI-Connect",
    short_name: "AI-Connect",
    description:
      "The 24/7 AI dispatcher for towing companies — answers every call and makes outbound revenue calls.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e1a",
    theme_color: "#0a0e1a",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
