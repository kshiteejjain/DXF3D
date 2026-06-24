import DxfParser from "dxf-parser";

export type CadComplexity = "simple" | "medium" | "heavy";
export type JobState = "queued" | "processing" | "completed" | "failed";

export type BoundingBox = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  width: number;
  height: number;
  depth: number;
};

export type PreviewLine = {
  type: "line";
  start: [number, number, number];
  end: [number, number, number];
  layer?: string;
};

export type PreviewCircle = {
  type: "circle";
  center: [number, number, number];
  radius: number;
  layer?: string;
};

export type PreviewArc = Omit<PreviewCircle, "type"> & {
  type: "arc";
  startAngle: number;
  endAngle: number;
};

export type PreviewExtrusion = {
  type: "extrusion";
  points: [number, number][];
  depth: number;
  layer?: string;
};

export type PreviewTriangle = {
  type: "triangle";
  points: [[number, number, number], [number, number, number], [number, number, number]];
  layer?: string;
};

export type PreviewGeometry = {
  lines: PreviewLine[];
  circles: PreviewCircle[];
  arcs: PreviewArc[];
  extrusions: PreviewExtrusion[];
  triangles: PreviewTriangle[];
};

export type CadMetadata = {
  fileName: string;
  fileSize: number;
  fileFormat: string;
  totalEntities: number;
  entityTypeCounts: Record<string, number>;
  supportedEntityCount: number;
  unsupportedEntityCount: number;
  unsupportedTypes: string[];
  layers: string[];
  boundingBox: BoundingBox | null;
  units: string | null;
  complexity: CadComplexity;
  warnings: string[];
  quantities: CadQuantities;
};

export type CadConversionResult = {
  metadata: CadMetadata;
  geometry: PreviewGeometry;
};

export type CadQuantities = {
  dimensions: {
    width: number;
    height: number;
    depth: number;
    unit: string;
  } | null;
  volume: {
    value: number;
    unit: string;
    cubicMeters: number | null;
  } | null;
  weight: {
    kilograms: number;
    densityKgM3: number;
  } | null;
  markingMeters: number | null;
  cuttingMeters: number | null;
};

export type CadJobSnapshot = {
  id: string;
  state: JobState;
  progress: number;
  result?: CadConversionResult;
  error?: string;
};

type DxfEntity = Record<string, unknown>;
type DxfBlock = {
  entities?: DxfEntity[];
  position?: unknown;
};

type DxfDocument = Record<string, unknown> & {
  entities?: DxfEntity[];
  blocks?: Record<string, DxfBlock>;
};

type Point2 = [number, number];
type Transform2D = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
};

const SUPPORTED_TYPES = new Set(["LINE", "POLYLINE", "LWPOLYLINE", "CIRCLE", "ARC", "ELLIPSE", "SPLINE", "SOLID", "3DFACE", "INSERT", "DIMENSION"]);
const HEAVY_TYPES = new Set(["SPLINE", "HATCH", "INSERT", "DIMENSION", "TEXT", "MTEXT", "BLOCK"]);
const UNIT_CODES: Record<number, string> = {
  0: "Unitless",
  1: "Inches",
  2: "Feet",
  3: "Miles",
  4: "Millimeters",
  5: "Centimeters",
  6: "Meters",
  7: "Kilometers",
  8: "Microinches",
  9: "Mils",
  10: "Yards",
  11: "Angstroms",
  12: "Nanometers",
  13: "Microns",
  14: "Decimeters"
};
const UNIT_TO_METERS: Record<string, number> = {
  Inches: 0.0254,
  Feet: 0.3048,
  Miles: 1609.344,
  Millimeters: 0.001,
  Centimeters: 0.01,
  Meters: 1,
  Kilometers: 1000,
  Yards: 0.9144,
  Decimeters: 0.1
};
const SUPPORTED_EXTENSIONS = new Set(["dxf", "dwg", "obj", "stl", "step", "stp", "iges", "igs", "3ds", "ply"]);

export const CAD_MAX_UPLOAD_BYTES = Number(process.env.CAD_MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);

