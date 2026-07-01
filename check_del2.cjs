const {Client} = require("/Users/augi/paperclip/node_modules/.pnpm/postgres@3.4.5/node_modules/postgres");
// Actually let me use the drizzle client instead  
const {drizzle} = require("/Users/augi/paperclip/node_modules/.pnpm/drizzle-orm@0.38.3_postgres@3.4.5/node_modules/drizzle-orm/postgres-js");
const postgres = require("/Users/augi/paperclip/node_modules/.pnpm/postgres@3.4.5/node_modules/postgres");
const sql = postgres("postgres://paperclip@localhost:54329/paperclip");
(async () => {
  try {
    const rows = await sql`SELECT id, status, agent, created_at, updated_at FROM jarvis_delegations ORDER BY created_at DESC LIMIT 10`;
    console.log(JSON.stringify(rows, null, 2));
  } catch(e) {
    console.error("Error:", e.message);
    console.error(e.stack);
  }
  await sql.end();
  process.exit(0);
})();
