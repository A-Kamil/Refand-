import { describe, expect, it } from "vitest";
import { loadConfig } from "../api/config.js";
import { poolConfig } from "../api/db.js";

const AIVEN_URL = "postgres://avnadmin:secret@pg-demo.aivencloud.com:12345/defaultdb?sslmode=require";

describe("poolConfig", () => {
  it("keeps TLS but uses libpq semantics for an Aiven URI without CA", () => {
    const cfg = poolConfig(AIVEN_URL);
    const url = new URL(cfg.connectionString!);
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("uselibpqcompat")).toBe("true");
    expect(cfg.ssl).toBeUndefined();
  });

  it("verifies the server certificate when the project CA is provided", () => {
    const cfg = poolConfig(AIVEN_URL, "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----");
    expect(new URL(cfg.connectionString!).searchParams.has("sslmode")).toBe(false);
    expect(cfg.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("leaves plain local URLs untouched", () => {
    expect(poolConfig("postgres://u:p@localhost:5432/db").connectionString).toBe("postgres://u:p@localhost:5432/db");
  });
});

describe("loadConfig", () => {
  it("requires DATABASE_URL and merges default and extra CORS origins", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/u);
    const cfg = loadConfig({ DATABASE_URL: AIVEN_URL, CORS_ORIGINS: "https://a.example, https://b.example", DATABASE_CA_CERT: "A\\nB" });
    expect(cfg.corsOrigins).toContain("https://*.lovable.app");
    expect(cfg.corsOrigins).toContain("https://b.example");
    expect(cfg.databaseCaCert).toBe("A\nB");
    expect(cfg.port).toBe(8080);
  });
});
