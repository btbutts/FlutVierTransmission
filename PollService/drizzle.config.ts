// PollService/drizzle.config.ts
// Configuration for drizzle-kit (schema generation / studio only).
// The runtime DB path comes from DATA_DIR passed to initDb() in src/db/index.ts —
// the url here is only used by drizzle-kit studio.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema:    './src/db/schema.ts',
  out:       './drizzle',
  dialect:   'sqlite',
  dbCredentials: { url: './data/pollservice.db' }
});
