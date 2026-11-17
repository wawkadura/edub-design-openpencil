/** PWA manifest (public in nginx: browsers fetch it without the Authelia cookie). No user data. */
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      name: "Edub Design",
      short_name: "Edub Design",
      description: "Le lieu commun de design des apps Edub",
      lang: "fr",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#0b0b0f",
      theme_color: "#0b0b0f",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
