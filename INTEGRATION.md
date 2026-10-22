# FreightRecover AI — Moteur (Dev 2) : guide d'intégration pour l'API (Dev 1)

Le moteur ne connaît ni HTTP ni PostgreSQL : il reçoit des fichiers/textes et retourne des objets JSON-sérialisables.
Tout s'importe depuis `src/index.ts`. Les types partagés sont dans `src/types/shared.ts`.

## Installation

```bash
npm install            # @anthropic-ai/sdk, zod, unpdf, csv-parse
cp .env.example .env   # ANTHROPIC_API_KEY=... (côté serveur uniquement, jamais exposée au frontend)
npm test               # tests unitaires + e2e sur les fixtures (sans réseau)
npm run demo           # démo bout en bout avec vrais appels IA sur les PDF de démo
npm run demo -- --fixture   # démo hors ligne (extraction FIXTURE, explicitement étiquetée)
```

Variables : `ANTHROPIC_API_KEY` (obligatoire pour l'IA), `FREIGHTRECOVER_AI_MODEL` (défaut `claude-opus-5-5`), `FREIGHTRECOVER_AI_EFFORT` (défaut `medium`).

## Utilisation

```ts
import { parseDocument, analyzeDocuments, generateClaim, renderClaimAsText, isEngineError } from "./engine/src/index.js";

// 1. Upload : valider et extraire le texte (PDF/CSV/TXT, 10 Mo max, PDF scanné refusé)
const invoice = await parseDocument({ documentId, filename, kind: "INVOICE", content: buffer, mimeType });
const contract = await parseDocument({ documentId, filename, kind: "CONTRACT", content: buffer, mimeType });

// 2. Analyse : extraction IA (2 appels en parallèle) puis matching + audit déterministes
const { extracted, audit } = await analyzeDocuments(invoice, contract, {
  onStage: async (stage) => updateAnalysisStatus(id, stage), // "EXTRACTING" | "MATCHING_AND_AUDITING"
});

// 3. Réclamation (uniquement pour une anomalie VERIFIED)
const claim = await generateClaim(audit.discrepancies[0]);
const text = renderClaimAsText(claim); // pour copier / télécharger
```

Les trois fonctions du contrat initial existent aussi séparément : `extractDocuments(invoice, contract)`, `auditInvoice(extracted)` (pure, synchrone), `generateClaim(finding)`. `extractDocuments` accepte un `ParsedDocument`, un `{ documentId, filename, text }` ou une simple chaîne.

## Statuts d'analyse

| Moment | Statut API conseillé |
|---|---|
| `parseDocument` OK | `UPLOADED` |
| `onStage("EXTRACTING")` | `EXTRACTING` (10 à 60 s selon le modèle) |
| `onStage("MATCHING_AND_AUDITING")` | `MATCHING` puis `AUDITING` : une seule étape déterministe de quelques ms |
| `audit.status === "COMPLETED"` | `COMPLETED` |
| `audit.status === "NEEDS_REVIEW"` | `NEEDS_REVIEW` (voir `audit.reviewItems`) |
| `EngineError` levée | `FAILED` (+ `error.code`, `error.message`) |

## Persistance PostgreSQL (suggestion de mapping)

- `invoices` / `invoice_lines` ← `extracted.invoice` / `extracted.invoice.lines` (`amountMinor`, `quantity`, `chargeType`, `source` en jsonb)
- `contracts` / `rate_rules` ← `extracted.rates` (`unitRateMinor`, `rateBasis`, `validFrom`, `validTo`, `source` → `source_reference`)
- `discrepancies` ← `audit.discrepancies[]` : `expected_amount = expectedAmountMinor`, `billed_amount = billedAmountMinor`, `difference = differenceMinor`, `evidence = { invoiceEvidence, contractEvidence, matchCriteria, calculation, explanation }`, `status = "VERIFIED"`
- Les éléments à revoir sont dans `audit.reviewItems` / `audit.lineResults` (outcome `NEEDS_REVIEW`).
- Claim : stocker `RecoveryClaim` en jsonb sur la discrepancy.

Montants : toujours des entiers en centimes (`4250000` = 42 500,00 €). Formatage : `formatMinor(1850000, "EUR")` → `"EUR 18,500.00"`.

## Erreurs (`EngineError.code` → HTTP)

| Code | HTTP | Sens |
|---|---|---|
| `EMPTY_DOCUMENT`, `UNSUPPORTED_FORMAT`, `UNREADABLE_DOCUMENT`, `SCANNED_PDF`, `INVALID_INPUT` | 422 | Document refusé |
| `DOCUMENT_TOO_LARGE` | 413 | > 10 Mo |
| `CLAIM_NOT_ALLOWED` | 409 | Réclamation demandée sur une anomalie non `VERIFIED` |
| `AI_UNAVAILABLE` | 503 | Clé IA absente ou refusée |
| `AI_REQUEST_FAILED`, `AI_REFUSAL`, `INVALID_AI_OUTPUT` | 502 | Échec de l'extraction IA → analyse `FAILED` |

`generateClaim` ne lève pas d'erreur si l'IA échoue : il retourne un brouillon `generatedBy: "TEMPLATE"` construit uniquement à partir des faits vérifiés, avec un avertissement. Le frontend doit afficher `generatedBy`.

## Garanties

- L'IA extrait seulement ; elle ne choisit pas le tarif et ne calcule rien. Matching et calculs sont déterministes (entiers, EUR uniquement, pas de conversion de change).
- Chaque extrait de preuve est revérifié mot pour mot dans le texte du document. Le numéro de page est calculé par le moteur, jamais par le modèle. Sans preuve vérifiée, le résultat passe en `NEEDS_REVIEW`.
- Donnée manquante ou ambiguë (route, date, conteneur, devise, tarifs contradictoires) → `NEEDS_REVIEW`, jamais d'invention.
- La réclamation reste `DRAFT` + `requiresHumanApproval: true`. Le montant contesté vient toujours du calcul, jamais de l'IA. Le texte IA est validé (montants autorisés, aucune menace juridique, aucun « déjà remboursé ») ; s'il est invalide, il est régénéré une fois, puis remplacé par le template.
- `extracted.meta.method` vaut `"AI"` ou `"FIXTURE"`. Une fixture ne doit jamais être présentée comme une extraction IA en direct.

## Fixtures de démo

`fixtures/invoice-sample.pdf|.txt|.csv` et `fixtures/contract-sample.pdf|.txt` décrivent le cas Atlantic Ocean Lines, FR-2026-0842 / SHIP-00421, Shanghai → Rotterdam, 40HC : 42 500 € facturés contre 24 000 € (clause 4.2.1), soit un écart de 18 500 €. Le résultat attendu est dans `fixtures/expected-audit.json`.
