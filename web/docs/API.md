# API

Le front consomme le backend **FreightRecover** (dépôt `A-Kamil/Refand-`, branche `dev1/api`).
Le contrat de référence est son `API.md` ; les types TypeScript correspondants sont dans [`src/api/types.ts`](../src/api/types.ts), le client dans [`src/api/http.ts`](../src/api/http.ts).

Points qui structurent l'interface :

- **Montants en centimes entiers** (`1850000` = 18 500,00 €).
- **Erreurs** : `{ "error": { "code", "message" } }` ; le front affiche `message` et réagit à `code` (`AI_UNAVAILABLE`, `CLAIM_NOT_ALLOWED`…).
- **Analyse** : `POST /api/analyses` → polling de `GET /api/analyses/:id` toutes les secondes jusqu'à `COMPLETED`, `NEEDS_REVIEW` ou `FAILED`. Les 3 étapes (`steps[]`) sont affichées telles quelles.
- **`extractionMethod`** : `AI` ou `FIXTURE`. Une fixture est toujours étiquetée « Demo documents · pre-built extraction ».
- **Anomalies** : `RATE_MISMATCH` (vérifiée, réclamable) et `DUPLICATE_BILLING` (à vérifier, non réclamable : `POST …/claim` répond `409 CLAIM_NOT_ALLOWED`).
- **Réclamation** : `text` (à copier), `downloadUrl` (téléchargement), `generatedBy` (`AI` | `TEMPLATE`), `requiresHumanApproval: true`.
- **Dashboard** : `simulatedPortfolio` (fictif, étiqueté) et `live` (réel).

| Écran | Endpoints |
|---|---|
| Dashboard | `GET /api/dashboard`, `GET /health` (pied de page) |
| New audit | `POST /api/documents/upload` (champs `invoice` + `contract`), `GET /api/documents?demo=true`, `POST /api/analyses` |
| Analyse | `GET /api/analyses/:id` |
| Résultats | `GET /api/analyses/:id` |
| Investigation | `GET /api/discrepancies/:id` |
| Réclamation | `POST /api/discrepancies/:id/claim` (`{ regenerate: true }` pour régénérer), `GET /api/claims/:id/download` |

Documents de démo du backend (IDs fixes, `extractionMode: "FIXTURE"` uniquement) :
`00000000-0000-4000-8000-000000000001` (facture FR-2026-0842, 42 500 €) et `…0002` (contrat AOL-SVC-2026-017, clause 4.2.1 : 24 000 €).

CORS : le backend autorise `localhost` par défaut. Le mode IA en direct exige `ANTHROPIC_API_KEY` **côté serveur** ; sans elle, seuls les documents de démo sont analysables (le front le détecte via `/health` et le dit).
