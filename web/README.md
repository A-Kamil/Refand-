# refand — front

React 18 · TypeScript · Vite · CSS pur (tokens). Aucune dépendance UI.
Le front ne parle qu'au backend : **aucune donnée d'exemple n'est embarquée**.

## Lancer

```bash
npm install
cp .env.example .env     # VITE_API_BASE_URL=http://localhost:8080
npm run dev              # http://localhost:5173
npm run build            # typecheck + build de production
```

Le backend doit tourner (voir le [README racine](../README.md)). Le pied de page affiche son état réel : base de données, IA.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `VITE_API_BASE_URL` | URL du backend. **Public** (tout `VITE_*` l'est) : ne jamais y mettre de secret. |

## Pages

| Route | Page |
|---|---|
| `/` | Dashboard : hero, widget « How it works » à défilement horizontal, vos audits (chiffres réels) |
| `/audit/new` | Dépôt facture + contrat |
| `/analyses/:id` | Progression en 3 étapes (sondage 1 s) |
| `/analyses/:id/results` | Anomalies détectées |
| `/discrepancies/:id` | Investigation d'une anomalie |
| `/discrepancies/:id/claim` | Brouillon de réclamation |

## Structure

```
src/
  api/         types.ts (contrat backend) · http.ts (client) · index.ts
  components/  Layout · Sky (fond animé) · HowItWorks · ui · Pen · Stepper · FileSlot · DiscrepancyTable
  pages/       une page par route
  lib/         format (centimes → €) · calc (écart recalculé) · useAsync
  styles/      tokens.css (source de vérité) · base · components · pages · sky
public/brand/  logos
```

## Documentation

| Doc | Pour qui / pourquoi |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Comprendre comment le front consomme le backend, les états, les règles d'intégrité |
| [docs/API.md](docs/API.md) | Quels endpoints sont utilisés, par quel écran, et les points du contrat qui structurent l'UI |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Identité, nommage (refand / ref&), couleurs, typo, mouvement, composants |
| [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) | Le widget à défilement horizontal : contenu, spec, code |

## Conventions

- **Nom** : « refand » dans les textes, « ref& » dans le logo et les slogans.
- **Promesses** : jamais de remboursement garanti ; la validation humaine est toujours dite.
- **Données** : aucune donnée fictive dans l'interface ; un état vide invite à lancer un audit.
