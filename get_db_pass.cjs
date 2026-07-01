const fs = require("fs");
const path = require("path");
const configDir = path.join(require("os").homedir(), ".paperclip");
const instancesDir = path.join(configDir, "instances");
if (fs.existsSync(instancesDir)) {
  const instances = fs.readdirSync(instancesDir);
  console.log("Instances:", instances);
  for (const inst of instances) {
    const instPath = path.join(instancesDir, inst);
    const files = fs.readdirSync(instPath);
    console.log(`  ${inst}:`, files);
    if (files.includes("env.json")) {
      const env = JSON.parse(fs.readFileSync(path.join(instPath, "env.json"), "utf8"));
      console.log(`  env.json (selected):`);
      if (env.DATABASE_URL) console.log("  DATABASE_URL:", env.DATABASE_URL);
      if (env.databaseUrl) console.log("  databaseUrl:", env.databaseUrl);
    }
    if (files.includes("config.json")) {
      const cfg = JSON.parse(fs.readFileSync(path.join(instPath, "config.json"), "utf8"));
      if (cfg.databaseUrl || cfg.DATABASE_URL) console.log("  config DB:", cfg.databaseUrl || cfg.DATABASE_URL);
    }
  }
}
// Also look at the running process env
console.log("\n=== Run psql to list databases ===");
