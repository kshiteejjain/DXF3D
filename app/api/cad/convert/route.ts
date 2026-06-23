import { NextResponse } from "next/server";
import { convertCadBuffer, validateCadUpload } from "@/lib/cad";
import { enqueueCadJob } from "@/lib/cadQueue";

export const runtime = "nodejs";
const QUEUE_TIMEOUT_MS = Number(process.env.CAD_QUEUE_TIMEOUT_MS ?? 2500);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const extrusionDepthValue = Number(formData.get("extrusionDepth") ?? 1);
    const extrusionDepth = Number.isFinite(extrusionDepthValue) && extrusionDepthValue >= 0 ? extrusionDepthValue : 1;
    const densityValue = Number(formData.get("densityKgM3") ?? 7850);
    const densityKgM3 = Number.isFinite(densityValue) && densityValue > 0 ? densityValue : 7850;
    const unitsOverride = String(formData.get("unitsOverride") ?? "Auto");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A CAD file is required." }, { status: 400 });
    }

    validateCadUpload(file.name, file.size);

    const fileBuffer = await file.arrayBuffer();
    const result = convertCadBuffer(file.name, file.size, fileBuffer, extrusionDepth, densityKgM3, unitsOverride);

    if (result.metadata.complexity === "simple") {
      return NextResponse.json({ mode: "immediate", status: "completed", result });
    }

    const jobPayload = {
      fileName: file.name,
      fileSize: file.size,
      fileBase64: Buffer.from(fileBuffer).toString("base64"),
      extrusionDepth,
      densityKgM3,
      unitsOverride
    };

    const jobId = await withTimeout(enqueueCadJob(jobPayload), QUEUE_TIMEOUT_MS).catch((queueError) => {
      if (result.metadata.complexity === "medium") {
        result.metadata.warnings.push(
          `${queueError instanceof Error ? queueError.message : "Redis queue is not responding."} Returned the medium DXF immediately.`
        );
        return null;
      }

      throw queueError;
    });

    if (!jobId) {
      return NextResponse.json({ mode: "immediate", status: "completed", result });
    }

    return NextResponse.json({
      mode: "queued",
      status: "queued",
      jobId,
      metadata: result.metadata
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to convert DXF.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Redis queue is not responding. Start Redis or use a simple DXF for immediate conversion.")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
