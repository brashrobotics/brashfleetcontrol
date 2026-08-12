import type { TransactionManager } from "@brash/application";
import type { PostgresDatabase } from "./postgres-database.js";

export class PostgresTransactionManager implements TransactionManager {
  constructor(private readonly database: PostgresDatabase) {}

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.database.transaction(operation);
  }
}
