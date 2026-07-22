// Minimal ambient declaration for the one `bun:sqlite` surface
// d1-test-helpers.ts uses. Written locally (same reasoning as R2BucketLike's
// "structural subset" comment in api-r2.ts) rather than pulling in the
// `bun-types` package, which would widen ambient globals repo-wide beyond
// this file's tsconfig's deliberate `"types": ["node"]` restriction.
declare module 'bun:sqlite' {
  export class Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get<T = unknown>(...params: unknown[]): T | null;
    all<T = unknown>(...params: unknown[]): T[];
  }

  export class Database {
    constructor(filename?: string);
    run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    query(sql: string): Statement;
    close(): void;
  }
}
