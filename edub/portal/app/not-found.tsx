import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell">
      <h1>Introuvable</h1>
      <p className="muted">Cette page n&apos;existe pas.</p>
      <Link className="btn" href="/">Mes projets</Link>
    </main>
  );
}
