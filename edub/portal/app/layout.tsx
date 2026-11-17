import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edub Design",
  description: "Le lieu commun de design des apps Edub",
  applicationName: "Edub Design",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Edub Design", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0b0b0f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: "if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){})" }} />
      </body>
    </html>
  );
}
