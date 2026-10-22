/**
 * Contrat d'API entre le front ref& et le backend FreightRecover (A-Kamil/Refand-, branche dev1/api).
 * Source de vérité : API.md du backend + réponses capturées dans docs/api-examples/.
 * Montants : ENTIERS EN CENTIMES (`1850000` = 18 500,00 €).
 */

export type Currency = string; // ISO 4217

/* ── Documents ──────────────────────────────────────────── */

export type DocumentKind = 'INVOICE' | 'CONTRACT';

export interface ApiDocument {
  id: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  format: string;
  pageCount: number | null;
  status: string;
  warnings: string[];
  error: unknown;
  isDemo: boolean;
  createdAt: string;
  contentUrl: string;
}

export interface UploadResponse {
  documents: ApiDocument[];
  invoiceDocumentId: string;
  contractDocumentId: string;
}

/* ── Preuves et critères ────────────────────────────────── */

export interface SourceEvidence {
  documentId?: string;
  filename: string;
  page?: number;
  section?: string;
  /** Extrait mot pour mot du document. */
  excerpt: string;
  /** Vrai si l'extrait a été retrouvé tel quel dans le document source. */
  verified: boolean;
}

export interface MatchCriterion {
  criterion: string; // CHARGE_TYPE, CARRIER, ROUTE, CONTAINER, DATE, CURRENCY
  invoiceValue: string;
  contractValue: string;
}

/* ── Anomalies ──────────────────────────────────────────── */

export type DiscrepancyType = 'RATE_MISMATCH' | 'DUPLICATE_BILLING';
export type DiscrepancyStatus = 'VERIFIED' | 'NEEDS_REVIEW';

export interface Discrepancy {
  id: string;
  analysisId: string;
  type: DiscrepancyType;
  status: DiscrepancyStatus;
  /** Seules les anomalies VERIFIED de type RATE_MISMATCH peuvent donner une réclamation. */
  claimable: boolean;
  invoiceNumber: string;
  shipmentId?: string | null;
  carrier?: string | null;
  currency: Currency;
  billedAmountMinor: number;
  expectedAmountMinor: number;
  differenceMinor: number;
  /** Calcul textuel fourni par le moteur (ex. « EUR 42,500.00 − (EUR 24,000.00 × 1) = … »). */
  calculation: string;
  explanation: string;
  evidence: {
    matchCriteria?: MatchCriterion[];
    invoiceEvidence?: SourceEvidence;
    contractEvidence?: SourceEvidence;
    previousInvoice?: { filename: string; invoiceNumber?: string; invoiceDate?: string; documentId?: string };
    previousInvoiceEvidence?: SourceEvidence;
  };
  claimCount: number;
  latestClaimId: string | null;
  createdAt: string;

  /* Détail (GET /api/discrepancies/:id) */
  quantity?: number;
  unitRateMinor?: number;
  matchCriteria?: MatchCriterion[];
  contractRate?: {
    contractNumber?: string;
    chargeLabel?: string;
    route?: string;
    containerType?: string;
    rateBasis?: string;
    validFrom?: string;
    validTo?: string;
    unitRateMinor?: number;
    source?: SourceEvidence;
  } | null;
  invoiceLine?: {
    lineNumber?: number;
    chargeLabel?: string;
    description?: string;
    quantity?: number;
    unitPriceMinor?: number;
    amountMinor?: number;
    source?: SourceEvidence;
  } | null;
  invoice?: {
    invoiceNumber?: string;
    invoiceDate?: string;
    shipmentId?: string;
    shipmentDate?: string;
    route?: string;
    containerType?: string;
    carrier?: string;
  } | null;
  extractionMethod?: ExtractionMethod | null;
  documents?: { invoiceDocumentId: string; contractDocumentId: string };
  claim?: RecoveryClaim | null;
}

export interface DiscrepancyList {
  discrepancies: Discrepancy[];
}

/* ── Analyses ───────────────────────────────────────────── */

export type AnalysisStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'NEEDS_REVIEW' | 'FAILED';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
/** « AI » = extraction Claude en direct ; « FIXTURE » = extraction pré-construite (documents de démo uniquement). */
export type ExtractionMethod = 'AI' | 'FIXTURE';

export interface AnalysisStep {
  /** EXTRACTION | RATE_LOOKUP_AND_COMPARISON | DETECTION */
  key: string;
  label: string;
  status: StepStatus;
  startedAt: string | null;
}

