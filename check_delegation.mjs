import { db } from "./packages/db/dist/client.js";
try {
  const result = await db.query("SELECT id, status, agent, created_at FROM jarvis_delegations ORDER BY created_at DESC LIMIT 5");
  console.log(JSON.stringify(result.rows, null, 2));
} catch(e) {
  console.error("Error:", e.message);
}
