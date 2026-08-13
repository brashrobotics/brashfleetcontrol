import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseConfig } from "@brash/config";
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export class PostgresDatabase {
  private readonly pool: Pool;
  private readonly transactionClient = new AsyncLocalStorage<PoolClient>();
  readonly schema: string;

  constructor(config: DatabaseConfig) {
    this.schema = config.schema;
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections,
      idleTimeoutMillis: config.idleTimeoutMs,
      statement_timeout: config.statementTimeoutMs,
      ssl: config.ssl || undefined,
      options: `-c search_path=${config.schema},public`,
    });
  }

  async ensureSchema(): Promise<void> {
    await this.withDedicatedClient(async (client) => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(`SET search_path TO "${this.schema}", public`);
    });
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    const executor = this.transactionClient.getStore() ?? this.pool;
    return executor.query<Row>(text, [...values]);
  }

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    if (this.transactionClient.getStore()) return operation();

    return this.withDedicatedClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await this.transactionClient.run(client, operation);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async withDedicatedClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await operation(client);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
