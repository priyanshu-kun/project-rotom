import { Worker } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { createQueueConnection, GENERATION_QUEUE_NAME } from "./queue.js";
import {
  processGenerationJob,
  type GenerationJobData,
  type GenerationJobResult,
} from "./generation.service.js";

/**
 * Start the in-process BullMQ worker that runs generation jobs. Single-user
 * deployment runs it alongside the API; it can be split into its own process
 * later without code changes (same queue name + connection).
 */
export function startGenerationWorker(): Worker<GenerationJobData, GenerationJobResult> {
  const worker = new Worker<GenerationJobData, GenerationJobResult>(
    GENERATION_QUEUE_NAME,
    (job) => processGenerationJob(job.data),
    {
      connection: createQueueConnection(),
      prefix: env.QUEUE_PREFIX,
      concurrency: env.GENERATION_CONCURRENCY,
    },
  );

  worker.on("completed", (job, result) => {
    logger.info(
      { jobId: job.id, applicationId: result.applicationId, partial: result.partial },
      "Generation job completed",
    );
  });
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Generation job failed");
  });
  worker.on("error", (err) => {
    logger.error({ err }, "Generation worker error");
  });

  return worker;
}
