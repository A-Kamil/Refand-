import type { ReactNode } from 'react';
import { IconArrowRight } from './Icons';

/**
 * Couche « route » — les repères visuels de ref& : flèches de fret, anneau d'attention,
 * surlignage, puces fléchées, tampons de statut.
 * Règle d'usage (cf. docs/DESIGN_SYSTEM.md §5) : ces éléments pointent ou qualifient une donnée ;
 * ils ne portent jamais d'information absente des données.
 */

/** Flèche de fret inline (séparateur de titre). */
export function FlowArrow() {
  return (
    <svg className="flow-arrow" viewBox="0 0 40 16" aria-hidden>
      <path d="M2 8h34M29 2l7 6-7 6" />
    </svg>
  );
}

/** Anneau d'attention pulsé autour d'un montant clé. */
export function Circled({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <span className="pen-circled" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </span>
  );
}

/** Mot mis en avant par une barre menthe qui se déploie. */
export function Underlined({ children }: { children: ReactNode }) {
  return <span className="pen-underlined">{children}</span>;
}

/** Passage surligné (preuve dans un extrait de document). */
export function Marker({ children }: { children: ReactNode }) {
  return <mark className="pen-marker">{children}</mark>;
}

/** Puce fléchée qui commente une donnée. */
export function MarginNote({ children }: { children: ReactNode }) {
  return (
    <span className="pen-note">
      <IconArrowRight width={14} height={14} strokeWidth={2.2} />
      <span>{children}</span>
    </span>
  );
}

/** Tampon de statut (DRAFT, DEMO, SIMULATED). */
export function Stamp({ children, tone = 'pen' }: { children: ReactNode; tone?: 'pen' | 'warn' }) {
  return <span className={`stamp stamp--${tone}`}>{children}</span>;
}
