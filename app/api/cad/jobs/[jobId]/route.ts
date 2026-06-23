import { NextResponse } from "next/server";
import { readCadJob } from "@/lib/cadQueue";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const job = await readCadJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
