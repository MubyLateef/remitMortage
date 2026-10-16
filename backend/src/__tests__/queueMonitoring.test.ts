// Copyright (c) 2026 RemitMortgage Protocol Contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the background-job queue monitoring API (issue #853).
 *
 * Acceptance criteria under test (at the route level, via the HTTP layer):
 * 1. Admins can inspect queues and retry failed jobs from the dashboard.
 * 2. Non-admin users receive a 403 and manual actions appear in the audit log.
 */

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const queueMocksByBullName = new Map<string, any>();

function makeQueueMock(name: string) {
  const instance = {
    name,
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
    }),
    getJobs: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(null),
    getFailedCount: jest.fn().mockResolvedValue(0),
    waitUntilReady: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    add: jest.fn(),
  };
  queueMocksByBullName.set(name, instance);
  return instance;
}

jest.mock("bullmq", () => ({
  Queue: jest.fn((name: string) => makeQueueMock(name)),
  Worker: jest.fn(() => ({
    on: jest.fn().mockReturnThis(),
    waitUntilReady: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../services/redisCluster.js", () => ({
  getClusterClient: jest.fn(() => null),
  isClusterMode: jest.fn(() => false),
  getClusterStatus: jest.fn(() => ({ mode: "single", connected: true, nodeCount: 1 })),
  initializeRedisCluster: jest.fn(),
  closeCluster: jest.fn(),
}));

const logAuditMock = jest.fn();
jest.mock("../services/audit.js", () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

jest.mock("../utils/logger.js", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../config.js", () => ({
  loadConfig: () => ({ adminApiKey: "test-admin-key" }),
}));

import { queueDashboardRouter } from "../routes/queueDashboard.js";

const ADMIN_WALLET = "GADMIN00000000000000000000000000000000000000000000000";
const NON_ADMIN_WALLET = "GNOTADMIN0000000000000000000000000000000000000000000";
const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret";

function tokenFor(address: string): string {
  return jwt.sign({ walletAddress: address, network: "stellar" }, JWT_SECRET);
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/queues", queueDashboardRouter);
  return app;
}

let app: express.Express;
let notifications: any;
let webhooks: any;

beforeEach(() => {
  process.env.ADMIN_WALLET_ADDRESS = ADMIN_WALLET;
  queueMocksByBullName.clear();
  jest.clearAllMocks();
  app = buildApp();
  notifications = queueMocksByBullName.get("remitmortgage-notifications");
  webhooks = queueMocksByBullName.get("remitmortgage-webhooks");
});

afterEach(() => {
  delete process.env.ADMIN_WALLET_ADDRESS;
});

describe("GET /api/admin/queues (acceptance criterion 1: inspect queues)", () => {
  it("denies a non-admin with 403", async () => {
    const res = await request(app)
      .get("/api/admin/queues")
      .set("Authorization", `Bearer ${tokenFor(NON_ADMIN_WALLET)}`);
    expect(res.status).toBe(403);
  });

  it("denies an unauthenticated caller", async () => {
    const res = await request(app).get("/api/admin/queues");
    expect(res.status).toBe(401);
  });

  it("returns waiting/active/delayed/failed/completed/paused counts per queue for an admin", async () => {
    notifications.getJobCounts.mockResolvedValue({
      waiting: 3,
      active: 1,
      delayed: 0,
      failed: 2,
      completed: 50,
      paused: 0,
    });

    const res = await request(app)
      .get("/api/admin/queues")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);

    expect(res.status).toBe(200);
    const names = res.body.queues.map((q: any) => q.name);
    expect(names.sort()).toEqual(["analytics", "emails", "notifications", "webhooks"]);
    const notif = res.body.queues.find((q: any) => q.name === "notifications");
    expect(notif.counts).toEqual({ waiting: 3, active: 1, delayed: 0, failed: 2, completed: 50, paused: 0 });
  });
});

describe("GET /api/admin/queues/:name/failed", () => {
  it("denies a non-admin with 403", async () => {
    const res = await request(app)
      .get("/api/admin/queues/webhooks/failed")
      .set("Authorization", `Bearer ${tokenFor(NON_ADMIN_WALLET)}`);
    expect(res.status).toBe(403);
  });

  it("404s for an unknown queue name", async () => {
    const res = await request(app)
      .get("/api/admin/queues/not-a-real-queue/failed")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("queue_not_found");
  });

  it("lists failed jobs for a known queue", async () => {
    webhooks.getJobs.mockResolvedValue([
      { id: "job-1", name: "deliver-webhook", failedReason: "ECONNREFUSED", attemptsMade: 5, timestamp: 123, data: { x: 1 } },
    ]);

    const res = await request(app)
      .get("/api/admin/queues/webhooks/failed")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);

    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual([
      { id: "job-1", name: "deliver-webhook", failedReason: "ECONNREFUSED", attemptsMade: 5, timestamp: 123, data: { x: 1 } },
    ]);
  });
});

