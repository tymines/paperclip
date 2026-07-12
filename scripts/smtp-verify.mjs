// One-shot SMTP diagnostic for Paperclip's login-code email.
// Reads server/.env SMTP_*, verifies the connection + auth against the provider,
// then sends a real test email to SMTP_FROM so you can confirm delivery.
//   Run on the box:  node scripts/smtp-verify.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "..", "server", ".env");

const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*(SMTP_[A-Z]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]\s*$/g, "").trim();
}

const port = parseInt(env.SMTP_PORT || "587", 10);
console.log(`config: host=${env.SMTP_HOST} port=${port} secure=${port === 465} user=${env.SMTP_USER} passLen=${(env.SMTP_PASS || "").length} from=${env.SMTP_FROM}`);

const t = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

try {
  await t.verify();
  console.log("VERIFY: OK — SMTP connection + auth succeeded.");
} catch (e) {
  console.log("VERIFY: FAILED —", e?.message || String(e));
  if (e?.response) console.log("SMTP response:", e.response);
  console.log(">>> If this is a 5xx 'Username and Password not accepted' auth error, the Gmail APP PASSWORD is wrong/revoked. Generate a NEW 16-char app password at https://myaccount.google.com/apppasswords (2-Step Verification must be on), then update SMTP_PASS in server/.env AND the repo-root .env, and restart.");
  process.exit(1);
}

try {
  const info = await t.sendMail({
    from: env.SMTP_FROM,
    to: env.SMTP_FROM,
    subject: "Paperclip SMTP test ✅",
    text: "If you received this, Paperclip's email sending works — login codes will arrive.",
    html: "<p>If you received this, Paperclip's email sending works — <strong>login codes will arrive.</strong></p>",
  });
  console.log("SEND: OK — test email sent. messageId:", info.messageId, "accepted:", JSON.stringify(info.accepted), "rejected:", JSON.stringify(info.rejected));
  console.log(">>> Check the inbox for", env.SMTP_FROM, "— if it's there, SMTP works and the login-code failure is just the running server not having SMTP loaded (restart from root with the SMTP vars).");
} catch (e) {
  console.log("SEND: FAILED —", e?.message || String(e));
  if (e?.response) console.log("SMTP response:", e.response);
  process.exit(2);
}
