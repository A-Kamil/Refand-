import { httpClient } from './http';

export * from './types';

/** Le front ne parle qu'au backend : pas de mode hors-ligne, pas de données locales. */
export const api = httpClient;
