# Architecture du front

## Vue d'ensemble

```
Navigateur (web/)                      Serveur (api/ + src/)                PostgreSQL
┌──────────────────────┐   HTTP/JSON   ┌────────────────────────┐          ┌───────────┐
│ pages → api/http.ts  │ ────────────▶ │ Fastify · routes.ts    │ ───────▶ │ documents │
│ (typé par types.ts)  │ ◀──────────── │ moteur : extraction IA │          │ analyses  │
└──────────────────────┘               │ + calculs déterministes│          │ anomalies │
                                       └────────────────────────┘          └───────────┘
```

Le front **ne fait aucun calcul métier** et aucun traitement IA. Il affiche ce que le backend renvoie, recalcule seulement `facturé − attendu` pour détecter une incohérence, et ne contient aucun secret.

## Flux d'une analyse

```
New audit ── POST /api/documents/upload (invoice + contract) ──▶ ids
          ── POST /api/analyses { extractionMode: "AI" }       ──▶ { id, status: PENDING }
Analyse   ── GET /api/analyses/:id  (toutes les secondes)      ──▶ PENDING → PROCESSING → COMPLETED | NEEDS_REVIEW | FAILED
Résultats ── GET /api/analyses/:id                              ──▶ discrepancies[], totals
Détail    ── GET /api/discrepancies/:id                         ──▶ preuves, critères, calcul
Claim     ── POST /api/discrepancies/:id/claim                  ──▶ brouillon (text, downloadUrl)
```

Au sondage : 4 erreurs réseau consécutives avant d'afficher une erreur (une coupure ponctuelle ne fait pas échouer l'analyse). Les étapes affichées sont **exactement** `steps[]` du backend.

## États de donnée

Chaque écran qui lit le backend gère les mêmes états :

| État | Rendu |
|---|---|
| chargement | `Loading` |
| erreur | `ErrorState` : message du backend, bouton *Retry* |
| vide | `EmptyState` : invite à lancer un audit |
| prêt | contenu |
| `NEEDS_REVIEW` | bandeau qui liste `audit.reviewItems`, `audit.warnings`, `extractionWarnings` |
| `FAILED` | message du backend + retour à l'envoi |

Cas particuliers :
- **Pas de clé IA** (`/health` → `ai.configured: false`) : *New audit* le dit et désactive l'envoi.
- **Backend injoignable** : message explicite, pied de page en alerte.
- **`AI_UNAVAILABLE`**, **`CLAIM_NOT_ALLOWED`**… : le code d'erreur du backend est lu et expliqué.

## Règles d'intégrité

| Règle | Où |
|---|---|
| Montants en **centimes entiers** ; formatage unique | `lib/format.ts` (`moneyMinor`) |
| Écart **recalculé** ; toute incohérence avec le backend est affichée | `lib/calc.ts` |
| **Récupérable vérifié** (`RATE_MISMATCH`) et **doublons à vérifier** (`DUPLICATE_BILLING`) **jamais additionnés** | `AuditResults`, `Dashboard` |
| Un doublon n'est **pas réclamable** (le backend répond `409`) | `Investigation` |
| Chaque extrait dit s'il est **verbatim · verified** | `Investigation`, `Claim` |
| Une extraction `FIXTURE` n'est jamais présentée comme IA en direct | `ExtractionBadge` |
| Réclamation **toujours** *DRAFT — human approval required* | `Claim` |
| Aucune donnée fictive dans l'interface | partout |

## Carte des fichiers

| Besoin | Fichier |
|---|---|
| Changer un endpoint ou un type | `src/api/types.ts`, `src/api/http.ts` |
| Changer la navigation / le pied de page | `src/components/Layout.tsx` |
| Changer le fond animé | `src/components/Sky.tsx`, `src/styles/sky.css` |
| Changer le widget horizontal | `src/components/HowItWorks.tsx` (+ [HOW_IT_WORKS.md](HOW_IT_WORKS.md)) |
| Changer une couleur, un espace, un rayon | `src/styles/tokens.css` uniquement |
| Changer un libellé du vocabulaire backend | `src/lib/calc.ts` (`TYPE_LABEL`), `src/components/Stepper.tsx` |

## Ajouter un écran

1. Typer la réponse dans `api/types.ts` et ajouter la méthode dans `ApiClient` et `http.ts`.
2. Charger avec `useAsync` ; gérer **chargement, erreur, vide, prêt**.
3. Poser le contenu dans des `Sheet` (pas de cartes) ; wording : « refand », pas de promesse de remboursement.
4. Documenter la route dans le README.
