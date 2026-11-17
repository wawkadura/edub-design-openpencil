import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edub Design",
  description: "Le lieu commun de design des apps Edub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
