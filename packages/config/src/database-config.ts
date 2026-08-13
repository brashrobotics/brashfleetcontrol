export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
  startupTimeoutMs: number;
  ssl: boolean;
  schema: string;
}

export type PersistenceMode = "memory" | "postgres";

export interface PersistenceConfig {
  mode: PersistenceMode;
  database: DatabaseConfig | null;
}

export function loadPersistenceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PersistenceConfig {
  const mode = (environment.FLEET_PERSISTENCE
    ?? (environment.DATABASE_URL ? "postgres" : "memory")) as PersistenceMode;

  if (mode !== "memory" && mode !== "postgres") {
    throw new Error("FLEET_PERSISTENCE must be either 'memory' or 'postgres'.");
  }
  if (mode === "memory") return { mode, database: null };

  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when FLEET_PERSISTENCE=postgres.");
  }

  return {
    mode,
    database: {
      connectionString,
      maxConnections: positiveInteger(environment.DATABASE_POOL_MAX, 10, "DATABASE_POOL_MAX"),
      idleTimeoutMs: positiveInteger(environment.DATABASE_IDLE_TIMEOUT_MS, 30_000, "DATABASE_IDLE_TIMEOUT_MS"),
      statementTimeoutMs: positiveInteger(environment.DATABASE_STATEMENT_TIMEOUT_MS, 15_000, "DATABASE_STATEMENT_TIMEOUT_MS"),
      startupTimeoutMs: positiveInteger(environment.DATABASE_STARTUP_TIMEOUT_MS, 30_000, "DATABASE_STARTUP_TIMEOUT_MS"),
      ssl: environment.DATABASE_SSL === "true",
      schema: databaseSchema(environment.DATABASE_SCHEMA),
    },
  };
}

function databaseSchema(value: string | undefined): string {
  const schema = value?.trim() || "public";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("DATABASE_SCHEMA must be a lowercase PostgreSQL identifier.");
  return schema;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
