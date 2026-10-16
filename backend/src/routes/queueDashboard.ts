// Copyright (c) 2026 RemitMortgage Protocol Contributors
// SPDX-License-Identifier: MIT

/**
 * Admin-only background job queue dashboard (issue #853). Mounted at
 * /api/admin/queues with authMiddleware at the mount point (index.ts) and
 * requireAdmin per route, matching every other admin route in this backend.
 *
 * `@bull-board/express` is not a dependency of this project and none was
 * added for this (no new dependency was installed) — this is a small JSON
 * API over the existing BullMQ queues (services/queueMonitoring.ts) plus a
 * self-contained HTML page that calls it, in place of mounting Bull Board.
 *
 * Routes:
 *   GET    /api/admin/queues            — waiting/active/delayed/failed/completed/paused counts per queue
 *   GET    /api/admin/queues/dashboard  — HTML dashboard (same auth as every other route here)
 *   GET    /api/admin/queues/:name/failed            — failed jobs for one queue
 *   POST   /api/admin/queues/:name/jobs/:jobId/retry — retry a failed job (audited)
 *   DELETE /api/admin/queues/:name/jobs/:jobId       — remove a failed job (audited)
 */

import { Router, Response } from "express";
import { requireAdmin, type AuthenticatedRequest } from "../middleware/auth.js";
import logger from "../utils/logger.js";
import {
  getAllQueueSummaries,
  listFailedJobs,
  retryFailedJob,
  removeFailedJob,
  QueueActionError,
} from "../services/queueMonitoring.js";

export const queueDashboardRouter = Router();

queueDashboardRouter.get("/", requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    return res.json({ queues: await getAllQueueSummaries() });
  } catch (error) {
    logger.error("Queue summary error", { error });
    return res.status(500).json({ error: "failed_to_load_queue_summary" });
  }
});

queueDashboardRouter.get("/:name/failed", requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const jobs = await listFailedJobs(String(req.params.name));
    if (jobs === null) {
      return res.status(404).json({ error: "queue_not_found", message: `Unknown queue: ${req.params.name}` });
    }
    return res.json({ jobs });
  } catch (error) {
    logger.error("Queue failed-jobs list error", { error });
    return res.status(500).json({ error: "failed_to_list_failed_jobs" });
  }
});

queueDashboardRouter.post(
  "/:name/jobs/:jobId/retry",
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await retryFailedJob(String(req.params.name), String(req.params.jobId), req.user?.walletAddress);
      return res.status(204).end();
    } catch (error) {
      if (error instanceof QueueActionError) {
        const status = error.code === "queue_not_found" || error.code === "job_not_found" ? 404 : 400;
        return res.status(status).json({ error: error.code, message: error.message });
      }
      logger.error("Queue job retry error", { error });
      return res.status(500).json({ error: "failed_to_retry_job" });
    }
  }
);

queueDashboardRouter.delete(
  "/:name/jobs/:jobId",
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      await removeFailedJob(String(req.params.name), String(req.params.jobId), req.user?.walletAddress);
      return res.status(204).end();
    } catch (error) {
      if (error instanceof QueueActionError) {
        const status = error.code === "queue_not_found" || error.code === "job_not_found" ? 404 : 400;
        return res.status(status).json({ error: error.code, message: error.message });
      }
      logger.error("Queue job remove error", { error });
      return res.status(500).json({ error: "failed_to_remove_job" });
    }
  }
);

queueDashboardRouter.get("/dashboard", requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Queue Dashboard</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0b1020; color: #e2e8f0; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #1e293b; font-size: 13px; }
  th { color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; }
  .counts td { font-family: monospace; }
  .failed { color: #f87171; }
  .section { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
  button { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; margin-right: 6px; }
  button:hover { background: #334155; }
  button.danger:hover { background: #7f1d1d; }
  #status { color: #94a3b8; font-size: 12px; margin-bottom: 12px; }
</style>
</head>
<body>
<h1>Background Job Queues</h1>
<div id="status">Loading…</div>
<div id="summary" class="section"></div>
<div id="failedJobs"></div>

<script>
async function api(path, options) {
  const res = await fetch(path, Object.assign({ credentials: "include" }, options || {}));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || res.statusText);
  return res.status === 204 ? null : res.json();
}

async function loadSummary() {
  const data = await api("/api/admin/queues");
  const rows = data.queues.map((q) => {
    const c = q.counts;
    return "<tr class=counts><td>" + q.name + "</td><td>" + c.waiting + "</td><td>" + c.active +
      "</td><td>" + c.delayed + "</td><td class=failed>" + c.failed + "</td><td>" + c.completed +
      "</td><td>" + c.paused + "</td></tr>";
  }).join("");
  document.getElementById("summary").innerHTML =
    "<table><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Delayed</th><th>Failed</th><th>Completed</th><th>Paused</th></tr>" +
    rows + "</table>";
  return data.queues;
}

async function loadFailedJobs(queues) {
  const sections = await Promise.all(queues.map(async (q) => {
    if (q.counts.failed === 0) return "";
    const { jobs } = await api("/api/admin/queues/" + q.name + "/failed");
    const rows = jobs.map((j) =>
      "<tr><td>" + j.id + "</td><td>" + j.name + "</td><td>" + j.attemptsMade + "</td><td>" +
      (j.failedReason || "").slice(0, 120) + "</td><td>" +
      "<button data-retry='" + q.name + "|" + j.id + "'>Retry</button>" +
      "<button class=danger data-remove='" + q.name + "|" + j.id + "'>Remove</button>" +
      "</td></tr>"
    ).join("");
    return "<div class=section><h2>" + q.name + " — failed jobs</h2><table>" +
      "<tr><th>ID</th><th>Name</th><th>Attempts</th><th>Reason</th><th></th></tr>" + rows + "</table></div>";
  }));
  document.getElementById("failedJobs").innerHTML = sections.join("");

  document.querySelectorAll("[data-retry]").forEach((btn) => btn.addEventListener("click", async () => {
    const [queue, jobId] = btn.getAttribute("data-retry").split("|");
    await api("/api/admin/queues/" + queue + "/jobs/" + jobId + "/retry", { method: "POST" });
    refresh();
  }));
  document.querySelectorAll("[data-remove]").forEach((btn) => btn.addEventListener("click", async () => {
    const [queue, jobId] = btn.getAttribute("data-remove").split("|");
    await api("/api/admin/queues/" + queue + "/jobs/" + jobId, { method: "DELETE" });
    refresh();
  }));
}

async function refresh() {
  try {
    document.getElementById("status").textContent = "Refreshing…";
    const queues = await loadSummary();
    await loadFailedJobs(queues);
    document.getElementById("status").textContent = "Last updated " + new Date().toLocaleTimeString();
  } catch (err) {
    document.getElementById("status").textContent = "Failed to load: " + err.message;
  }
}

refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>`;
