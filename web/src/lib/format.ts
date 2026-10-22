/** Les montants de l'API sont en centimes entiers (1850000 = 18 500,00 €). */
export function moneyMinor(minor: number, currency = 'EUR', opts: { decimals?: boolean } = {}): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: opts.decimals === false ? 0 : 2,
    maximumFractionDigits: opts.decimals === false ? 0 : 2,
  }).format(minor / 100);
}

/** 12_500_000_000 centimes → "€125M" (affichage compact pour les KPI de portefeuille). */
export function moneyCompactMinor(minor: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(minor / 100)
    .replace(/(\d)([kmbt])$/, (_, d, u) => d + u.toUpperCase());
}

export const integer = (n: number) => new Intl.NumberFormat('en-GB').format(n);

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function dateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
