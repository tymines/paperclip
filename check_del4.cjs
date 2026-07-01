const postgres = require("/Users/augi/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres");

// Try without password
const sql = postgres({
  host: "localhost",
  port: 54329,
  user: "paperclip",
  database: "paperclip",
  max: 1
});
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
