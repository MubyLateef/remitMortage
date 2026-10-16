// Copyright (c) 2026 RemitMortgage Protocol Contributors
// SPDX-License-Identifier: MIT

/**
 * Queue monitoring for background jobs (issue #853).
 *
 * `@bull-board/express`/`@bull-board/api` are not dependencies of this
 * project and none were added for this — everything here is built on
 * `bullmq` (already a dependency) and the existing `queueService.ts` queue
 * instances, exposed as a small JSON API plus a self-contained HTML
 * dashboard page (routes/queueDashboard.ts) rather than mounting Bull Board.
 */

import type { Queue } from "bullmq";
import { queueService } from "./queueService.js";
import { logAudit } from "./audit.js";
import { queueDepthGauge } from "./metrics.js";
import logger from "../utils/logger.js";

const QUEUES: Record<string, Queue<any>> = {
  notifications: queueService.notificationQueue,
  webhooks: queueService.webhookQueue,
  emails: queueService.emailQueue,
  analytics: queueService.analyticsQueue,
};

export function listQueueNames(): string[] {
  return Object.keys(QUEUES);
}

function getQueue(name: string): Queue<any> | null {
  return QUEUES[name] ?? null;
}

export type QueueJobState = "waiting" | "active" | "delayed" | "failed" | "completed" | "paused";
const TRACKED_STATES: QueueJobState[] = ["waiting", "active", "delayed", "failed", "completed", "paused"];

export interface QueueSummary {
  name: string;
  counts: Record<QueueJobState, number>;
}

/**
 * Current waiting/active/delayed/failed/completed/paused counts for every
 * known queue. Also refreshes the `remitmortgage_queue_depth{queue,state}`
 * gauge (failed-job count included via `state="failed"`) as a side effect,
 * so hitting this via the dashboard or the API always exports fresh
 * numbers — see also the scheduled refresh in jobs/queueMetricsRefresh.ts,
 * which keeps it fresh for alerting even when nobody is looking at the
 * dashboard.
 */
export async function getAllQueueSummaries(): Promise<QueueSummary[]> {
  const summaries = await Promise.all(
    Object.entries(QUEUES).map(async ([name, queue]) => {
      const counts = (await queue.getJobCounts(...TRACKED_STATES)) as Record<QueueJobState, number>;
      for (const state of TRACKED_STATES) {
        queueDepthGauge.set({ queue: name, state }, counts[state] ?? 0);
      }
      return { name, counts };
    })
  );
  return summaries;
}

export interface FailedJobSummary {
  id: string;
  name: string;
  failedReason: string | null;
  attemptsMade: number;
  timestamp: number;
  data: unknown;
}

export async function listFailedJobs(
  queueName: string,
  start = 0,
  end = 50
): Promise<FailedJobSummary[] | null> {
  const queue = getQueue(queueName);
  if (!queue) return null;

  const jobs = await queue.getJobs(["failed"], start, end);
  return jobs.map((job) => ({
    id: String(job.id),
    name: job.name,
    failedReason: job.failedReason ?? null,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    data: job.data,
  }));
}

export type QueueActionErrorCode = "queue_not_found" | "job_not_found";

export class QueueActionError extends Error {
  constructor(message: string, public readonly code: QueueActionErrorCode) {
    super(message);
  }
}

async function findJobOrThrow(queueName: string, jobId: string) {
  const queue = getQueue(queueName);
  if (!queue) {
    throw new QueueActionError(`Unknown queue: ${queueName}`, "queue_not_found");
  }
  const job = await queue.getJob(jobId);
  if (!job) {
    throw new QueueActionError(`Job ${jobId} not found in queue ${queueName}`, "job_not_found");
  }
  return job;
}

/** Retries a failed job. Every manual action is written to the audit trail. */
export async function retryFailedJob(
  queueName: string,
  jobId: string,
  actorAddress: string | undefined
): Promise<void> {
  const job = await findJobOrThrow(queueName, jobId);
  await job.retry();
  await logAudit({
    action: "QUEUE_JOB_RETRIED",
    actorAddress,
    metadata: { queue: queueName, jobId, jobName: job.name },
  });
  logger.info("[queue-monitoring] Job retried by admin", { queue: queueName, jobId, actorAddress });
}

/** Removes a failed job permanently. Every manual action is written to the audit trail. */
export async function removeFailedJob(
  queueName: string,
  jobId: string,
  actorAddress: string | undefined
): Promise<void> {
  const job = await findJobOrThrow(queueName, jobId);
  await job.remove();
  await logAudit({
    action: "QUEUE_JOB_REMOVED",
    actorAddress,
    metadata: { queue: queueName, jobId, jobName: job.name },
  });
  logger.info("[queue-monitoring] Job removed by admin", { queue: queueName, jobId, actorAddress });
}
