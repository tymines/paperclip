const postgres = require("/Users/augi/paperclip/node_modules/postgres");
const sql = postgres("postgres://paperclip@localhost:5432/paperclip");
(async () => {
  try {
    const rows = await sql`SELECT id, status, agent, created_at, updated_at FROM jarvis_delegations ORDER BY created_at DESC LIMIT 5`;
    console.log(JSON.stringify(rows, null, 2));
  } catch(e) {
    console.error("Error:", e);
  }
  await sql.end();
  process.exit(0);
})();
