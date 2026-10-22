import { z } from "zod";
import { getDefaultCaller, type LlmCaller } from "../ai/client.js";
import { RECOVERY_AGENT_SYSTEM_PROMPT } from "../ai/prompts.js";
import { EngineError, isEngineError, type EngineErrorCode } from "../errors.js";
import type { DocumentSource, RecoveryClaim, VerifiedDiscrepancy } from "../types/shared.js";
import { collapseWhitespace, formatMinor, parseAmountToMinor } from "./normalization.js";

/**
 * Recovery claim drafting. The AI only writes the letter; every amount, reference and piece of
 * evidence comes from a VerifiedDiscrepancy and is re-checked in code. When the AI is unavailable
 * or its letter fails validation, a deterministic template built from the same facts is used.
 */

// ---------------------------------------------------------------------------
// Schema (structured-output friendly: no refinements)
// ---------------------------------------------------------------------------

export const ClaimOutputSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export type ClaimOutput = z.infer<typeof ClaimOutputSchema>;

export type GenerateClaimOptions = {
  llm?: LlmCaller;
  /** Default true. When false, AI failures and rejected letters throw instead of falling back. */
  allowTemplateFallback?: boolean;
};

const FALLBACK_CODES: ReadonlySet<EngineErrorCode> = new Set([
  "AI_UNAVAILABLE",
  "AI_REQUEST_FAILED",
  "AI_REFUSAL",
  "INVALID_AI_OUTPUT",
]);

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function isSafePositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && collapseWhitespace(value).length > 0;
}

function isVerifiedSource(value: unknown): value is DocumentSource {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<DocumentSource>;
  return s.verified === true && isNonEmptyString(s.excerpt) && isNonEmptyString(s.filename);
}

/**
 * Runtime check: only a VERIFIED rate mismatch with consistent arithmetic and verified evidence
 * may become a claim. Data may come from JSON or a database, so nothing is trusted from the type.
 */
export function assertClaimable(finding: VerifiedDiscrepancy): void {
  const problems: string[] = [];
  const f = (typeof finding === "object" && finding !== null ? finding : {}) as Partial<VerifiedDiscrepancy>;

  if (f.status !== "VERIFIED") problems.push(`status is ${String(f.status)}, expected VERIFIED`);
  if (f.type !== "RATE_MISMATCH") problems.push(`type is ${String(f.type)}, expected RATE_MISMATCH`);
  if (!isNonEmptyString(f.id)) problems.push("missing discrepancy id");
  if (!isNonEmptyString(f.invoiceNumber)) problems.push("missing invoice number");
  if (!isNonEmptyString(f.shipmentId)) problems.push("missing shipment id");
  if (!isNonEmptyString(f.carrier)) problems.push("missing carrier");
  if (typeof f.currency !== "string" || !/^[A-Z]{3}$/u.test(f.currency)) problems.push("invalid currency");
  if (!isSafePositiveInt(f.quantity)) problems.push("quantity must be a positive integer");
  if (!isSafePositiveInt(f.unitRateMinor)) problems.push("unitRateMinor must be a positive integer");
  if (!isSafeNonNegativeInt(f.billedAmountMinor)) problems.push("billedAmountMinor must be a non-negative integer");
  if (!isSafeNonNegativeInt(f.expectedAmountMinor)) problems.push("expectedAmountMinor must be a non-negative integer");
  if (!isSafePositiveInt(f.differenceMinor)) problems.push("differenceMinor must be a positive integer");
  if (
    isSafeNonNegativeInt(f.billedAmountMinor) &&
    isSafeNonNegativeInt(f.expectedAmountMinor) &&
    isSafePositiveInt(f.differenceMinor) &&
    f.billedAmountMinor - f.expectedAmountMinor !== f.differenceMinor
  ) {
    problems.push("billed − expected does not equal the difference");
  }
  if (!isNonEmptyString(f.calculation)) problems.push("missing calculation");
  if (!isVerifiedSource(f.invoiceEvidence)) problems.push("invoice evidence missing or not verified");
  if (!isVerifiedSource(f.contractEvidence)) problems.push("contract evidence missing or not verified");

  if (problems.length > 0) {
    throw new EngineError(
      "CLAIM_NOT_ALLOWED",
      `A recovery claim can only be drafted from a verified discrepancy: ${problems.join("; ")}.`,
      problems,
    );
  }
}

// ---------------------------------------------------------------------------
// AI payload
// ---------------------------------------------------------------------------

