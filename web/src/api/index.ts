import { httpClient } from './http';

export * from './types';

/** Le front ne parle qu'au backend : pas de mode hors-ligne, pas de données locales. */
export const api = httpClient;

/** IDs fixes des documents de démonstration pré-chargés par le backend (extractionMode « FIXTURE » uniquement). */
export const DEMO_INVOICE_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_CONTRACT_ID = '00000000-0000-4000-8000-000000000002';
