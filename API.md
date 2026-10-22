# FreightRecover AI — Contrat d'API (pour le frontend Lovable)

Base URL : `https://01a16399-8429-78d3-b8f6-dbc0db27351b-8080.eur-1.aiven.app` (en local : `http://localhost:8080`). JSON partout, CORS ouvert pour `*.lovable.app`, `*.lovableproject.com`, `*.lovable.dev` et `localhost`.
De vraies réponses capturées sont dans [`docs/api-examples/`](docs/api-examples/).

**Montants** : entiers en centimes (`1850000` = 18 500,00 €). Formatage côté front : `(v / 100).toLocaleString("fr-FR", { style: "currency", currency })`.

**Erreurs** : toujours `{ "error": { "code": "...", "message": "..." } }`, avec le statut HTTP adapté (400 validation, 404, 409, 413, 422 document refusé, 502 IA en échec, 503 IA non configurée).

## Parcours de démo

1. `POST /api/documents/upload` (facture + contrat), ou utiliser les documents de démo pré-chargés (`GET /api/documents?demo=true`).
2. `POST /api/analyses` → `202` avec `id` et `status: "PENDING"`.
3. Interroger `GET /api/analyses/:id` toutes les secondes jusqu'à `COMPLETED`, `NEEDS_REVIEW` ou `FAILED`. Afficher `steps[]` pour les étapes visuelles.
4. Afficher `discrepancies[]`, puis le détail : `GET /api/discrepancies/:id`.
5. Bouton **Generate Recovery Claim** → `POST /api/discrepancies/:id/claim`, puis afficher `text` (copier) et `downloadUrl` (télécharger).

IDs fixes des documents de démo :

| ID | Fichier |
|---|---|
| `00000000-0000-4000-8000-000000000001` | `invoice-sample.pdf` (facture FR-2026-0842, 42 500 €) |
| `00000000-0000-4000-8000-000000000002` | `contract-sample.pdf` (contrat AOL-SVC-2026-017, clause 4.2.1 : 24 000 €) |
| `00000000-0000-4000-8000-000000000003` | `invoice-sample.csv` (même facture au format CSV → démo des doublons) |

## Endpoints

### `GET /health`
`200` `{ status: "ok", api: "ok", db: { ok, latencyMs, serverVersion, tls }, ai: { configured }, fixtures: { available } }`. `503` si la DB ne répond pas.

### `POST /api/documents/upload`
`multipart/form-data` avec un champ fichier `invoice` (PDF/CSV/TXT) et/ou `contract` (PDF/TXT). Autre forme possible : un champ `kind` (`INVOICE` | `CONTRACT`) envoyé avant le champ `file`. 10 Mo maximum par fichier.

```js
const fd = new FormData();
fd.append("invoice", invoiceFile);
fd.append("contract", contractFile);
const res = await fetch(`${API}/api/documents/upload`, { method: "POST", body: fd });
const { invoiceDocumentId, contractDocumentId, documents } = await res.json();
```
`201` `{ documents: Document[], invoiceDocumentId, contractDocumentId }`. Document refusé (PDF scanné, format non supporté, etc.) : `422` (ou `413`) avec `error` et `documents`.

### `GET /api/documents?demo=true&kind=INVOICE` · `GET /api/documents/:id` · `GET /api/documents/:id/content`
Liste et métadonnées. `/:id` ajoute `pages: string[]`, le texte extrait page par page, utile pour surligner l'extrait de preuve. `/content` renvoie le fichier original : à utiliser dans un `<iframe>` ou un lien « Voir la facture ».

### `POST /api/analyses`
```json
{ "invoiceDocumentId": "uuid", "contractDocumentId": "uuid", "extractionMode": "AI", "wait": false }
```
- `extractionMode` : `"AI"` (par défaut, extraction Claude en direct, 10 à 60 s) ou `"FIXTURE"` (extraction pré-construite, autorisée **uniquement** sur les documents de démo, et étiquetée comme telle).
- `wait: true` : attend la fin et renvoie le résultat complet (`200`). Sinon : `202` immédiat, puis polling.
- `503 AI_UNAVAILABLE` si le mode IA est demandé sans clé configurée côté serveur.

