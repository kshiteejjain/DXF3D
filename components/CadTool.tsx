"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CadConversionResult, CadJobSnapshot, CadQuantities } from "@/lib/cad";

type ConvertResponse =
  | { mode: "immediate"; status: "completed"; result: CadConversionResult }
  | { mode: "queued"; status: "queued"; jobId: string; metadata: CadConversionResult["metadata"] }
  | { error: string };

const CONVERT_TIMEOUT_MS = 15000;
const UNIT_OPTIONS = ["Auto", "Millimeters", "Centimeters", "Meters", "Inches", "Feet"] as const;
const CadViewer = dynamic(() => import("./CadViewer"), { ssr: false });

export default function CadTool() {
  const [file, setFile] = useState<File | null>(null);
  const [extrusionDepth, setExtrusionDepth] = useState(10);
  const [densityKgM3, setDensityKgM3] = useState(7850);
  const [unitsOverride, setUnitsOverride] = useState<(typeof UNIT_OPTIONS)[number]>("Auto");
  const [status, setStatus] = useState("Waiting for a DXF upload.");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<CadConversionResult | null>(null);
  const [queuedMetadata, setQueuedMetadata] = useState<CadConversionResult["metadata"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const metadata = result?.metadata ?? queuedMetadata;
  const isWorking = status === "Converting..." || status.startsWith("Queued") || status.startsWith("Processing");
  const statusTone = status === "Completed." ? "ok" : error ? "bad" : isWorking ? "work" : "idle";

  useEffect(() => {
    if (!jobId || result) return;

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/cad/jobs/${jobId}`);
        const payload = (await response.json()) as CadJobSnapshot | { error: string };

        if (!response.ok || "error" in payload) {
          throw new Error("error" in payload ? payload.error : "Failed to poll job.");
        }

        if (payload.state === "completed" && payload.result) {
          setResult(payload.result);
          setQueuedMetadata(null);
          setStatus("Completed.");
          setJobId(null);
          return;
        }

        if (payload.state === "failed") {
          throw new Error(payload.error ?? "Queued conversion failed.");
        }

        setStatus(`${payload.state === "processing" ? "Processing" : "Queued"} (${payload.progress}%).`);
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "Failed to poll job.");
        setStatus("Failed.");
        setJobId(null);
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [jobId, result]);

  async function convert() {
    if (!file) {
      setError("Choose a .dxf file first.");
      return;
    }

    setError(null);
    setResult(null);
    setQueuedMetadata(null);
    setJobId(null);
    setStatus("Converting...");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("extrusionDepth", String(extrusionDepth));
    formData.append("densityKgM3", String(densityKgM3));
    formData.append("unitsOverride", unitsOverride);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONVERT_TIMEOUT_MS);

    try {
      const response = await fetch("/api/cad/convert", { method: "POST", body: formData, signal: controller.signal });
      const payload = (await response.json()) as ConvertResponse;

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Conversion failed.");
      }

      if (payload.mode === "immediate") {
        setResult(payload.result);
        setStatus("Completed.");
        return;
      }

      setQueuedMetadata(payload.metadata);
      setJobId(payload.jobId);
      setStatus(`Queued job ${payload.jobId}.`);
    } catch (convertError) {
      setError(convertError instanceof Error && convertError.name === "AbortError" ? "Conversion request timed out. Restart the server and try again." : convertError instanceof Error ? convertError.message : "Conversion failed.");
      setStatus("Failed.");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const entityRows = useMemo(() => Object.entries(metadata?.entityTypeCounts ?? {}).sort(([a], [b]) => a.localeCompare(b)), [metadata]);

  return (
    <main className="page">
      <section className="app-bar">
        <div className="brand-block">
          <div className="brand-mark">DX</div>
          <div>
            <p className="eyebrow">DXF to 3D Preview</p>
            <h1>CAD Preview Engine</h1>
          </div>
        </div>
        <div className="app-actions">
          <span className="system-label">Node Runtime</span>
          <div className={`status-pill status-${statusTone}`}>{status}</div>
          <a className="ghost-button" href="/api/auth/logout">
            Logout
          </a>
        </div>
      </section>

      <section className="summary-strip">
        <SummaryMetric label="Complexity" value={metadata?.complexity ?? "Pending"} />
        <SummaryMetric label="Entities" value={metadata ? metadata.totalEntities.toLocaleString() : "0"} />
        <SummaryMetric label="Volume" value={metadata ? formatVolume(metadata.quantities.volume) : "Not available"} />
        <SummaryMetric label="Weight" value={metadata ? formatWeight(metadata.quantities.weight) : "Not available"} />
        <SummaryMetric label="Cutting" value={metadata ? formatMeters(metadata.quantities.cuttingMeters) : "Not available"} />
      </section>

      <section className="workspace">
        <aside className="panel controls-panel">
          <PanelHeader title="Job Setup" meta="Upload and conversion inputs" />
          <button className="upload-box" type="button" onClick={() => inputRef.current?.click()}>
            <span>{file ? file.name : "Choose DXF file"}</span>
            <small>{file ? formatBytes(file.size) : "Accepted format: .dxf"}</small>
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".dxf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <label className="field">
            <span>Extrusion depth</span>
            <input min={0} step={1} type="number" value={extrusionDepth} onChange={(event) => setExtrusionDepth(Number(event.target.value))} />
          </label>

          <label className="field">
            <span>Drawing units</span>
            <select value={unitsOverride} onChange={(event) => setUnitsOverride(event.target.value as (typeof UNIT_OPTIONS)[number])}>
              {UNIT_OPTIONS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Density kg/m3</span>
            <input min={1} step={1} type="number" value={densityKgM3} onChange={(event) => setDensityKgM3(Number(event.target.value))} />
          </label>

          <button className="primary-button" disabled={isWorking} type="button" onClick={convert}>
            Convert
          </button>

          {error ? <div className="alert alert-error">{error}</div> : null}
          {metadata?.warnings.length ? (
            <div className="alert">
              {metadata.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="viewer-panel">
          <div className="viewer-topbar">
            <div>
              <span className="panel-kicker">3D Viewport</span>
              <strong>{metadata?.fileName ?? "No file loaded"}</strong>
            </div>
            <div className="viewer-stats">
              <span>Lines {result?.geometry.lines.length ?? 0}</span>
              <span>Solids {result?.geometry.extrusions.length ?? 0}</span>
            </div>
          </div>
          <CadViewer result={result} />
        </section>

        <aside className="panel metadata-panel">
          <PanelHeader title="Analysis" meta="File parameters and quantities" />
          {metadata ? (
            <>
              <dl className="meta-grid">
                <Meta label="File" value={metadata.fileName} />
                <Meta label="Size" value={formatBytes(metadata.fileSize)} />
                <Meta label="Complexity" value={metadata.complexity} />
                <Meta label="Entities" value={metadata.totalEntities.toLocaleString()} />
                <Meta label="Supported" value={metadata.supportedEntityCount.toLocaleString()} />
                <Meta label="Unsupported" value={metadata.unsupportedEntityCount.toLocaleString()} />
                <Meta label="Units" value={metadata.units ?? "Not specified"} />
                <Meta label="Layers" value={metadata.layers.length.toLocaleString()} />
              </dl>

              {metadata.boundingBox ? (
                <div className="sub-panel">
                  <h3>Bounding Box</h3>
                  <p>
                    {metadata.boundingBox.width.toFixed(2)} x {metadata.boundingBox.height.toFixed(2)} x {metadata.boundingBox.depth.toFixed(2)}
                  </p>
                </div>
              ) : null}

              <div className="sub-panel">
                <h3>Quantities</h3>
                <dl className="meta-grid">
                  <Meta label="Dimensions" value={formatDimensions(metadata.quantities.dimensions)} />
                  <Meta label="Volume" value={formatVolume(metadata.quantities.volume)} />
                  <Meta label="Weight" value={formatWeight(metadata.quantities.weight)} />
                  <Meta label="Marking" value={formatMeters(metadata.quantities.markingMeters)} />
                  <Meta label="Cutting" value={formatMeters(metadata.quantities.cuttingMeters)} />
                </dl>
              </div>

              <div className="sub-panel">
                <h3>Entity Types</h3>
                <div className="tag-list">
                  {entityRows.map(([type, count]) => (
                    <span className="tag" key={type}>
                      {type}: {count}
                    </span>
                  ))}
                </div>
              </div>

              <div className="sub-panel">
                <h3>Layers</h3>
                <div className="tag-list">
                  {metadata.layers.slice(0, 24).map((layer) => (
                    <span className="tag" key={layer}>
                      {layer}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="muted">Metadata appears after conversion starts.</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        <p>{meta}</p>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDimensions(dimensions: CadQuantities["dimensions"]) {
  if (!dimensions) return "Not available";
  return `${formatNumber(dimensions.width)} x ${formatNumber(dimensions.height)} x ${formatNumber(dimensions.depth)} ${dimensions.unit}`;
}

function formatVolume(volume: CadQuantities["volume"]) {
  if (!volume) return "Not available";
  if (volume.cubicMeters !== null) return `${formatNumber(volume.cubicMeters)} m3`;
  return `${formatNumber(volume.value)} ${volume.unit}`;
}

function formatWeight(weight: CadQuantities["weight"]) {
  if (!weight) return "Set known drawing units";
  return `${formatNumber(weight.kilograms)} kg`;
}

function formatMeters(value: number | null) {
  if (value === null) return "Set known drawing units";
  return `${formatNumber(value)} m`;
}

function formatNumber(value: number) {
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
