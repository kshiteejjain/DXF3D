import { Worker } from "bullmq";
import { convertDxfText } from "../lib/cad";
import { queueName, redisConnection, setCadJobResult, setCadJobState, type CadQueuePayload } from "../lib/cadQueue";

const worker = new Worker<CadQueuePayload>(
  queueName,
  async (job) => {
    setCadJobState(job.id ?? "", "processing", 10);
    await job.updateProgress(10);

    const result = convertDxfText(job.data.fileName, job.data.fileSize, job.data.dxfText, job.data.extrusionDepth, job.data.densityKgM3, job.data.unitsOverride);

    await job.updateProgress(100);
    if (job.id) setCadJobResult(job.id, result);
    return result;
  },
  { connection: redisConnection() }
);

worker.on("active", (job) => {
  if (job.id) setCadJobState(job.id, "processing", 25);
});

worker.on("completed", (job, result) => {
  if (job.id) setCadJobResult(job.id, result);
  console.log(`CAD job ${job.id} completed.`);
});

worker.on("failed", (job, error) => {
  if (job?.id) setCadJobState(job.id, "failed", 100, error.message);
  console.error(`CAD job ${job?.id ?? "unknown"} failed:`, error);
});

console.log("CAD worker listening for DXF conversion jobs.");
