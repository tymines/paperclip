import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { gateRoutes } from "../routes/gate.js";
import { rooms } from "@paperclipai/db";
import type { Db } from "@paperclipai/db";
import { randomUUID } from "node:crypto";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type TableRow = Record<string, unknown>;
type Tables = {
  rooms: TableRow[];
  pipeline_runs: TableRow[];
  run_stages: TableRow[];
};

function tableName(table: unknown): string {
  if (table && typeof table === "object") {
    const name = (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
    if (name) return name;
  }
  return (table as { name?: string }).name ?? "unknown";
}

function sqlToTextParams(q: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  let text = "";
  let nextIndex = 1;
  for (const chunk of q.queryChunks) {
    if (typeof chunk === "string" || typeof chunk === "number" || chunk === null || chunk === undefined) {
      text += `$${nextIndex++}`;
      params.push(chunk);
    } else if (chunk && typeof chunk === "object" && "value" in chunk && Array.isArray((chunk as { value: unknown[] }).value)) {
      text += (chunk as { value: string[] }).value.join("");
    } else {
      text += String(chunk);
    }
  }
  return { text, params };
}

function createFakeDb() {
  const committed: Tables = { rooms: [], pipeline_runs: [], run_stages: [] };
  let txState: Tables | null = null;

  function state(): Tables {
    return txState ?? committed;
  }

  let failNextStageInsert = false;

  function execute(q: { queryChunks: unknown[] }): TableRow[] {
    const { text, params } = sqlToTextParams(q);

    const insertMatch = text.match(/INSERT INTO\s+"?(\w+)"?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const table = insertMatch[1] as keyof Tables;
      const cols = insertMatch[2].split(",").map((s) => s.trim().replace(/"/g, ""));
      const placeholders = insertMatch[3].split(",").map((s) => s.trim());
      const row: TableRow = {};
      for (let i = 0; i < cols.length; i++) {
        const ph = placeholders[i];
        if (ph.startsWith("$")) {
          row[cols[i]] = params[Number(ph.slice(1)) - 1];
        } else if (ph.startsWith("'") && ph.endsWith("'")) {
          row[cols[i]] = ph.slice(1, -1);
        } else {
          row[cols[i]] = JSON.parse(ph);
        }
      }
      if (table === "run_stages" && failNextStageInsert) {
        failNextStageInsert = false;
        throw new Error("stage insert failed");
      }
      state()[table].push(row);
      return [];
    }

    const selectMatch = text.match(/SELECT\s+(.+?)\s+FROM\s+"?(\w+)"?(?:\s+WHERE\s+(.+))?/i);
    if (selectMatch) {
      const table = selectMatch[2] as keyof Tables;
      const where = selectMatch[3];
      let rows = state()[table] ?? [];
      if (where) {
        const conditions = where.split(/\s+AND\s+/i);
        for (const cond of conditions) {
          const cm = cond.match(/"?(\w+)"?\s*=\s*(\$\d+|'[^']*')/i);
          if (cm) {
            const col = cm[1];
            const val = cm[2].startsWith("$")
              ? params[Number(cm[2].slice(1)) - 1]
              : cm[2].slice(1, -1);
            rows = rows.filter((r) => r[col] === val);
          }
        }
      }
      return rows;
    }

    throw new Error(`Unsupported SQL in fake DB: ${text}`);
  }

  function insert(table: unknown) {
    const name = tableName(table);
    const columns = (table as Record<symbol, Record<string, { default?: unknown; name: string }>> | undefined)?.[
      Symbol.for("drizzle:Columns")
    ];
    return {
      values(values: Record<string, unknown>) {
        const row: TableRow = { ...values };
        if (!row.id) row.id = randomUUID();
        if (columns) {
          for (const [colName, col] of Object.entries(columns)) {
            if (row[colName] === undefined && col.default !== undefined) {
              row[colName] = col.default;
            }
          }
        }
        state()[name as keyof Tables].push(row);
        return {
          returning() {
            return Promise.resolve([row]);
          },
          onConflictDoNothing() {
            return this;
          },
          onConflictDoUpdate() {
            return this;
          },
        };
      },
    };
  }

  const executor = { execute, insert };

  async function transaction<T>(callback: (tx: typeof executor) => Promise<T>): Promise<T> {
    txState = deepClone(committed);
    try {
      const result = await callback(executor);
      Object.assign(committed, txState);
      return result;
    } finally {
      txState = null;
    }
  }

  return {
    ...executor,
    transaction,
    _committed: committed,
    _failNextStageInsert() {
      failNextStageInsert = true;
    },
  };
}

function actorMiddleware(companyId: string) {
  return (req: any, _res: any, next: any) => {
    req.actor = {
      type: "board",
      source: "local_implicit",
      userId: "user-1",
      userName: "Test User",
      companyId,
      companyIds: [companyId],
      isInstanceAdmin: true,
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
    };
    next();
  };
}

describe("gate pipeline room link", () => {
  it("POST /companies/:companyId/pipeline/start creates a room and links the run in one transaction", async () => {
    const db = createFakeDb();
    const app = express();
    app.use(express.json());
    const companyId = randomUUID();
    app.use("/api/companies/:companyId", actorMiddleware(companyId));
    app.use("/api", gateRoutes(db as unknown as Db));

    const res = await request(app).post(`/api/companies/${companyId}/pipeline/start`).send({ name: "Test Run" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ runId: expect.any(String), stageId: expect.any(String), stage: "idea", name: "Test Run" });
    expect(res.body.roomId).toBeTruthy();

    const run = db._committed.pipeline_runs[0];
    const stage = db._committed.run_stages[0];
    const room = db._committed.rooms[0];

    expect(room).toBeDefined();
    expect(room.companyId).toBe(companyId);
    expect(room.type).toBe("pipeline-idea");
    expect(room.name).toBe("Test Run — Idea");
    expect(room.createdBy).toBe("user-1");

    expect(run).toBeDefined();
    expect(run.company_id).toBe(companyId);
    expect(run.room_id).toBe(room.id);
    expect(run.name).toBe("Test Run");
    expect(run.status).toBe("active");

    expect(stage).toBeDefined();
    expect(stage.pipeline_run_id).toBe(run.id);
    expect(stage.name).toBe("idea");
    expect(stage.status).toBe("active");
    expect(stage.stage_order).toBe(0);
  });

  it("rolls back room, run and stage mutations when the stage insert fails", async () => {
    const db = createFakeDb();
    db._failNextStageInsert();

    const app = express();
    app.use(express.json());
    const companyId = randomUUID();
    app.use("/api/companies/:companyId", actorMiddleware(companyId));
    app.use("/api", gateRoutes(db as unknown as Db));

    const res = await request(app).post(`/api/companies/${companyId}/pipeline/start`).send({ name: "Failing Run" });

    expect(res.status).toBe(500);
    expect(db._committed.rooms).toHaveLength(0);
    expect(db._committed.pipeline_runs).toHaveLength(0);
    expect(db._committed.run_stages).toHaveLength(0);
  });

  it("GET /companies/:companyId/pipeline/runs/:runId returns room_id from the detail query", async () => {
    const db = createFakeDb();
    const companyId = randomUUID();
    const runId = randomUUID();
    const roomId = randomUUID();
    db._committed.pipeline_runs.push({
      id: runId,
      company_id: companyId,
      room_id: roomId,
      name: "Detail Run",
      status: "active",
      created_at: new Date().toISOString(),
    });

    const app = express();
    app.use(express.json());
    app.use("/api/companies/:companyId", actorMiddleware(companyId));
    app.use("/api", gateRoutes(db as unknown as Db));

    const res = await request(app).get(`/api/companies/${companyId}/pipeline/runs/${runId}`);

    expect(res.status).toBe(200);
    expect(res.body.run.room_id).toBe(roomId);
  });
});
