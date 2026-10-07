import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DB_PATH, openSqlite } from '../src/db/index';

const sqlite = openSqlite();
migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });

const tables = sqlite
  .prepare(
    "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
  )
  .all() as { name: string }[];

console.log(`migrated ${DB_PATH}`);
console.log(`${tables.length} tables: ${tables.map((t) => t.name).join(', ')}`);
sqlite.close();
