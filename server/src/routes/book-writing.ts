import type { Db } from "@paperclipai/db";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync, statSync, existsSync } from "fs";
import path from "path";

const AUTONOVEL_DIR = process.env.AUTONOVEL_DIR || "/Users/augi/paperclip-book-writer/autonovel";
const PIPELINES = new Map();

export function bookWritingRoutes(db: Db) {
  const router = Router();

  // Start a new book writing pipeline
  router.post("/companies/:companyId/book-writing/start", async (req, res) => {
    try {
      const { companyId } = req.params;
      const { concept, genre, length, voice } = req.body;
      
      if (!concept || concept.length < 10) {
        return res.status(400).json({ error: "Concept must be at least 10 characters" });
      }

      const pipelineId = randomUUID();
      
      // Write seed.txt
      const seedContent = `TITLE: Untitled ${genre} Novel\nGENRE: ${genre}\nLENGTH: ${length}\nVOICE: ${voice}\nCONCEPT: ${concept}`;
      
      writeFileSync(path.join(AUTONOVEL_DIR, "seed.txt"), seedContent);

      // Start pipeline in background
      const child = spawn("bash", ["-c", `cd '${AUTONOVEL_DIR}' && source .venv/bin/activate && python autonovel-gemini.py --from-seed 2>&1`], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      PIPELINES.set(pipelineId, {
        id: pipelineId,
        companyId,
        child,
        status: "running",
        phase: "seed",
        step: "initializing",
        progress: 0,
        startedAt: new Date().toISOString(),
      });

      // Start progress polling
      const pollInterval = setInterval(() => {
        try {
          const state = JSON.parse(readFileSync(path.join(AUTONOVEL_DIR, "state.json"), "utf-8"));
          const pipeline = PIPELINES.get(pipelineId);
          if (pipeline) {
            pipeline.phase = state.phase || pipeline.phase;
            pipeline.step = state.step || pipeline.step;
            pipeline.progress = state.iteration ? Math.min(state.iteration * 10, 90) : pipeline.progress;
          }
        } catch {}
      }, 5000);

      child.on("exit", (code) => {
        clearInterval(pollInterval);
        const pipeline = PIPELINES.get(pipelineId);
        if (pipeline) {
          pipeline.status = code === 0 ? "complete" : "failed";
          pipeline.phase = "export";
          pipeline.step = code === 0 ? "complete" : "failed";
          pipeline.progress = code === 0 ? 100 : 0;
        }
      });

      res.json({ pipelineId, status: "started" });
    } catch (error) {
      console.error("Book writing start error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Get pipeline status
  router.get("/companies/:companyId/book-writing/status/:pipelineId", (req, res) => {
    const pipeline = PIPELINES.get(req.params.pipelineId);
    if (!pipeline) {
      return res.json({ status: "not_found" });
    }
    
    try {
      const state = JSON.parse(readFileSync(path.join(AUTONOVEL_DIR, "state.json"), "utf-8"));
      return res.json({
        ...pipeline,
        phase: state.phase || pipeline.phase,
        iteration: state.iteration || 0,
      });
    } catch {
      return res.json(pipeline);
    }
  });

  // Get artifacts
  router.get("/companies/:companyId/book-writing/artifacts/:pipelineId", (req, res) => {
    const pipeline = PIPELINES.get(req.params.pipelineId);
    if (!pipeline || pipeline.status !== "complete") {
      return res.json({ files: [] });
    }

    const files = [];
    
    
    // Check for world.md, characters.md, outline.md
    for (const name of ["world.md", "characters.md", "outline.md", "seed.txt"]) {
      const p = path.join(AUTONOVEL_DIR, name);
      if (existsSync(p)) {
        files.push({
          name, label: name.replace(".md", ""), url: `/api/companies/${req.params.companyId}/book-writing/download/${name}`,
          size: `${statSync(p).size.toLocaleString()} bytes`
        });
      }
    }

    res.json({ files });
  });

  // Download artifact
  router.get("/companies/:companyId/book-writing/download/:filename", (req, res) => {
    const filepath = path.join(AUTONOVEL_DIR, req.params.filename);
    if (!existsSync(filepath)) {
      return res.status(404).json({ error: "File not found" });
    }
    res.download(filepath);
  });

  // Cancel pipeline
  router.post("/companies/:companyId/book-writing/cancel/:pipelineId", (req, res) => {
    const pipeline = PIPELINES.get(req.params.pipelineId);
    if (pipeline && pipeline.child) {
      pipeline.child.kill("SIGTERM");
      pipeline.status = "cancelled";
    }
    res.json({ status: "cancelled" });
  });

  return router;
}
