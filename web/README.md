# refand — Get back what's yours

Front-end de **refand** (logo : ref&) : audit de factures de fret maritime et récupération des surfacturations.
React 18 · TypeScript · Vite · CSS pur (tokens). Aucune dépendance UI.

## Lancer avec le vrai backend

Le backend est le dépôt `A-Kamil/Refand-` (branche `dev1/api` : API Fastify + PostgreSQL + moteur d'audit).

```bash
# 1. Backend (dans son propre dossier)
podman run -d --name refand-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=freightrecover \
  -p 55432:5432 docker.io/library/postgres:17          # ou: docker compose up db
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/freightrecover npm run dev   # http://localhost:8080
# Optionnel : ANTHROPIC_API_KEY=… (côté serveur) pour l'extraction IA en direct de VOS documents

# 2. Front
npm install
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:8080
npm run dev                 # http://localhost:5173
```

Sans `ANTHROPIC_API_KEY`, le bouton **Try with demo documents** lance une vraie analyse sur les documents de démo du backend (extraction pré-construite, étiquetée comme telle). Le pied de page affiche l'état réel du backend (base de données, IA).

## Parcours
Dashboard (hero + widget « How it works » à défilement horizontal) → New audit → Analyse (3 étapes pilotées par le backend) → Résultats → Investigation → Réclamation (copie / téléchargement, brouillon à valider).

| Route | Page |
|---|---|
| `/` | Dashboard : portefeuille **simulé** + audits **réels** |
| `/audit/new` | Dépôt facture + contrat, ou documents de démo |
| `/analyses/:id` · `/analyses/:id/results` | Progression · anomalies détectées |
| `/discrepancies/:id` · `…/claim` | Investigation · brouillon de réclamation |

## Documentation
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — identité, nommage (refand / ref&), règles
- [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md) — widget « How it works » : contenu, spec, code
- [`docs/API.md`](docs/API.md) — usage du contrat backend

## Structure
```
src/api/         types (contrat backend), client HTTP
src/components/  Layout, Sky (fond), ui, Pen, Stepper, FileSlot
src/pages/       une page par étape
src/styles/      tokens.css (source de vérité) · base · components · pages · sky
public/brand/    logos recadrés depuis logo1.png / logo2.png
```
