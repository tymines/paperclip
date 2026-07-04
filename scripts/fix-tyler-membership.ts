// ponytail: one-shot script run via tsx, uses server's own drizzle
import { db } from "../server/src/db.js";
import { authUsers, authAccounts } from "../packages/db/src/schema/index.js";
import { eq, ilike } from "drizzle-orm";

async function main() {
  // 1. All users for tyler's email
  const users = await db.select().from(authUsers).where(ilike(authUsers.email, "%tyler%"));
  console.log("=== authUsers ===");
  for (const u of users) {
    const accts = await db.select().from(authAccounts).where(eq(authAccounts.userId, u.id));
    console.log(`  id=${u.id.slice(0,8)} email=${u.email} name=${u.name} created=${u.createdAt} accounts=${accts.length}`);
  }

  // 2. Company members
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://paperclip@127.0.0.1:5432/paperclip" });
  const members = await pool.query("SELECT cm.user_id, cm.company_id, cm.role, au.email FROM company_members cm JOIN auth_users au ON au.id = cm.user_id WHERE au.email ILIKE '%tyler%'");
  console.log("\n=== company_members ===");
  for (const r of members.rows) console.log(`  user=${r.user_id.slice(0,8)} company=${r.company_id.slice(0,8)} role=${r.role} email=${r.email}`);
  await pool.end();
}
main().catch(console.error);
