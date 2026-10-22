# refand — Get back what's yours

refand vérifie des factures de fret maritime contre le contrat du transporteur et aide à réclamer ce qui a été facturé au-dessus. L'IA extrait ; **les calculs et le rapprochement sont déterministes** ; **un humain valide chaque réclamation**.

## Contenu du dépôt

| Dossier | Quoi | Où lire |
|---|---|---|
| `src/` | **Moteur** : extraction, rapprochement contrat, audit, preuves, rédaction des réclamations | [INTEGRATION.md](INTEGRATION.md) |
| `api/` | **Serveur** Fastify + PostgreSQL (documents, analyses, anomalies, réclamations, dashboard) | [API.md](API.md) · [DEPLOY.md](DEPLOY.md) |
| `web/` | **Front** React + TypeScript + Vite | [web/README.md](web/README.md) |

## Démarrer en 3 commandes

```bash
# 1. Base de données (podman ou docker)
podman run -d --name refand-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=freightrecover \
  -p 55432:5432 docker.io/library/postgres:17

# 2. API → http://localhost:8080
npm install
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/freightrecover \
ANTHROPIC_API_KEY=sk-ant-… \
  npm run dev

# 3. Front → http://localhost:5173
cd web && npm install && cp .env.example .env && npm run dev
```

`ANTHROPIC_API_KEY` reste **côté serveur** (jamais dans le front). Sans elle, le serveur démarre mais ne peut pas analyser de documents : l'écran *New audit* l'indique et désactive l'envoi.

## Le parcours utilisateur

1. **Dashboard** : chiffres réels des audits (état vide tant qu'aucun audit n'a été lancé).
2. **New audit** : dépôt d'une facture (PDF/CSV/TXT) et du contrat (PDF/TXT).
3. **Analyse** : 3 étapes pilotées par le serveur (extraction → rapprochement tarifaire → détection).
4. **Résultats** : anomalies, avec le récupérable **vérifié** séparé des doublons **à vérifier**.
5. **Investigation** : facture et contrat côte à côte, critères de rapprochement, calcul exact, extraits « verbatim · verified ».
6. **Réclamation** : brouillon à relire (copie, téléchargement), toujours marqué *DRAFT — human approval required*.

## Tests

```bash
npm test                                   # moteur
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/freightrecover npm test   # + API sur vraie base
```

## État des branches (à lire avant de fusionner)

| Branche | Contenu |
|---|---|
| `integration/web-api` | **Cette branche** : API (`dev1/api`) + front (`web/`). Typecheck et tests verts. |
| `dev1/api` | API + moteur |
| `main` / `dev2/engine` | Moteur avec détection de **doublons vérifiés** (`DUPLICATE_CHARGE`) |

> **`main` n'est pas fusionné ici, volontairement.** Le moteur de `main` produit des doublons *vérifiés* (`DUPLICATE_CHARGE`, `status: "VERIFIED"`), alors que l'API persiste des doublons *à vérifier et non réclamables* (`DUPLICATE_BILLING`). Les fusionner donne 6 erreurs de typage (`api/repository.ts`, `api/routes.ts`) et, surtout, une décision à prendre : **un doublon vérifié est-il réclamable, et sous quel type est-il stocké ?** C'est une règle métier qui touche à de l'argent : elle revient à l'auteur du moteur et à celui de l'API. Le front suppose pour l'instant qu'un doublon est à vérifier et non réclamable.
