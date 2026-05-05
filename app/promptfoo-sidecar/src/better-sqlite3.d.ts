declare module "better-sqlite3" {
  type StatementResult = Record<string, unknown>;

  class Statement {
    all(...params: unknown[]): StatementResult[];
    get(...params: unknown[]): StatementResult | undefined;
  }

  class Database {
    constructor(path: string, options?: { readonly?: boolean });
    pragma(value: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }

  export default Database;
}