/** Only verified facts go to the model; amounts are given both as integers and display strings. */
export function buildClaimPayload(finding: VerifiedDiscrepancy): Record<string, unknown> {
  const c = finding.currency;
  return {
    invoiceNumber: finding.invoiceNumber,
    shipmentId: finding.shipmentId,
    carrier: finding.carrier,
    explanation: finding.explanation,
    quantity: finding.quantity,
    currency: c,
    amounts: {
      billed: { minor: finding.billedAmountMinor, display: formatMinor(finding.billedAmountMinor, c) },
      contractualUnitRate: { minor: finding.unitRateMinor, display: formatMinor(finding.unitRateMinor, c) },
      expected: { minor: finding.expectedAmountMinor, display: formatMinor(finding.expectedAmountMinor, c) },
      disputed: { minor: finding.differenceMinor, display: formatMinor(finding.differenceMinor, c) },
    },
    calculation: finding.calculation,
    invoiceEvidence: {
      filename: finding.invoiceEvidence.filename,
      page: finding.invoiceEvidence.page ?? null,
      excerpt: finding.invoiceEvidence.excerpt,
    },
    contractEvidence: {
      filename: finding.contractEvidence.filename,
      page: finding.contractEvidence.page ?? null,
      section: finding.contractEvidence.section ?? null,
      excerpt: finding.contractEvidence.excerpt,
    },
  };
}

function buildUserContent(finding: VerifiedDiscrepancy, feedback?: string[]): string {
  let content =
    "Draft the billing dispute letter for this verified discrepancy.\n\n" +
    `<verified_discrepancy>\n${JSON.stringify(buildClaimPayload(finding), null, 2)}\n</verified_discrepancy>`;
  if (feedback && feedback.length > 0) {
    content +=
      "\n\n<validation_feedback>\nYour previous draft was rejected for these reasons:\n" +
      feedback.map((p) => `- ${p}`).join("\n") +
      "\nRewrite the letter and fix every issue. Use only the display amounts above.\n</validation_feedback>";
  }
  return content;
}

// ---------------------------------------------------------------------------
// Letter validation
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /[[\]]/u, reason: "contains a placeholder bracket" },
  { pattern: /\{\{|\}\}/u, reason: "contains a template placeholder" },
  { pattern: /<[a-z][a-z _-]{0,30}>/iu, reason: "contains an angle-bracket placeholder" },
  {
    pattern: /\b(has|have|had|was|were) (already )?(been )?(refunded|reimbursed|recovered|credited|repaid|paid back)\b/iu,
    reason: "states or implies money was already recovered",
  },
  { pattern: /\balready (been )?(refunded|reimbursed|recovered|credited|repaid)\b/iu, reason: "states or implies money was already recovered" },
  { pattern: /\blegal action\b/iu, reason: "threatens legal action" },
  { pattern: /\blaw ?suits?\b/iu, reason: "threatens a lawsuit" },
  { pattern: /\bcourts?\b/iu, reason: "mentions court proceedings" },
  { pattern: /\blitigat(e|ion)\b/iu, reason: "threatens litigation" },
  { pattern: /\b(attorney|lawyer|solicitor)s?\b/iu, reason: "mentions legal counsel" },
  { pattern: /\bwithin \d+ (business |working |calendar )?days\b/iu, reason: "invents a deadline" },
];

/** Comma-grouped integer without decimals ("18,500"): read as thousands in a letter written in English. */
const GROUPED_INTEGER = /^\d{1,3}(,\d{3})+$/u;