export function validateCadUpload(fileName: string, fileSize: number) {
  const extension = getFileExtension(fileName);

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported file type ".${extension || "unknown"}". Supported: ${[...SUPPORTED_EXTENSIONS].map((item) => `.${item}`).join(", ")}.`);
  }

  if (fileSize <= 0) {
    throw new Error("The uploaded CAD file is empty.");
  }

  if (fileSize > CAD_MAX_UPLOAD_BYTES) {
    throw new Error(`The CAD file exceeds the configured ${formatBytes(CAD_MAX_UPLOAD_BYTES)} upload limit.`);
  }
}

export const validateDxfUpload = validateCadUpload;

export function convertCadBuffer(
  fileName: string,
  fileSize: number,
  data: ArrayBuffer,
  extrusionDepth: number,
  densityKgM3 = 7850,
  unitsOverride?: string | null
): CadConversionResult {
  const extension = getFileExtension(fileName);
  const text = isTextCadFormat(extension) ? decodeText(data) : "";

  if (extension === "dxf" || extension === "dwg") {
    if (extension === "dwg") {
      return buildGenericResult(fileName, fileSize, "DWG", emptyGeometry(), {}, ["DWG is a proprietary binary format. Upload an exported DXF for exact entity conversion."], densityKgM3, unitsOverride);
    }
    return convertDxfText(fileName, fileSize, text, extrusionDepth, densityKgM3, unitsOverride);
  }

  if (extension === "obj") return convertObjText(fileName, fileSize, text, densityKgM3, unitsOverride);
  if (extension === "stl") return convertStlBuffer(fileName, fileSize, data, densityKgM3, unitsOverride);
  if (extension === "step" || extension === "stp") return convertStepText(fileName, fileSize, text, densityKgM3, unitsOverride);
  if (extension === "iges" || extension === "igs") return convertIgesText(fileName, fileSize, text, densityKgM3, unitsOverride);
  if (extension === "3ds") return convert3dsBuffer(fileName, fileSize, data, densityKgM3, unitsOverride);
  if (extension === "ply") return convertPlyText(fileName, fileSize, text, densityKgM3, unitsOverride);

  return buildGenericResult(fileName, fileSize, extension.toUpperCase(), emptyGeometry(), {}, ["No converter is available for this CAD format yet."], densityKgM3, unitsOverride);
}

export function convertDxfText(
  fileName: string,
  fileSize: number,
  dxfText: string,
  extrusionDepth: number,
  densityKgM3 = 7850,
  unitsOverride?: string | null
): CadConversionResult {
  const parser = new DxfParser();
  const parsed = parser.parseSync(normalizeDxfText(dxfText)) as DxfDocument;
  const entities = Array.isArray(parsed.entities) ? (parsed.entities as DxfEntity[]) : [];
  const entityTypeCounts = countEntityTypes(entities);
  const unsupportedTypes = Object.keys(entityTypeCounts).filter((type) => !SUPPORTED_TYPES.has(type));
  const layers = collectLayers(parsed, entities);
  const geometry = buildPreviewGeometry(parsed, entities, extrusionDepth);
  const boundingBox = calculateBoundingBox(geometry);
  const complexity = classifyDxf(fileSize, entities, entityTypeCounts, layers.length, boundingBox);
  const unsupportedEntityCount = unsupportedTypes.reduce((sum, type) => sum + entityTypeCounts[type], 0);
  const warnings = buildWarnings(complexity, unsupportedTypes, unsupportedEntityCount, geometry, boundingBox);
  const units = normalizeUnits(unitsOverride) ?? readUnits(parsed);

  return {
    metadata: {
      fileName,
      fileSize,
      fileFormat: "DXF",
      totalEntities: entities.length,
      entityTypeCounts,
      supportedEntityCount: entities.length - unsupportedEntityCount,
      unsupportedEntityCount,
      unsupportedTypes,
      layers,
      boundingBox,
      units,
      complexity,
      warnings,
      quantities: calculateQuantities(geometry, boundingBox, units, densityKgM3)
    },
    geometry
  };
}

function convertObjText(fileName: string, fileSize: number, text: string, densityKgM3: number, unitsOverride?: string | null) {
  const vertices: [number, number, number][] = [];
  const geometry = emptyGeometry();
  let faceCount = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      const [, x, y, z] = trimmed.split(/\s+/);
      vertices.push([readNumber(x), readNumber(y), readNumber(z)]);
    }

    if (trimmed.startsWith("f ")) {
      const indices = trimmed
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((part) => Number(part.split("/")[0]) - 1)
        .filter((index) => Number.isInteger(index) && vertices[index]);

      if (indices.length >= 2) {
        faceCount += 1;
        if (indices.length >= 3) {
          for (let index = 1; index < indices.length - 1; index += 1) {
            geometry.triangles.push({ type: "triangle", points: [vertices[indices[0]], vertices[indices[index]], vertices[indices[index + 1]]], layer: "OBJ" });
          }
        }
        for (let index = 0; index < indices.length; index += 1) {
          const start = vertices[indices[index]];
          const end = vertices[indices[(index + 1) % indices.length]];
          geometry.lines.push({ type: "line", start, end, layer: "OBJ" });
        }
      }
    }
  }

  return buildGenericResult(fileName, fileSize, "OBJ", geometry, { VERTEX: vertices.length, FACE: faceCount }, [], densityKgM3, unitsOverride);
}

function convertStlBuffer(fileName: string, fileSize: number, data: ArrayBuffer, densityKgM3: number, unitsOverride?: string | null) {
  const text = decodeText(data);
  return text.trimStart().startsWith("solid") && /facet\s+normal/i.test(text)
    ? convertAsciiStlText(fileName, fileSize, text, densityKgM3, unitsOverride)
    : convertBinaryStlBuffer(fileName, fileSize, data, densityKgM3, unitsOverride);
}

function convertAsciiStlText(fileName: string, fileSize: number, text: string, densityKgM3: number, unitsOverride?: string | null) {
  const geometry = emptyGeometry();
  const vertices: [number, number, number][] = [];

  for (const match of text.matchAll(/vertex\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/gi)) {
    vertices.push([readNumber(match[1]), readNumber(match[2]), readNumber(match[3])]);
  }

  appendTriangles(vertices, geometry, "STL");
  return buildGenericResult(fileName, fileSize, "STL", geometry, { TRIANGLE: Math.floor(vertices.length / 3) }, ["STL is mesh-only; exact CAD features and sheet thickness are not available."], densityKgM3, unitsOverride);
}

function convertBinaryStlBuffer(fileName: string, fileSize: number, data: ArrayBuffer, densityKgM3: number, unitsOverride?: string | null) {
  const geometry = emptyGeometry();
  const view = new DataView(data);
  const vertices: [number, number, number][] = [];
  if (view.byteLength < 84) return buildGenericResult(fileName, fileSize, "STL", geometry, {}, ["Invalid or empty binary STL."], densityKgM3, unitsOverride);

  const triangleCount = Math.min(view.getUint32(80, true), Math.floor((view.byteLength - 84) / 50));
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = 84 + triangle * 50 + 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexOffset = offset + vertex * 12;
      vertices.push([view.getFloat32(vertexOffset, true), view.getFloat32(vertexOffset + 4, true), view.getFloat32(vertexOffset + 8, true)]);
    }
  }

  appendTriangles(vertices, geometry, "STL");
  return buildGenericResult(fileName, fileSize, "STL", geometry, { TRIANGLE: triangleCount }, ["STL is mesh-only; exact CAD features and sheet thickness are not available."], densityKgM3, unitsOverride);
}

function convertStepText(fileName: string, fileSize: number, text: string, densityKgM3: number, unitsOverride?: string | null) {
  const points = readStepCartesianPoints(text);
  const geometry = geometryFromPointCloud(points, "STEP");
  return buildGenericResult(fileName, fileSize, "STEP", geometry, { CARTESIAN_POINT: points.length }, ["STEP topology requires a CAD kernel for exact B-Rep conversion; showing coordinate envelope preview."], densityKgM3, unitsOverride);
}

function convertIgesText(fileName: string, fileSize: number, text: string, densityKgM3: number, unitsOverride?: string | null) {
  const points = readLooseCoordinateTriples(text);
  const geometry = geometryFromPointCloud(points, "IGES");
  return buildGenericResult(fileName, fileSize, "IGES", geometry, { COORDINATE: points.length }, ["IGES topology requires a CAD kernel for exact surface conversion; showing coordinate envelope preview."], densityKgM3, unitsOverride);
}

function convertPlyText(fileName: string, fileSize: number, text: string, densityKgM3: number, unitsOverride?: string | null) {
  const lines = text.split(/\r?\n/);
  const vertexCountLine = lines.find((line) => line.startsWith("element vertex"));
  const vertexCount = Number(vertexCountLine?.split(/\s+/)[2] ?? 0);
  const dataStart = lines.findIndex((line) => line.trim() === "end_header") + 1;
  const vertices = lines.slice(dataStart, dataStart + vertexCount).map((line) => {
    const [x, y, z] = line.trim().split(/\s+/);
    return [readNumber(x), readNumber(y), readNumber(z)] as [number, number, number];
  });
  const geometry = geometryFromPointCloud(vertices, "PLY");
  return buildGenericResult(fileName, fileSize, "PLY", geometry, { VERTEX: vertices.length }, ["PLY preview uses vertex envelope unless face data is converted by a mesh pipeline."], densityKgM3, unitsOverride);
}

function convert3dsBuffer(fileName: string, fileSize: number, data: ArrayBuffer, densityKgM3: number, unitsOverride?: string | null) {
  const geometry = emptyGeometry();
  const view = new DataView(data);
  let vertexCount = 0;
  let faceCount = 0;
  let skippedFaceCount = 0;
  const maxPreviewLines = 60000;

  function appendFace(vertices: [number, number, number][], a: number, b: number, c: number) {
    if (!vertices[a] || !vertices[b] || !vertices[c]) return;
    faceCount += 1;
    geometry.triangles.push({ type: "triangle", points: [vertices[a], vertices[b], vertices[c]], layer: "3DS" });

    if (geometry.lines.length + 3 > maxPreviewLines) {
      skippedFaceCount += 1;
      return;
    }

    geometry.lines.push({ type: "line", start: vertices[a], end: vertices[b], layer: "3DS" });
    geometry.lines.push({ type: "line", start: vertices[b], end: vertices[c], layer: "3DS" });
    geometry.lines.push({ type: "line", start: vertices[c], end: vertices[a], layer: "3DS" });
  }

  function readObjectName(start: number, end: number) {
    let cursor = start;
    while (cursor < end && view.getUint8(cursor) !== 0) cursor += 1;
    return Math.min(cursor + 1, end);
  }

  function readVertices(start: number, end: number) {
    const vertices: [number, number, number][] = [];
    if (start + 2 > end) return vertices;

    const count = view.getUint16(start, true);
    let cursor = start + 2;

    for (let index = 0; index < count && cursor + 12 <= end; index += 1) {
      vertices.push([view.getFloat32(cursor, true), view.getFloat32(cursor + 4, true), view.getFloat32(cursor + 8, true)]);
      cursor += 12;
    }

    vertexCount += vertices.length;
    return vertices;
  }

  function readFaces(start: number, end: number, vertices: [number, number, number][]) {
    if (start + 2 > end) return;

    const count = view.getUint16(start, true);
    let cursor = start + 2;

    for (let index = 0; index < count && cursor + 8 <= end; index += 1) {
      appendFace(vertices, view.getUint16(cursor, true), view.getUint16(cursor + 2, true), view.getUint16(cursor + 4, true));
      cursor += 8;
    }
  }

  function parseMesh(start: number, end: number) {
    let offset = start;
    let vertices: [number, number, number][] = [];

    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true);
      const length = view.getUint32(offset + 2, true);
      const chunkEnd = Math.min(offset + length, end, view.byteLength);
      if (length < 6 || chunkEnd <= offset) break;

      if (id === 0x4110) vertices = readVertices(offset + 6, chunkEnd);
      if (id === 0x4120) readFaces(offset + 6, chunkEnd, vertices);

      offset = chunkEnd;
    }
  }

  function walkContainers(start: number, end: number, depth = 0) {
    if (depth > 16) return;

    let offset = start;
    while (offset + 6 <= end && offset + 6 <= view.byteLength) {
      const id = view.getUint16(offset, true);
      const length = view.getUint32(offset + 2, true);
      const chunkEnd = Math.min(offset + length, end, view.byteLength);
      if (length < 6 || chunkEnd <= offset) break;

      if (id === 0x4000) {
        walkContainers(readObjectName(offset + 6, chunkEnd), chunkEnd, depth + 1);
      } else if (id === 0x4100) {
        parseMesh(offset + 6, chunkEnd);
      } else if (id === 0x4d4d || id === 0x3d3d) {
        walkContainers(offset + 6, chunkEnd, depth + 1);
      }

      offset = chunkEnd;
    }
  }

  walkContainers(0, view.byteLength);

  const warnings = ["3DS preview reads mesh chunks only; materials, cameras, and animation are ignored."];
  if (skippedFaceCount > 0) warnings.push(`Large 3DS mesh detected; preview was capped at ${maxPreviewLines.toLocaleString()} line segments.`);

  return buildGenericResult(fileName, fileSize, "3DS", geometry, { VERTEX: vertexCount, FACE: faceCount }, warnings, densityKgM3, unitsOverride);
}

export function classifyDxf(
  fileSize: number,
  entities: DxfEntity[],
  entityTypeCounts: Record<string, number>,
  layerCount: number,
  boundingBox: BoundingBox | null
): CadComplexity {
  const totalEntities = entities.length;
  const unsupportedCount = Object.entries(entityTypeCounts)
    .filter(([type]) => !SUPPORTED_TYPES.has(type))
    .reduce((sum, [, count]) => sum + count, 0);
  const heavyUnsupportedCount = Object.entries(entityTypeCounts)
    .filter(([type]) => HEAVY_TYPES.has(type) && !SUPPORTED_TYPES.has(type))
    .reduce((sum, [, count]) => sum + count, 0);
  const unsupportedRatio = totalEntities > 0 ? unsupportedCount / totalEntities : 0;
  const maxRange = boundingBox ? Math.max(boundingBox.width, boundingBox.height, boundingBox.depth) : 0;

  if (
    fileSize > 25 * 1024 * 1024 ||
    totalEntities > 50000 ||
    heavyUnsupportedCount > Math.max(250, totalEntities * 0.2) ||
    layerCount > 80 ||
    maxRange > 1_000_000
  ) {
    return "heavy";
  }

  if (fileSize < 5 * 1024 * 1024 && totalEntities < 5000) {
    return "simple";
  }

  if (
    fileSize >= 5 * 1024 * 1024 ||
    totalEntities >= 5000 ||
    unsupportedCount > Math.max(25, totalEntities * 0.15) ||
    unsupportedRatio > 0.35 ||
    layerCount > 30 ||
    maxRange > 250_000
  ) {
    return "medium";
  }

  return "simple";
}

function buildGenericResult(
  fileName: string,
  fileSize: number,
  fileFormat: string,
  geometry: PreviewGeometry,
  entityTypeCounts: Record<string, number>,
  extraWarnings: string[],
  densityKgM3: number,
  unitsOverride?: string | null
): CadConversionResult {
  const boundingBox = calculateBoundingBox(geometry);
  const units = normalizeUnits(unitsOverride);
  const totalEntities = Object.values(entityTypeCounts).reduce((sum, count) => sum + count, 0);
  const complexity = classifyDxf(fileSize, new Array(Math.min(totalEntities, 100000)).fill({ type: fileFormat }), entityTypeCounts, 1, boundingBox);
  const warnings = [
    ...extraWarnings,
    ...buildWarnings(complexity, [], 0, geometry, boundingBox).filter((warning) => !extraWarnings.includes(warning))
  ];

  return {
    metadata: {
      fileName,
      fileSize,
      fileFormat,
      totalEntities,
      entityTypeCounts,
      supportedEntityCount: totalEntities,
      unsupportedEntityCount: 0,
      unsupportedTypes: [],
      layers: [fileFormat],
      boundingBox,
      units,
      complexity,
      warnings,
      quantities: calculateQuantities(geometry, boundingBox, units, densityKgM3)
    },
    geometry
  };
}

function emptyGeometry(): PreviewGeometry {
  return { lines: [], circles: [], arcs: [], extrusions: [], triangles: [] };
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.trim().toLowerCase() ?? "";
}

function isTextCadFormat(extension: string) {
  return ["dxf", "dwg", "obj", "step", "stp", "iges", "igs", "stl", "ply"].includes(extension);
}

function decodeText(data: ArrayBuffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(data);
}

function appendTriangles(vertices: [number, number, number][], geometry: PreviewGeometry, layer: string) {
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const a = vertices[index];
    const b = vertices[index + 1];
    const c = vertices[index + 2];
    geometry.triangles.push({ type: "triangle", points: [a, b, c], layer });
    geometry.lines.push({ type: "line", start: a, end: b, layer });
    geometry.lines.push({ type: "line", start: b, end: c, layer });
    geometry.lines.push({ type: "line", start: c, end: a, layer });
  }
}

function geometryFromPointCloud(points: [number, number, number][], layer: string) {
  const geometry = emptyGeometry();
  if (points.length < 2) return geometry;

  const box = points.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point[0]),
      minY: Math.min(current.minY, point[1]),
      minZ: Math.min(current.minZ, point[2]),
      maxX: Math.max(current.maxX, point[0]),
      maxY: Math.max(current.maxY, point[1]),
      maxZ: Math.max(current.maxZ, point[2])
    }),
    { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }
  );

  const corners: [number, number, number][] = [
    [box.minX, box.minY, box.minZ],
    [box.maxX, box.minY, box.minZ],
    [box.maxX, box.maxY, box.minZ],
    [box.minX, box.maxY, box.minZ],
    [box.minX, box.minY, box.maxZ],
    [box.maxX, box.minY, box.maxZ],
    [box.maxX, box.maxY, box.maxZ],
    [box.minX, box.maxY, box.maxZ]
  ];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7]
  ];

  for (const [start, end] of edges) {
    geometry.lines.push({ type: "line", start: corners[start], end: corners[end], layer });
  }

  return geometry;
}

function readStepCartesianPoints(text: string): [number, number, number][] {
  const points: [number, number, number][] = [];
  const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:E[+-]?\\d+)?)";
  const pattern = new RegExp(`CARTESIAN_POINT\\s*\\([^()]*\\(\\s*${number}\\s*,\\s*${number}\\s*,\\s*${number}\\s*\\)`, "gi");
  for (const match of text.matchAll(pattern)) {
    points.push([readNumber(match[1]), readNumber(match[2]), readNumber(match[3])]);
  }
  return points;
}

function readLooseCoordinateTriples(text: string): [number, number, number][] {
  const points: [number, number, number][] = [];
  const pattern = /([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[DE][+-]?\d+)?)\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[DE][+-]?\d+)?)\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[DE][+-]?\d+)?)/gi;
  for (const match of text.matchAll(pattern)) {
    points.push([readNumber(match[1].replace(/D/i, "E")), readNumber(match[2].replace(/D/i, "E")), readNumber(match[3].replace(/D/i, "E"))]);
    if (points.length > 20000) break;
  }
  return points;
}

function buildPreviewGeometry(parsed: DxfDocument, entities: DxfEntity[], extrusionDepth: number): PreviewGeometry {
  const geometry: PreviewGeometry = { lines: [], circles: [], arcs: [], extrusions: [], triangles: [] };
  appendEntitiesToGeometry(parsed, entities, extrusionDepth, geometry, identityTransform(), 0);
  appendLineLoopExtrusions(geometry, extrusionDepth);
  return geometry;
}

function appendEntitiesToGeometry(
  parsed: DxfDocument,
  entities: DxfEntity[],
  extrusionDepth: number,
  geometry: PreviewGeometry,
  transform: Transform2D,
  depth: number
) {
  if (depth > 8) return;

  for (const entity of entities) {
    const type = readType(entity);
    const layer = readString(entity.layer);

    if (type === "LINE") {
      const [start, end] = readLinePoints(entity);
      if (start && end) geometry.lines.push({ type: "line", start: transformPoint3(start, transform), end: transformPoint3(end, transform), layer });
    }

    if (type === "CIRCLE") {
      const center = readPoint3(entity.center);
      const radius = scaleRadius(readNumber(entity.radius), transform);
      if (center && radius > 0) geometry.circles.push({ type: "circle", center: transformPoint3(center, transform), radius, layer });
    }

    if (type === "ARC") {
      const center = readPoint3(entity.center);
      const radius = scaleRadius(readNumber(entity.radius), transform);
      const startAngle = readAngle(entity.startAngle, transform);
      const endAngle = readAngle(entity.endAngle, transform);
      if (center && radius > 0) geometry.arcs.push({ type: "arc", center: transformPoint3(center, transform), radius, startAngle, endAngle, layer });
    }

    if (type === "ELLIPSE") {
      const points = readEllipsePoints(entity).map((point) => transformPoint3(point, transform));
      appendSegmentedLine(points, geometry, layer, false);
    }

    if (type === "SPLINE") {
      const points = readSplinePoints(entity).map((point) => transformPoint3(point, transform));
      appendSegmentedLine(points, geometry, layer, isEntityClosed(entity) || pointsFormClosedLoop(points.map(toPoint2)));
    }

    if (type === "POLYLINE" || type === "LWPOLYLINE") {
      const points = readPolylinePoints(entity).map((point) => transformPoint2(point, transform));
      const closed = isEntityClosed(entity) || pointsFormClosedLoop(points);

      for (let index = 0; index < points.length - 1; index += 1) {
        geometry.lines.push({ type: "line", start: toPoint3(points[index]), end: toPoint3(points[index + 1]), layer });
      }

      if (closed && points.length > 2) {
        if (!samePoint2(points[points.length - 1], points[0])) {
          geometry.lines.push({ type: "line", start: toPoint3(points[points.length - 1]), end: toPoint3(points[0]), layer });
        }
        if (extrusionDepth > 0) geometry.extrusions.push({ type: "extrusion", points: removeClosingPoint(points), depth: extrusionDepth, layer });
      }
    }

    if (type === "INSERT") {
      appendInsertToGeometry(parsed, entity, extrusionDepth, geometry, transform, depth);
    }

    if (type === "DIMENSION") {
      appendDimensionToGeometry(parsed, entity, extrusionDepth, geometry, transform, depth);
    }

    if (type === "SOLID" || type === "3DFACE") {
      appendFaceEntity(entity, extrusionDepth, geometry, transform, layer);
    }
  }
}

function countEntityTypes(entities: DxfEntity[]) {
  return entities.reduce<Record<string, number>>((counts, entity) => {
    const type = readType(entity);
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
}

function appendInsertToGeometry(
  parsed: DxfDocument,
  insert: DxfEntity,
  extrusionDepth: number,
  geometry: PreviewGeometry,
  parentTransform: Transform2D,
  depth: number
) {
  const blockName = readString(insert.name);
  const block = blockName ? parsed.blocks?.[blockName] : undefined;
  const blockEntities = Array.isArray(block?.entities) ? block.entities : [];

  if (!blockEntities.length) return;

  const blockBase = readPoint2(block?.position) ?? [0, 0];
  const insertPosition = readPoint2(insert.position) ?? [0, 0];
  const xScale = readScale(insert.xScale);
  const yScale = readScale(insert.yScale);
  const rotation = readRotation(insert.rotation);
  const columnCount = Math.max(1, Math.floor(readNumber(insert.columnCount) || 1));
  const rowCount = Math.max(1, Math.floor(readNumber(insert.rowCount) || 1));
  const columnSpacing = readNumber(insert.columnSpacing);
  const rowSpacing = readNumber(insert.rowSpacing);

  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const localTransform = composeTransform(parentTransform, {
        x: insertPosition[0] + column * columnSpacing - blockBase[0] * xScale,
        y: insertPosition[1] + row * rowSpacing - blockBase[1] * yScale,
        scaleX: xScale,
        scaleY: yScale,
        rotation
      });

      appendEntitiesToGeometry(parsed, blockEntities, extrusionDepth, geometry, localTransform, depth + 1);
    }
  }
}

function appendDimensionToGeometry(
  parsed: DxfDocument,
  dimension: DxfEntity,
  extrusionDepth: number,
  geometry: PreviewGeometry,
  parentTransform: Transform2D,
  depth: number
) {
  const blockName = readString(dimension.block);
  const block = blockName ? parsed.blocks?.[blockName] : undefined;
  const blockEntities = Array.isArray(block?.entities) ? block.entities : [];
  if (blockEntities.length) appendEntitiesToGeometry(parsed, blockEntities, extrusionDepth, geometry, parentTransform, depth + 1);
}

function appendFaceEntity(entity: DxfEntity, extrusionDepth: number, geometry: PreviewGeometry, transform: Transform2D, layer?: string) {
  const rawPoints = readFacePoints(entity);
  const points = rawPoints.map((point) => transformPoint2([point[0], point[1]], transform));

  if (points.length < 3) return;

  appendSegmentedLine(points.map(toPoint3), geometry, layer, true);
  if (extrusionDepth > 0) geometry.extrusions.push({ type: "extrusion", points, depth: extrusionDepth, layer });
}

function appendSegmentedLine(points: [number, number, number][], geometry: PreviewGeometry, layer?: string, closed = false) {
  for (let index = 0; index < points.length - 1; index += 1) {
    geometry.lines.push({ type: "line", start: points[index], end: points[index + 1], layer });
  }

  if (closed && points.length > 2 && !samePoint2(toPoint2(points[0]), toPoint2(points[points.length - 1]))) {
    geometry.lines.push({ type: "line", start: points[points.length - 1], end: points[0], layer });
  }
}

function appendLineLoopExtrusions(geometry: PreviewGeometry, extrusionDepth: number) {
  if (extrusionDepth <= 0 || geometry.extrusions.length > 0 || geometry.lines.length < 3) return;

  const unused = new Set(geometry.lines.map((_, index) => index));

  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    unused.delete(firstIndex);

    const firstLine = geometry.lines[firstIndex];
    const loop: Point2[] = [toPoint2(firstLine.start), toPoint2(firstLine.end)];
    let changed = true;

    while (changed && !pointsFormClosedLoop(loop)) {
      changed = false;

      for (const index of [...unused]) {
        const line = geometry.lines[index];
        const start = toPoint2(line.start);
        const end = toPoint2(line.end);
        const tail = loop[loop.length - 1];

        if (samePoint2(tail, start)) {
          loop.push(end);
          unused.delete(index);
          changed = true;
          break;
        }

        if (samePoint2(tail, end)) {
          loop.push(start);
          unused.delete(index);
          changed = true;
          break;
        }
      }
    }

    const closedLoop = removeClosingPoint(loop);
    if (pointsFormClosedLoop(loop) && closedLoop.length > 2) {
      geometry.extrusions.push({ type: "extrusion", points: closedLoop, depth: extrusionDepth });
    }
  }
}

function pointsFormClosedLoop(points: Point2[]) {
  return points.length > 2 && samePoint2(points[0], points[points.length - 1]);
}

function removeClosingPoint(points: Point2[]) {
  return pointsFormClosedLoop(points) ? points.slice(0, -1) : points;
}

function samePoint2(a: Point2, b: Point2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
}

function toPoint2(point: [number, number, number]): Point2 {
  return [point[0], point[1]];
}

function collectLayers(parsed: Record<string, unknown>, entities: DxfEntity[]) {
  const layers = new Set<string>();
  const tables = parsed.tables as Record<string, unknown> | undefined;
  const layerTable = tables?.layers as Record<string, unknown> | undefined;

  if (layerTable) {
    for (const key of Object.keys(layerTable)) layers.add(key);
  }

  for (const entity of entities) {
    const layer = readString(entity.layer);
    if (layer) layers.add(layer);
  }

  return [...layers].sort((a, b) => a.localeCompare(b));
}

function normalizeDxfText(text: string) {
  return text.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
}

function calculateBoundingBox(geometry: PreviewGeometry): BoundingBox | null {
  const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };

  const add = (point: [number, number, number]) => {
    box.minX = Math.min(box.minX, point[0]);
    box.minY = Math.min(box.minY, point[1]);
    box.minZ = Math.min(box.minZ, point[2]);
    box.maxX = Math.max(box.maxX, point[0]);
    box.maxY = Math.max(box.maxY, point[1]);
    box.maxZ = Math.max(box.maxZ, point[2]);
  };

  for (const line of geometry.lines) {
    add(line.start);
    add(line.end);
  }

  for (const circle of [...geometry.circles, ...geometry.arcs]) {
    add([circle.center[0] - circle.radius, circle.center[1] - circle.radius, circle.center[2]]);
    add([circle.center[0] + circle.radius, circle.center[1] + circle.radius, circle.center[2]]);
  }

  for (const extrusion of geometry.extrusions) {
    for (const point of extrusion.points) {
      add([point[0], point[1], 0]);
      add([point[0], point[1], extrusion.depth]);
    }
  }

  if (!Number.isFinite(box.minX)) return null;

  return {
    ...box,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    depth: box.maxZ - box.minZ
  };
}

function buildWarnings(
  complexity: CadComplexity,
  unsupportedTypes: string[],
  unsupportedEntityCount: number,
  geometry: PreviewGeometry,
  boundingBox: BoundingBox | null
) {
  const warnings: string[] = [];
  if (unsupportedEntityCount > 0) {
    warnings.push(`${unsupportedEntityCount} unsupported entities were skipped: ${unsupportedTypes.join(", ")}.`);
  }
  if (complexity !== "simple") {
    warnings.push(`${complexity[0].toUpperCase()}${complexity.slice(1)} CAD file detected; queued processing is used outside simple conversions.`);
  }
  if (!boundingBox) warnings.push("No supported preview geometry was found.");
  if (geometry.extrusions.length === 0) warnings.push("No closed supported polylines were available for extrusion.");
  return warnings;
}

function calculateQuantities(
  geometry: PreviewGeometry,
  boundingBox: BoundingBox | null,
  units: string | null,
  densityKgM3: number
): CadQuantities {
  const unit = units ?? "Drawing units";
  const meterFactor = units ? UNIT_TO_METERS[units] : undefined;
  const cuttingLength = calculateCuttingLength(geometry);
  const markingLength = calculateMarkingLength(geometry);
  const volume = calculateVolume(geometry);
  const cubicMeters = meterFactor ? volume * Math.pow(meterFactor, 3) : null;

  return {
    dimensions: boundingBox
      ? {
          width: boundingBox.width,
          height: boundingBox.height,
          depth: boundingBox.depth,
          unit
        }
      : null,
    volume: volume > 0 ? { value: volume, unit: `${unit}3`, cubicMeters } : null,
    weight: cubicMeters && densityKgM3 > 0 ? { kilograms: cubicMeters * densityKgM3, densityKgM3 } : null,
    markingMeters: meterFactor ? markingLength * meterFactor : null,
    cuttingMeters: meterFactor ? cuttingLength * meterFactor : null
  };
}

function calculateVolume(geometry: PreviewGeometry) {
  const extrusionVolume = geometry.extrusions.reduce((sum, extrusion) => sum + Math.abs(polygonArea(extrusion.points)) * extrusion.depth, 0);
  if (extrusionVolume > 0) return extrusionVolume;

  const meshVolume = geometry.triangles.reduce((sum, triangle) => {
    const [a, b, c] = triangle.points;
    return sum + (
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }, 0);

  return Math.abs(meshVolume);
}

function calculateCuttingLength(geometry: PreviewGeometry) {
  return geometry.extrusions.reduce((sum, extrusion) => sum + polylineLength(extrusion.points, true), 0);
}

function calculateMarkingLength(geometry: PreviewGeometry) {
  const lineLength = geometry.lines.reduce((sum, line) => sum + distance2(line.start, line.end), 0);
  const circleLength = geometry.circles.reduce((sum, circle) => sum + Math.PI * 2 * circle.radius, 0);
  const arcLength = geometry.arcs.reduce((sum, arc) => {
    const span = arc.endAngle < arc.startAngle ? arc.endAngle + Math.PI * 2 - arc.startAngle : arc.endAngle - arc.startAngle;
    return sum + Math.abs(span) * arc.radius;
  }, 0);

  return lineLength + circleLength + arcLength;
}

function polygonArea(points: Point2[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function polylineLength(points: Point2[], closed: boolean) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += distance2(toPoint3(points[index]), toPoint3(points[index + 1]));
  }
  if (closed && points.length > 2) length += distance2(toPoint3(points[points.length - 1]), toPoint3(points[0]));
  return length;
}

function distance2(start: [number, number, number], end: [number, number, number]) {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function readUnits(parsed: Record<string, unknown>) {
  const header = parsed.header as Record<string, unknown> | undefined;
  const code = Number(header?.$INSUNITS);
  return Number.isFinite(code) ? UNIT_CODES[code] ?? `Code ${code}` : null;
}

function normalizeUnits(units: string | null | undefined) {
  if (!units || units === "Auto") return null;
  return UNIT_TO_METERS[units] ? units : null;
}

function readLinePoints(entity: DxfEntity): [PreviewLine["start"] | null, PreviewLine["end"] | null] {
  const vertices = Array.isArray(entity.vertices) ? entity.vertices : null;
  if (vertices && vertices.length >= 2) return [readPoint3(vertices[0]), readPoint3(vertices[1])];
  return [readPoint3(entity.start), readPoint3(entity.end)];
}

function readPolylinePoints(entity: DxfEntity): [number, number][] {
  const vertices = Array.isArray(entity.vertices) ? entity.vertices : Array.isArray(entity.points) ? entity.points : [];
  return vertices
    .map((vertex) => readPoint2(vertex))
    .filter((point): point is [number, number] => Boolean(point));
}

function readSplinePoints(entity: DxfEntity): [number, number, number][] {
  const fitPoints = Array.isArray(entity.fitPoints) ? entity.fitPoints : [];
  const controlPoints = Array.isArray(entity.controlPoints) ? entity.controlPoints : [];
  const points = fitPoints.length >= 2 ? fitPoints : controlPoints;

  return points
    .map((point) => readPoint3(point))
    .filter((point): point is [number, number, number] => Boolean(point));
}

function readEllipsePoints(entity: DxfEntity): [number, number, number][] {
  const center = readPoint3(entity.center);
  const majorAxisEndPoint = readPoint3(entity.majorAxisEndPoint);
  const axisRatio = Math.abs(readNumber(entity.axisRatio) || 1);
  const startAngle = readRotation(entity.startAngle ?? 0);
  const endAngleRaw = entity.endAngle === undefined ? Math.PI * 2 : readRotation(entity.endAngle);
  const endAngle = endAngleRaw <= startAngle ? endAngleRaw + Math.PI * 2 : endAngleRaw;

  if (!center || !majorAxisEndPoint) return [];

  const majorLength = Math.hypot(majorAxisEndPoint[0], majorAxisEndPoint[1]);
  const rotation = Math.atan2(majorAxisEndPoint[1], majorAxisEndPoint[0]);
  const minorLength = majorLength * axisRatio;
  const steps = Math.max(16, Math.ceil((Math.abs(endAngle - startAngle) / (Math.PI * 2)) * 96));
  const points: [number, number, number][] = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / steps;
    const x = Math.cos(angle) * majorLength;
    const y = Math.sin(angle) * minorLength;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    points.push([center[0] + x * cos - y * sin, center[1] + x * sin + y * cos, center[2]]);
  }

  return points;
}

function readFacePoints(entity: DxfEntity): [number, number, number][] {
  const candidates = Array.isArray(entity.points) ? entity.points : Array.isArray(entity.vertices) ? entity.vertices : [];
  const points = candidates
    .map((point) => readPoint3(point))
    .filter((point): point is [number, number, number] => Boolean(point));

  return removeDuplicateTail(points);
}

function readPoint2(value: unknown): [number, number] | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  const x = readNumber(point.x);
  const y = readNumber(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function readPoint3(value: unknown): [number, number, number] | null {
  const point = readPoint2(value);
  if (!point || !value || typeof value !== "object") return null;
  return [point[0], point[1], readNumber((value as Record<string, unknown>).z)];
}

function removeDuplicateTail(points: [number, number, number][]) {
  if (points.length < 2) return points;
  const unique = [...points];
  while (unique.length > 1) {
    const last = unique[unique.length - 1];
    const previous = unique[unique.length - 2];
    if (Math.hypot(last[0] - previous[0], last[1] - previous[1], last[2] - previous[2]) > 1e-6) break;
    unique.pop();
  }
  return unique;
}

function isEntityClosed(entity: DxfEntity) {
  const flags = readNumber(entity.flags ?? entity.flag);
  return Boolean(entity.closed) || Boolean(entity.shape) || (flags & 1) === 1;
}

function identityTransform(): Transform2D {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}

function composeTransform(parent: Transform2D, child: Transform2D): Transform2D {
  const translated = transformPoint2([child.x, child.y], parent);

  return {
    x: translated[0],
    y: translated[1],
    scaleX: parent.scaleX * child.scaleX,
    scaleY: parent.scaleY * child.scaleY,
    rotation: parent.rotation + child.rotation
  };
}

function transformPoint2(point: Point2, transform: Transform2D): Point2 {
  const scaledX = point[0] * transform.scaleX;
  const scaledY = point[1] * transform.scaleY;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);

  return [scaledX * cos - scaledY * sin + transform.x, scaledX * sin + scaledY * cos + transform.y];
}

function transformPoint3(point: [number, number, number], transform: Transform2D): [number, number, number] {
  const transformed = transformPoint2([point[0], point[1]], transform);
  return [transformed[0], transformed[1], point[2]];
}

function scaleRadius(radius: number, transform: Transform2D) {
  return radius * (Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2;
}

function readScale(value: unknown) {
  const scale = readNumber(value);
  return scale === 0 ? 1 : scale;
}

function readRotation(value: unknown) {
  const rotation = readNumber(value);
  return Math.abs(rotation) > Math.PI * 2 ? toRadians(rotation) : rotation;
}

function readAngle(value: unknown, transform: Transform2D) {
  return readRotation(value) + transform.rotation;
}

function toPoint3(point: [number, number]): [number, number, number] {
  return [point[0], point[1], 0];
}

function readType(entity: DxfEntity) {
  return readString(entity.type)?.toUpperCase() ?? "UNKNOWN";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
