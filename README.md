# refand — ocean freight audit & recovery

Monorepo : le moteur et l'API (racine) et le front (`web/`).

| Dossier | Contenu | Doc |
|---|---|---|
| `src/` | Moteur : extraction, contrat, audit, preuves, réclamations | [INTEGRATION.md](INTEGRATION.md) |
| `api/` | Serveur Fastify + PostgreSQL | [API.md](API.md) · [DEPLOY.md](DEPLOY.md) |
| `web/` | Front React / TypeScript / Vite | [web/README.md](web/README.md) · [web/docs/](web/docs/) |

## Lancer l'ensemble en local

```bash
# 1. Base de données (podman ou docker)
podman run -d --name refand-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=freightrecover \
  -p 55432:5432 docker.io/library/postgres:17

# 2. API  → http://localhost:8080  (sans ANTHROPIC_API_KEY : documents de démo uniquement)
npm install
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/freightrecover npm run dev

# 3. Front → http://localhost:5173
cd web && npm install && cp .env.example .env && npm run dev
```

Tests : `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/freightrecover npm test`

## État des branches

- `dev1/api` : API + moteur (base de cette branche).
- `main` / `dev2/engine` : moteur avec la détection de **doublons vérifiés** (`DUPLICATE_CHARGE`).
- **Pas encore fusionnés** : `main` introduit des types de doublons que `api/` ne gère pas (6 erreurs de typage dans `api/repository.ts` et `api/routes.ts`). La question à trancher avant de fusionner : un doublon vérifié du moteur est-il persisté comme `DUPLICATE_BILLING`, et est-il réclamable ? Le front suppose pour l'instant qu'un doublon est **à vérifier et non réclamable**.