function parseLetterAmount(text: string): number | null {
  if (GROUPED_INTEGER.test(text)) {
    const minor = Number(text.replace(/,/gu, "")) * 100;
    return Number.isSafeInteger(minor) ? minor : null;
  }
  const parsed = parseAmountToMinor(text);
  return parsed.ok ? parsed.minor : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** All monetary amounts adjacent to a currency marker ("EUR 42,500.00", "€24,000", "18,500.00 EUR"). */
export function extractMonetaryAmounts(text: string, currency = "EUR"): Array<{ text: string; minor: number | null }> {
  const markers = ["€", "EUR", currency].filter((m, i, all) => all.indexOf(m) === i).map(escapeRegExp).join("|");
  const number = String.raw`(\d[\d.,]*\d|\d)`;
  const prefix = new RegExp(String.raw`(?:${markers})\s?${number}`, "gu");
  const suffix = new RegExp(String.raw`(?<![\d.,])${number}\s?(?:${markers})(?![A-Za-z])`, "gu");
  const found = new Map<number, { text: string; minor: number | null }>();
  for (const re of [prefix, suffix]) {
    for (const m of text.matchAll(re)) {
      const raw = m[1] ?? "";
      const index = (m.index ?? 0) + m[0].indexOf(raw);
      if (!found.has(index)) found.set(index, { text: m[0], minor: parseLetterAmount(raw) });
    }
  }
  return [...found.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
}

/** Returns the problems found in an AI-drafted letter; an empty array means the letter is acceptable. */
export function validateClaimText(subject: string, body: string, finding: VerifiedDiscrepancy): string[] {
  const problems: string[] = [];
  const c = finding.currency;
  if (collapseWhitespace(subject).length === 0) problems.push("Subject is empty.");
  if (collapseWhitespace(body).length === 0) problems.push("Body is empty.");

  const disputed = formatMinor(finding.differenceMinor, c);
  const bodyAmounts = extractMonetaryAmounts(body, c);
  if (!bodyAmounts.some((a) => a.minor === finding.differenceMinor)) {
    problems.push(`Body must state the disputed amount exactly as ${disputed}.`);
  }
  if (!body.includes(finding.invoiceNumber)) problems.push(`Body must mention invoice number ${finding.invoiceNumber}.`);
  if (!body.includes(finding.shipmentId)) problems.push(`Body must mention shipment reference ${finding.shipmentId}.`);

  const allowed = new Map<number, string>([
    [finding.billedAmountMinor, formatMinor(finding.billedAmountMinor, c)],
    [finding.expectedAmountMinor, formatMinor(finding.expectedAmountMinor, c)],
    [finding.unitRateMinor, formatMinor(finding.unitRateMinor, c)],
    [finding.differenceMinor, disputed],
  ]);
  const allowedList = [...allowed.values()].join(", ");
  // Verbatim quotes of the verified excerpts may carry other document amounts (e.g. a line unit price).
  let scanned = collapseWhitespace(`${subject}\n${body}`);
  for (const source of [finding.invoiceEvidence, finding.contractEvidence]) {
    const excerpt = collapseWhitespace(source.excerpt);
    if (excerpt.length > 0) scanned = scanned.split(excerpt).join(" ");
  }
  for (const amount of extractMonetaryAmounts(scanned, c)) {
    if (amount.minor === null) {
      problems.push(`Unreadable amount "${amount.text}"; use the display amounts exactly.`);
    } else if (!allowed.has(amount.minor)) {
      problems.push(`Amount "${amount.text}" is not one of the verified amounts (${allowedList}).`);
    }
  }

  const fullText = `${subject}\n${body}`;
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    const m = fullText.match(pattern);
    if (m) problems.push(`Letter ${reason} ("${m[0]}").`);
  }
  return [...new Set(problems)];
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function describeSource(source: DocumentSource, clause: boolean): string {
  const parts = [source.filename];
  if (source.page !== undefined) parts.push(`page ${source.page}`);
  if (clause && source.section) {
    const section = collapseWhitespace(source.section);
    parts.push(/^(clause|section|article|art\.|§)/iu.test(section) ? section : `clause ${section}`);
  }
  return parts.join(", ");
}

/** Deterministic, neutral claim letter built only from the verified facts. */
export function buildTemplateClaim(finding: VerifiedDiscrepancy): { subject: string; body: string } {
  const c = finding.currency;
  const billed = formatMinor(finding.billedAmountMinor, c);
  const unit = formatMinor(finding.unitRateMinor, c);
  const expected = formatMinor(finding.expectedAmountMinor, c);
  const disputed = formatMinor(finding.differenceMinor, c);
  const contractual = finding.quantity > 1 ? `${expected} (${unit} × ${finding.quantity})` : expected;

  const subject = `Freight Invoice Dispute — ${finding.invoiceNumber} (Shipment ${finding.shipmentId})`;
  const body = [
    "Dear Billing Team,",
    "",
    `We have reviewed invoice ${finding.invoiceNumber} issued by ${finding.carrier} for shipment ${finding.shipmentId} ` +
      "against the applicable contractual rate and identified a billing discrepancy that we would like to raise for your review.",
    "",
    `- Billed amount: ${billed}`,
    `- Contractual amount: ${contractual}`,
    `- Disputed amount: ${disputed}`,
    `- Calculation: ${finding.calculation}`,
    "",
    "Supporting evidence:",
    `1. Invoice (${describeSource(finding.invoiceEvidence, false)}):`,
    `   "${collapseWhitespace(finding.invoiceEvidence.excerpt)}"`,
    `2. Contract (${describeSource(finding.contractEvidence, true)}):`,
    `   "${collapseWhitespace(finding.contractEvidence.excerpt)}"`,
    "",
    `We kindly request that you review this charge and issue a credit note or reimbursement of the disputed amount of ${disputed} ` +
      `relating to invoice ${finding.invoiceNumber}.`,
    "",
    "Please let us know if you require any further information.",
    "",
    "Kind regards,",
    "Freight Audit Team",
  ].join("\n");
  return { subject, body };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

type AttemptResult =
  | { ok: true; subject: string; body: string; model: string }
  | { ok: false; problems: string[] };

async function attemptAiClaim(llm: LlmCaller, finding: VerifiedDiscrepancy, feedback?: string[]): Promise<AttemptResult> {
  let response;
  try {
    response = await llm({
      label: "recovery claim drafting",
      system: RECOVERY_AGENT_SYSTEM_PROMPT,
      content: buildUserContent(finding, feedback),
      schema: ClaimOutputSchema,
      maxTokens: 4000,
    });
  } catch (error) {
    if (isEngineError(error)) throw error;
    throw new EngineError("AI_REQUEST_FAILED", "AI request failed during recovery claim drafting.", String(error));
  }

  let json: unknown;
  try {
    json = JSON.parse(response.raw);
  } catch {
    return { ok: false, problems: ["Output was not valid JSON; return only a JSON object with subject and body."] };
  }
  const parsed = ClaimOutputSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, problems: ["Output did not match the schema { subject: string, body: string }."] };
  }
  const subject = parsed.data.subject.trim();
  const body = parsed.data.body.trim();
  const problems = validateClaimText(subject, body, finding);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, subject, body, model: response.model };
}

