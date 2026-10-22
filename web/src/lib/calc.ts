import type { Discrepancy, DiscrepancyType } from '../api';

/** Écart recalculé côté front en centimes entiers (facturé − attendu) : aucune erreur d'arrondi. */
export const computeDifferenceMinor = (d: Pick<Discrepancy, 'billedAmountMinor' | 'expectedAmountMinor'>) =>
  d.billedAmountMinor - d.expectedAmountMinor;

/** Vrai si l'écart annoncé par le backend ne correspond pas à facturé − attendu. */
export const differenceMismatch = (d: Discrepancy) => computeDifferenceMinor(d) !== d.differenceMinor;

/** Surcoût en % du montant contractuel (surfacturation de tarif uniquement). */
export function overchargePct(d: Discrepancy): number | null {
  if (d.type !== 'RATE_MISMATCH' || d.expectedAmountMinor <= 0) return null;
  return Math.round(((d.billedAmountMinor - d.expectedAmountMinor) / d.expectedAmountMinor) * 100);
}

/** Vocabulaire du backend (cf. libellés de /api/dashboard). */
export const TYPE_LABEL: Record<DiscrepancyType, string> = {
  RATE_MISMATCH: 'Contract rate overcharge',
  DUPLICATE_BILLING: 'Duplicate billing',
};
