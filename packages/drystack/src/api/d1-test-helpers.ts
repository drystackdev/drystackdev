import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { D1DatabaseLike, D1PreparedStatementLike } from './d1';

// Real embedded SQLite (bun:sqlite, ships with the bun runtime these tests
// already run under) wearing the D1DatabaseLike interface, seeded with the
// actual migrations/0001_init.sql schema. Running the real SQL strings d1.ts
// issues against real SQLite catches genuine bugs (bad column names, broken
// JOINs, UNIQUE violations) that a hand-rolled query-matching fake would
// miss - only the wrapper shape below is test-only, the schema and queries
// are the real ones.
export function makeTestD1(): D1DatabaseLike {
  const db = new Database(':memory:');
  const migration = readFileSync(
    join(__dirname, '../../../../migrations/0001_init.sql'),
    'utf8'
  );
  for (const statement of migration
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)) {
    db.run(statement);
  }
  return {
    prepare(query: string): D1PreparedStatementLike {
      let boundArgs: unknown[] = [];
      const wrapper: D1PreparedStatementLike = {
        bind(...values: unknown[]) {
          boundArgs = values;
          return wrapper;
        },
        async run() {
          const result = db.query(query).run(...(boundArgs as never[]));
          return {
            success: true,
            meta: {
              last_row_id: Number(result.lastInsertRowid),
              changes: result.changes,
            },
          };
        },
        async all<T>() {
          const results = db.query(query).all(...(boundArgs as never[])) as T[];
          return { results, success: true };
        },
        async first<T>() {
          const row = db.query(query).get(...(boundArgs as never[])) as T | null;
          return row ?? null;
        },
      };
      return wrapper;
    },
  };
}
