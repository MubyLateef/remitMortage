// Copyright (c) 2026 RemitMortgage Protocol Contributors
// SPDX-License-Identifier: MIT

/**
 * Keeps BullMQ queue-depth metrics fresh for alerting (issue #853) even
 * when nobody is looking at the dashboard — the dashboard/API also refresh
 * them as a side effect of being viewed, but alerting needs them current
 * independent of that.
 */

import logger from "../utils/logger.js";
import { getAllQueueSummaries } from "../services/queueMonitoring.js";

export async function runQueueMetricsRefreshJob(): Promise<void> {
  try {
    await getAllQueueSummaries();
  } catch (error) {
    logger.error("[queue-monitoring] Failed to refresh queue metrics", { error });
  }
}