export interface ReviewItem {
  code: string;
  message: string;
  invoiceLineId: string | null;
}

export interface Analysis {
  id: string;
  status: AnalysisStatus;
  stage: string | null;
  steps: AnalysisStep[];
  extractionMethod: ExtractionMethod | null;
  documents: { invoice?: ApiDocument; contract?: ApiDocument };
  extractionWarnings: string[];
  audit: { status?: string; reviewItems: ReviewItem[]; warnings: string[] } | null;
  discrepancies: Discrepancy[];
  totals: {
    currency: Currency | null;
    /** Récupérable VÉRIFIÉ (surfacturations contractuelles). */
    verifiedRecoverableMinor: number;
    /** Doublons potentiels : À VÉRIFIER, jamais additionnés au récupérable. */
    potentialDuplicateMinor: number;
  };
  error: { code: string; message: string } | null;
  createdAt: string;
  durationMs: number | null;
}

export interface CreateAnalysisRequest {
  invoiceDocumentId: string;
  contractDocumentId: string;
  /** « FIXTURE » n'est accepté que sur les documents de démo. Défaut côté serveur : « AI ». */
  extractionMode?: ExtractionMethod;
}

/* ── Réclamation ────────────────────────────────────────── */

export interface RecoveryClaim {
  id: string;
  discrepancyId: string;
  status: 'DRAFT';
  requiresHumanApproval: true;
  /** TEMPLATE = brouillon construit à partir des faits vérifiés (IA indisponible). */
  generatedBy: 'AI' | 'TEMPLATE';
  subject: string;
  body: string;
  /** Texte complet à copier (inclut la mention « DRAFT — requires human approval »). */
  text: string;
  disputedAmountMinor: number;
  currency: Currency;
  invoiceNumber: string;
  shipmentId?: string | null;
  evidence: SourceEvidence[];
  warnings: string[];
  createdAt: string;
  downloadUrl: string;
}

/* ── Dashboard ──────────────────────────────────────────── */

export interface CategoryBreakdown {
  type: string;
  label: string;
  count: number;
  amountMinor: number;
}

export interface Dashboard {
  /** Portefeuille FICTIF fourni par le backend : toujours étiqueté « simulated ». */
  simulatedPortfolio: {
    simulated: true;
    label: string;
    currency: Currency;
    annualFreightSpendMinor: number;
    potentiallyRecoverableMinor: number;
    invoicesAnalyzed: number;
    anomaliesIdentified: number;
    byCategory: CategoryBreakdown[];
    byStatus: { status: string; count: number }[];
  };
  /** Chiffres RÉELS calculés depuis la base. */
  live: {
    simulated: false;
    label: string;
    currency: Currency;
    analyses: { total: number; byStatus: Record<string, number> };
    invoicesAnalyzed: number;
    invoicesStored: number;
    discrepancies: {
      total: number;
      verified: number;
      needsReview: number;
      byType: { type: DiscrepancyType; count: number; amountMinor: number }[];
    };
    verifiedRecoverableMinor: number;
    potentialToReviewMinor: number;
    claims: { total: number; ai: number; template: number };
    recentDiscrepancies: Discrepancy[];
  };
}

export interface Health {
  status: string;
  db: { ok: boolean };
  ai: { configured: boolean };
  fixtures: { available: boolean };
}

/* ── Client ─────────────────────────────────────────────── */

export interface ApiClient {
  getHealth(): Promise<Health>;
  getDashboard(): Promise<Dashboard>;
  uploadDocuments(files: { invoice: File; contract: File }): Promise<UploadResponse>;
  createAnalysis(req: CreateAnalysisRequest): Promise<Analysis>;
  getAnalysis(id: string): Promise<Analysis>;
  listDiscrepancies(analysisId?: string): Promise<DiscrepancyList>;
  getDiscrepancy(id: string): Promise<Discrepancy>;
  createClaim(discrepancyId: string, opts?: { regenerate?: boolean }): Promise<RecoveryClaim>;
  /** URL absolue de téléchargement (.txt) de la réclamation. */
  claimDownloadUrl(claim: RecoveryClaim): string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'http' | 'invalid',
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Ligne libellé / valeur pour l'affichage côte à côte (construite côté front à partir des champs de l'API). */
export interface LabeledRow {
  label: string;
  value: string;
}
