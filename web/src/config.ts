/** Configuration publique (variables VITE_* : jamais de secret côté front). */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