/**
 * Drafts a recovery claim for a verified discrepancy. Always returns a DRAFT requiring human approval;
 * the disputed amount is always the finding's verified difference, never a value from the model.
 */
export async function generateClaim(finding: VerifiedDiscrepancy, options: GenerateClaimOptions = {}): Promise<RecoveryClaim> {
  assertClaimable(finding);
  const allowFallback = options.allowTemplateFallback ?? true;
  const warnings: string[] = [];

  const base = {
    discrepancyId: finding.id,
    status: "DRAFT" as const,
    requiresHumanApproval: true as const,
    disputedAmountMinor: finding.differenceMinor,
    currency: finding.currency,
    invoiceNumber: finding.invoiceNumber,
    shipmentId: finding.shipmentId,
    evidence: [finding.invoiceEvidence, finding.contractEvidence],
  };

  let fallbackReason: string;
  try {
    const llm = options.llm ?? getDefaultCaller();
    let result = await attemptAiClaim(llm, finding);
    if (!result.ok) {
      const firstProblems = result.problems;
      result = await attemptAiClaim(llm, finding, firstProblems);
      if (result.ok) warnings.push(`AI claim draft was corrected after validation feedback: ${firstProblems.join(" ")}`);
    }
    if (result.ok) {
      return {
        ...base,
        subject: result.subject,
        body: result.body,
        generatedBy: "AI",
        model: result.model,
        generatedAt: new Date().toISOString(),
        warnings,
      };
    }
    if (!allowFallback) {
      throw new EngineError("INVALID_AI_OUTPUT", "AI claim draft failed validation twice.", result.problems);
    }
    fallbackReason = `AI claim draft rejected by validation (${result.problems.join(" ")}); draft built from verified facts template.`;
  } catch (error) {
    if (!allowFallback || !isEngineError(error) || !FALLBACK_CODES.has(error.code)) throw error;
    fallbackReason = `AI claim generation unavailable: ${error.code}; draft built from verified facts template.`;
  }

  const template = buildTemplateClaim(finding);
  return {
    ...base,
    subject: template.subject,
    body: template.body,
    generatedBy: "TEMPLATE",
    generatedAt: new Date().toISOString(),
    warnings: [...warnings, fallbackReason],
  };
}

/** Plain-text rendering for copy / download. */
export function renderClaimAsText(claim: RecoveryClaim): string {
  return ["DRAFT — requires human approval before sending", "", `Subject: ${claim.subject}`, "", claim.body, ""].join("\n");
}
