import { request, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bootstraps a minimal demo instance after onboard --yes has booted it.
// Creates extra entities (project, room, routine) so detail-page audits have data.
export default async function globalSetup(config: FullConfig) {
  const baseURL = (config.projects[0]?.use as any)?.baseURL ?? "http://127.0.0.1:3299";
  const ctx = await request.newContext({ baseURL });
  const out: Record<string, any> = {};

  // Wait for /api/health to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const h = await ctx.get("/api/health");
      if (h.ok()) break;
    } catch {}
    await new Promise((res) => setTimeout(res, 1000));
  }

  // If there's already a company (rare for fresh boot), use it; else create one.
  let companyId: string | null = null;
  let issuePrefix: string | null = null;
  try {
    const r = await ctx.get("/api/companies");
    if (r.ok()) {
      const list: any[] = await r.json();
      const existing = Array.isArray(list) ? list : (list as any).companies;
      if (Array.isArray(existing) && existing.length > 0) {
        companyId = existing[0].id;
        issuePrefix = existing[0].issuePrefix;
      }
    }
  } catch {}

  if (!companyId) {
    try {
      const r = await ctx.post("/api/companies", {
        data: { name: "AuditCo" },
      });
      if (r.ok()) {
        const j: any = await r.json();
        companyId = j.id;
        issuePrefix = j.issuePrefix;
        out.createCompanyResp = { id: j.id, issuePrefix: j.issuePrefix, status: r.status() };
      } else {
        out.createCompanyError = `${r.status()} ${(await r.text()).slice(0, 400)}`;
      }
    } catch (e: any) {
      out.createCompanyError = e?.message;
    }
  }

  out.companyId = companyId;
  out.issuePrefix = issuePrefix;
  out.companyPrefix = issuePrefix?.toLowerCase() ?? null;

  if (companyId) {
    // Try to seed a project.
    try {
      const r = await ctx.post(`/api/companies/${companyId}/projects`, {
        data: { name: "Audit Project", description: "Seeded by functional audit" },
      });
      if (r.ok()) {
        const j: any = await r.json();
        out.projectId = j.id || j.project?.id;
      } else {
        out.projectError = `${r.status()} ${(await r.text()).slice(0, 400)}`;
      }
    } catch (e: any) {
      out.projectError = e?.message;
    }

    // Try to seed a room.
    try {
      const r = await ctx.post(`/api/companies/${companyId}/rooms`, {
        data: { name: "Audit Room", description: "Seeded by functional audit" },
      });
      if (r.ok()) {
        const j: any = await r.json();
        out.roomId = j.id || j.room?.id;
      } else {
        out.roomError = `${r.status()} ${(await r.text()).slice(0, 400)}`;
      }
    } catch (e: any) {
      out.roomError = e?.message;
    }

    // Try to seed a goal.
    try {
      const r = await ctx.post(`/api/companies/${companyId}/goals`, {
        data: { title: "Audit Goal", description: "Seeded by functional audit" },
      });
      if (r.ok()) {
        const j: any = await r.json();
        out.goalId = j.id || j.goal?.id;
      } else {
        out.goalError = `${r.status()} ${(await r.text()).slice(0, 400)}`;
      }
    } catch (e: any) {
      out.goalError = e?.message;
    }

    // Try to seed an extra issue.
    try {
      const r = await ctx.post(`/api/companies/${companyId}/issues`, {
        data: { title: "Audit Issue", description: "Seeded by functional audit", status: "backlog" },
      });
      if (r.ok()) {
        const j: any = await r.json();
        out.issueId = j.id || j.shortKey || j.issue?.id;
      } else {
        out.issueError = `${r.status()} ${(await r.text()).slice(0, 400)}`;
      }
    } catch (e: any) {
      out.issueError = e?.message;
    }
  }

  fs.mkdirSync(path.resolve(__dirname, "results"), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, "results/context.json"), JSON.stringify(out, null, 2));
  await ctx.dispose();
}
