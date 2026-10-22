/**
 * Fond vivant de l'application : ciel doux, nuages qui dérivent, routes maritimes
 * pointillées sur lesquelles avancent des flèches, ports qui pulsent.
 * Décor pur : aria-hidden, pointer-events none, animations coupées si prefers-reduced-motion.
 */

// Routes (coordonnées dans le viewBox 1600×900). Les « ports » sont posés sur des points exacts des tracés.
const ROUTES = [
  { id: 'lane-a', d: 'M-40 650 C 260 520, 430 770, 760 600 S 1280 360, 1660 470', dur: 34 },
  { id: 'lane-b', d: 'M-40 230 C 300 340, 520 90, 860 220 S 1320 330, 1660 150', dur: 42 },
  { id: 'lane-c', d: 'M240 950 C 520 760, 700 850, 980 700 S 1420 640, 1660 770', dur: 38 },
];
const PORTS = [
  [760, 600],
  [860, 220],
  [980, 700],
];

export function Sky() {
  return (
    <div className="sky" aria-hidden>
      <div className="sky__cloud sky__cloud--a" />
      <div className="sky__cloud sky__cloud--b" />

      <svg className="sky__routes" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          {ROUTES.map((r) => (
            <path key={r.id} id={r.id} d={r.d} />
          ))}
        </defs>
        {ROUTES.map((r) => (
          <use key={r.id} href={`#${r.id}`} className="route" />
        ))}
        {PORTS.map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <circle className="port__pulse" r="6" style={{ animationDelay: `${i * 0.9}s` }} />
            <circle className="port__dot" r="4.5" />
          </g>
        ))}
        {/* Pointes de flèche qui suivent les routes (SMIL : s'échelonne avec le SVG, aucune JS) */}
        {ROUTES.map((r, i) => (
          <g key={r.id} className="ship">
            <path d="M-11 -8 L7 0 L-11 8 L-6 0 Z" />
            <animateMotion dur={`${r.dur}s`} begin={`${-i * 11}s`} repeatCount="indefinite" rotate="auto">
              <mpath href={`#${r.id}`} />
            </animateMotion>
          </g>
        ))}
      </svg>

    </div>
  );
}
