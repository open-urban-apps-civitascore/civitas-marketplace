/**
 * Das Bildzeichen: drei Sechsecke, die sich einen Mittelpunkt teilen, und darauf
 * ein Würfel — die Wabe ist die Plattform, der Würfel das Paket, das dort liegt,
 * wo alle drei zusammenkommen.
 *
 * Als Geometrie nachgebaut statt als Bilddatei eingebunden: so bleibt es bei
 * 20 Pixeln im Kopf genauso scharf wie auf einem Messebanner, und die Farben
 * sind Design-Tokens statt eingebrannter Pixel.
 *
 * Übernommen aus der Landing Page (appstore-landing-page/components/logo.tsx) —
 * eine Marke, drei Anwendungen. Wer hier etwas ändert, ändert es dort mit,
 * sonst laufen die drei Auftritte auseinander. Die Farbwerte liegen als
 * `--logo-*`-Tokens in globals.css und sind in allen dreien identisch.
 */
const HEXES = [
  "M0 -200 L86.6 -150 L86.6 -50 L0 0 L-86.6 -50 L-86.6 -150 Z",
  "M-86.6 -50 L0 0 L0 100 L-86.6 150 L-173.2 100 L-173.2 0 Z",
  "M86.6 -50 L173.2 0 L173.2 100 L86.6 150 L0 100 L0 0 Z",
];

export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="-187 -213 374 376"
      role="img"
      aria-label="OPEN/URBAN/APPS"
      className={className}
    >
      <g
        fill="none"
        stroke="var(--logo-frame)"
        strokeWidth="24"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {HEXES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Drei Flächen, drei Helligkeiten — keine Schatten, keine Verläufe,
          damit der Würfel auch als 16-Pixel-Favicon noch ein Würfel ist. */}
      <path d="M0 -64.7 L56 -32.3 L0 0 L-56 -32.3 Z" fill="var(--logo-cube-top)" />
      <path d="M-56 -32.3 L0 0 L0 56 L-56 23.7 Z" fill="var(--logo-cube-left)" />
      <path d="M56 -32.3 L0 0 L0 56 L56 23.7 Z" fill="var(--logo-cube-right)" />
    </svg>
  );
}
