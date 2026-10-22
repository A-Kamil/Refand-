# API utilisée par le front

Le front consomme le backend de ce dépôt (`api/`). **Le contrat de référence est le [API.md](../../API.md) racine** ; les types TypeScript correspondants sont dans [`src/api/types.ts`](../src/api/types.ts) et le client dans [`src/api/http.ts`](../src/api/http.ts).

## Quel écran appelle quoi

| Écran | Endpoints |
|---|---|
| Dashboard | `GET /api/dashboard` (partie `live`), `GET /health` (pied de page) |
| New audit | `GET /health`, `POST /api/documents/upload` (champs `invoice` + `contract`), `POST /api/analyses` (`extractionMode: "AI"`) |
| Analyse | `GET /api/analyses/:id` (sondage 1 s) |
| Résultats | `GET /api/analyses/:id` |
| Investigation | `GET /api/discrepancies/:id` |
| Réclamation | `POST /api/discrepancies/:id/claim` (`{ regenerate: true }` pour régénérer), `GET /api/claims/:id/download` |

## Points du contrat qui structurent l'interface

- **Montants en centimes entiers** : `1850000` = 18 500,00 €.
- **Erreurs** : `{ "error": { "code", "message" } }` ; le front affiche `message` et réagit à `code` (`AI_UNAVAILABLE`, `CLAIM_NOT_ALLOWED`…).
- **Analyse** : `PENDING → PROCESSING → COMPLETED | NEEDS_REVIEW | FAILED`. Les 3 étapes (`steps[]`) sont affichées telles quelles.
- **Anomalies** : `RATE_MISMATCH` (`VERIFIED`, réclamable) et `DUPLICATE_BILLING` (`NEEDS_REVIEW`, **non réclamable** : `POST …/claim` répond `409 CLAIM_NOT_ALLOWED`).
- **Totaux** : `verifiedRecoverableMinor` et `potentialDuplicateMinor` sont **toujours affichés séparément**.
- **Réclamation** : `text` (à copier), `downloadUrl` (téléchargement), `generatedBy` (`AI` | `TEMPLATE`), `requiresHumanApproval: true`.
- **`extractionMethod`** : `AI` ou `FIXTURE`. Une extraction `FIXTURE` est étiquetée comme telle.
- **Non utilisé** : `simulatedPortfolio` (portefeuille fictif du dashboard) n'est pas affiché.

## Configuration serveur

- **CORS** : `localhost` est autorisé par défaut (voir `CORS_ORIGINS` dans [DEPLOY.md](../../DEPLOY.md)).
- **IA** : l'analyse exige `ANTHROPIC_API_KEY` **côté serveur**. Sans elle, `/health` renvoie `ai.configured: false` ; le front le dit et désactive l'envoi.
