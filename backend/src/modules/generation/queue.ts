import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import type { GenerationJobData, GenerationJobResult } from "./generation.service.js";

export const GENERATION_QUEUE_NAME = "generation";

/**
 * BullMQ requires a connection with `maxRetriesPerRequest: null` — distinct from
 * the Phase 0 app Redis client (which uses a finite retry count). Each call
 * creates an independent connection (BullMQ recommends separate connections for
 * the Queue and the Worker).
 */
export function createQueueConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const connection = createQueueConnection();

export const generationQueue = new Queue<GenerationJobData, GenerationJobResult>(
  GENERATION_QUEUE_NAME,
  { connection, prefix: env.QUEUE_PREFIX },
);

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 1, // generation is expensive; surface failures rather than silently retry
  removeOnComplete: { age: 3600 }, // keep results ~1h for polling; PG is the durable source
  removeOnFail: { age: 86_400 },
};

export async function enqueueGeneration(data: GenerationJobData): Promise<string> {
  const job = await generationQueue.add("generate", data, DEFAULT_JOB_OPTIONS);
  return job.id!;
}

export interface JobStatus {
  id: string;
  state: string;
  result?: GenerationJobResult;
  failedReason?: string;
}

export async function getGenerationJob(jobId: string): Promise<JobStatus | null> {
  const job = await generationQueue.getJob(jobId);
  if (!job) {
    return null;
  }
  const state = await job.getState();
  return {
    id: jobId,
    state,
    ...(job.returnvalue ? { result: job.returnvalue } : {}),
    ...(job.failedReason ? { failedReason: job.failedReason } : {}),
  };
}

export async function closeQueue(): Promise<void> {
  await generationQueue.close();
  await connection.quit();
}
