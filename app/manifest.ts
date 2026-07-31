import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Youtarr Feed",
    short_name: "Youtarr",
    description: "A mobile-first subscription feed and local playback app for Youtarr.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0c0d",
    theme_color: "#0c0c0d",
    orientation: "portrait",
  };
}
