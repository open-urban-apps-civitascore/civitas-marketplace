/**
 * OPEN/URBAN/APPS. Die Schrägstriche sind das Zeichen — sie greifen auf, wie
 * CIVITAS / CORE sich selbst schreibt, und stellen das Vorhaben damit neben die
 * Plattform statt daneben als eigene Marke. In Monoschrift gesetzt, damit es als
 * Name liest und nicht als Überschrift, die zufällig in Versalien steht.
 *
 * Übernommen aus der Landing Page (appstore-landing-page/components/wordmark.tsx).
 */
const PARTS = ["OPEN", "URBAN", "APPS"] as const;

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-mono font-medium tracking-[0.12em] ${className}`}>
      {PARTS.map((part, index) => (
        <span key={part}>
          {index > 0 ? (
            <span aria-hidden="true" style={{ color: "var(--logo-frame)" }}>
              /
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </span>
  );
}