describe("POST /api/admin/queues/:name/jobs/:jobId/retry (acceptance criterion 1 & 2: retry + audit)", () => {
  it("denies a non-admin with 403 and never touches the job", async () => {
    const res = await request(app)
      .post("/api/admin/queues/webhooks/jobs/job-1/retry")
      .set("Authorization", `Bearer ${tokenFor(NON_ADMIN_WALLET)}`);
    expect(res.status).toBe(403);
    expect(webhooks.getJob).not.toHaveBeenCalled();
  });

  it("retries a failed job and records the action in the audit log", async () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    webhooks.getJob.mockResolvedValue({ id: "job-1", name: "deliver-webhook", retry });

    const res = await request(app)
      .post("/api/admin/queues/webhooks/jobs/job-1/retry")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);

    expect(res.status).toBe(204);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "QUEUE_JOB_RETRIED",
        actorAddress: ADMIN_WALLET,
        metadata: expect.objectContaining({ queue: "webhooks", jobId: "job-1" }),
      })
    );
  });

  it("404s when the job does not exist in that queue", async () => {
    webhooks.getJob.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/admin/queues/webhooks/jobs/missing-job/retry")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("job_not_found");
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("404s for an unknown queue name without ever calling getJob", async () => {
    const res = await request(app)
      .post("/api/admin/queues/not-a-real-queue/jobs/job-1/retry")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("queue_not_found");
  });
});

describe("DELETE /api/admin/queues/:name/jobs/:jobId (acceptance criterion 1 & 2: remove + audit)", () => {
  it("denies a non-admin with 403", async () => {
    const res = await request(app)
      .delete("/api/admin/queues/webhooks/jobs/job-1")
      .set("Authorization", `Bearer ${tokenFor(NON_ADMIN_WALLET)}`);
    expect(res.status).toBe(403);
  });

  it("removes a failed job and records the action in the audit log", async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    webhooks.getJob.mockResolvedValue({ id: "job-1", name: "deliver-webhook", remove });

    const res = await request(app)
      .delete("/api/admin/queues/webhooks/jobs/job-1")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);

    expect(res.status).toBe(204);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "QUEUE_JOB_REMOVED", actorAddress: ADMIN_WALLET })
    );
  });
});

describe("GET /api/admin/queues/dashboard", () => {
  it("denies a non-admin with 403", async () => {
    const res = await request(app)
      .get("/api/admin/queues/dashboard")
      .set("Authorization", `Bearer ${tokenFor(NON_ADMIN_WALLET)}`);
    expect(res.status).toBe(403);
  });

  it("serves an HTML page to an admin", async () => {
    const res = await request(app)
      .get("/api/admin/queues/dashboard")
      .set("Authorization", `Bearer ${tokenFor(ADMIN_WALLET)}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("<title>Queue Dashboard</title>");
  });
});