### `GET /api/analyses/:id`
Champs principaux (exemple complet : `docs/api-examples/analysis.json`) :

| Champ | Description |
|---|---|
| `status` | `PENDING` → `PROCESSING` → `COMPLETED` \| `NEEDS_REVIEW` \| `FAILED` |
| `stage` | pendant `PROCESSING` : `EXTRACTING`, `MATCHING_AND_AUDITING`, `DUPLICATE_CHECK_AND_PERSISTENCE` |
| `steps[]` | `{ key, label, status: "pending" \| "running" \| "done" \| "failed", startedAt }` × 3 : extraction, recherche du tarif et comparaison, détection |
| `extractionMethod` | `"AI"` ou `"FIXTURE"`. **Afficher un badge** : une fixture ne doit jamais être présentée comme une extraction IA en direct |
| `invoice`, `contractRates[]` | données extraites, chacune avec sa `source` (extrait mot pour mot, page, clause, `verified`) |
| `audit` | `lineResults[]`, `reviewItems[]` (raisons des `NEEDS_REVIEW`), `warnings[]` |
| `discrepancies[]` | anomalies (voir ci-dessous) |
| `totals` | `verifiedRecoverableMinor` (récupérable vérifié), `potentialDuplicateMinor` (à vérifier) |
| `error` | `{ code, message }` si `FAILED` |

### `GET /api/analyses`
Historique : `{ analyses: [{ id, status, invoiceNumber, discrepancyCount, verifiedRecoverableMinor, extractionMethod, createdAt }] }`.

### `GET /api/discrepancies?analysisId=&type=&status=&limit=`
`type` : `RATE_MISMATCH` (surfacturation contractuelle, `VERIFIED`) ou `DUPLICATE_BILLING` (doublon potentiel, `NEEDS_REVIEW`).
Chaque anomalie : `id, type, status, claimable, invoiceNumber, shipmentId, carrier, currency, billedAmountMinor, expectedAmountMinor, differenceMinor, calculation, explanation, evidence, claimCount, latestClaimId`.

### `GET /api/discrepancies/:id` (écran détail)
Ajoute `quantity`, `unitRateMinor`, `matchCriteria[]` (transporteur, route, conteneur, type de frais, date, devise : valeur facture vs valeur contrat), `contractRate` (clause), `invoiceLine`, `invoice`, `extractionMethod`, `documents: { invoiceDocumentId, contractDocumentId }`, et `claim` (dernière réclamation ou `null`).
`evidence.invoiceEvidence` / `evidence.contractEvidence` : `{ documentId, filename, page?, section?, excerpt, verified }`.
Pour un doublon : `evidence.previousInvoice` (facture déjà reçue) et `evidence.previousInvoiceEvidence`.

### `POST /api/discrepancies/:id/claim`
Body optionnel `{ "regenerate": true }`. `201` à la création, `200` si une réclamation existe déjà (elle est renvoyée telle quelle).
`409 CLAIM_NOT_ALLOWED` si l'anomalie n'est pas `claimable`, c'est le cas des doublons à vérifier.
Réponse : `{ id, status: "DRAFT", requiresHumanApproval: true, generatedBy: "AI" | "TEMPLATE", subject, body, text, disputedAmountMinor, currency, evidence[], warnings[], downloadUrl }`.
Afficher `generatedBy` : `TEMPLATE` signifie que le brouillon a été construit à partir des faits vérifiés parce que l'IA n'était pas disponible.

### `GET /api/claims/:id` · `GET /api/claims/:id/download`
`/download` renvoie un `.txt` en pièce jointe (`<a href={API + claim.downloadUrl}>`).

### `GET /api/dashboard`
- `simulatedPortfolio` (`simulated: true`) : 125 M€ de dépenses, 3,2 M€ récupérables, 48 250 factures, 1 842 anomalies, `byCategory[]`, `byStatus[]`. **À afficher avec la mention « données simulées ».**
- `live` (`simulated: false`) : chiffres calculés depuis PostgreSQL. `analyses`, `invoicesAnalyzed`, `discrepancies.byType[]`, `verifiedRecoverableMinor`, `potentialToReviewMinor`, `claims`, `recentDiscrepancies[]`.
