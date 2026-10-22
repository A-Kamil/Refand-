import { API_BASE_URL } from '../config';
import { ApiError, type ApiClient } from './types';

/** Erreurs du backend : { error: { code, message } } avec un statut HTTP adapté. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(`Cannot reach the backend at ${API_BASE_URL}.`, 'network');
  }
  if (!res.ok) {
    let message = '';
    let code: string | undefined;
    try {
      const body = await res.json();
      message = body?.error?.message ?? body?.message ?? '';
      code = body?.error?.code;
    } catch {
      /* corps non JSON : on garde le statut */
    }
    throw new ApiError(message || `Backend responded ${res.status} ${res.statusText}.`, 'http', res.status, code);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('The backend returned an unreadable response.', 'invalid', res.status);
  }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const enc = encodeURIComponent;

export const httpClient: ApiClient = {
  getHealth: () => request('/health'),
  getDashboard: () => request('/api/dashboard'),

  uploadDocuments({ invoice, contract }) {
    const form = new FormData();
    form.append('invoice', invoice);
    form.append('contract', contract);
    return request('/api/documents/upload', { method: 'POST', body: form });
  },

  createAnalysis: (req) => request('/api/analyses', json(req)),
  getAnalysis: (id) => request(`/api/analyses/${enc(id)}`),
  listDiscrepancies: (analysisId) =>
    request(`/api/discrepancies${analysisId ? `?analysisId=${enc(analysisId)}` : ''}`),
  getDiscrepancy: (id) => request(`/api/discrepancies/${enc(id)}`),
  createClaim: (id, opts) => request(`/api/discrepancies/${enc(id)}/claim`, json(opts?.regenerate ? { regenerate: true } : {})),
  claimDownloadUrl: (claim) => `${API_BASE_URL}${claim.downloadUrl}`,
};
