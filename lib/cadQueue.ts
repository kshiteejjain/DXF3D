import { Queue } from "bullmq";
import type { CadConversionResult, CadJobSnapshot, JobState } from "./cad";

const queueName = "cad-conversion";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const redis = new URL(redisUrl);

declare global {
  var cadJobStore: Map<string, CadJobSnapshot> | undefined;
  var cadResultStore: Map<string, CadConversionResult> | undefined;
  var cadQueue: Queue | undefined;
}

export type CadQueuePayload = {
  fileName: string;
  fileSize: number;
  dxfText: string;
  extrusionDepth: number;
  densityKgM3: number;
  unitsOverride?: string;
};

export const cadJobStore = globalThis.cadJobStore ?? new Map<string, CadJobSnapshot>();
export const cadResultStore = globalThis.cadResultStore ?? new Map<string, CadConversionResult>();
globalThis.cadJobStore = cadJobStore;
globalThis.cadResultStore = cadResultStore;

export function getCadQueue() {
  if (!globalThis.cadQueue) {
    globalThis.cadQueue = new Queue<CadQueuePayload>(queueName, {
      connection: {
        host: redis.hostname,
        port: Number(redis.port || 6379),
        username: redis.username || undefined,
        password: redis.password || undefined
      },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 3600, count: 100 }
      }
    });
  }

  return globalThis.cadQueue;
}

export async function enqueueCadJob(payload: CadQueuePayload) {
  const job = await getCadQueue().add("convert", payload);
  const id = job.id?.toString() ?? crypto.randomUUID();
  cadJobStore.set(id, { id, state: "queued", progress: 0 });
  return id;
}

export function setCadJobState(id: string, state: JobState, progress: number, error?: string) {
  const current = cadJobStore.get(id) ?? { id, state, progress };
  cadJobStore.set(id, { ...current, state, progress, error });
}

export function setCadJobResult(id: string, result: CadConversionResult) {
  cadResultStore.set(id, result);
  cadJobStore.set(id, { id, state: "completed", progress: 100, result });
}

export async function readCadJob(id: string): Promise<CadJobSnapshot | null> {
  const inMemory = cadJobStore.get(id);
  if (inMemory) return inMemory;

  const job = await getCadQueue().getJob(id);
  if (!job) return null;

  const rawState = await job.getState();
  const state: JobState = rawState === "waiting" || rawState === "delayed" ? "queued" : rawState === "active" ? "processing" : rawState === "completed" ? "completed" : "failed";
  const progress = typeof job.progress === "number" ? job.progress : 0;
  const failedReason = job.failedReason;
  const result = cadResultStore.get(id) ?? (job.returnvalue as CadConversionResult | undefined);
  return { id, state, progress, result, error: failedReason };
}

export function redisConnection() {
  return {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    username: redis.username || undefined,
    password: redis.password || undefined,
    maxRetriesPerRequest: null
  };
}

export { queueName };
