"use client";

import { Edges, Grid, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { CadConversionResult, PreviewArc, PreviewCircle, PreviewExtrusion, PreviewLine, PreviewTriangle } from "@/lib/cad";

type CadViewerProps = {
  result: CadConversionResult | null;
};

export default function CadViewer({ result }: CadViewerProps) {
  return (
    <div className="viewer-shell">
      <Canvas camera={{ position: [80, 80, 80], fov: 45 }} shadows>
        <color attach="background" args={["#0b1020"]} />
        <hemisphereLight args={["#e2e8f0", "#111827", 1.35]} />
        <directionalLight position={[70, 100, 50]} intensity={2.2} />
        <directionalLight position={[-60, 35, -50]} intensity={0.8} color="#93c5fd" />
        <Grid infiniteGrid cellSize={10} sectionSize={50} fadeDistance={700} fadeStrength={1.2} cellColor="#263244" sectionColor="#3b82f6" />
        {result ? <ViewportContent result={result} /> : null}
        <OrbitControls makeDefault enableDamping />
      </Canvas>
      {!result ? <div className="viewer-empty">Upload a supported CAD file to preview geometry.</div> : null}
    </div>
  );
}

function ViewportContent({ result }: { result: CadConversionResult }) {
  const largestDimension = Math.max(
    result.metadata.boundingBox?.width ?? 1,
    result.metadata.boundingBox?.height ?? 1,
    result.metadata.boundingBox?.depth ?? 1
  );

  return (
    <>
      <FitCamera result={result} />
      <axesHelper args={[Math.max(largestDimension * 0.16, 1)]} />
      <CadScene result={result} />
    </>
  );
}

function FitCamera({ result }: { result: CadConversionResult }) {
  const { camera, size } = useThree();

  useEffect(() => {
    const box = result.metadata.boundingBox;
    if (!box || !(camera instanceof THREE.PerspectiveCamera)) return;

    const width = Math.max(box.width, 0.001);
    const height = Math.max(box.depth, 0.001);
    const depth = Math.max(box.height, 0.001);
    const radius = Math.sqrt(width * width + height * height + depth * depth) / 2;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(size.width / Math.max(size.height, 1), 0.1));
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = Math.max((radius / Math.sin(limitingFov / 2)) * 1.08, 1);
    const direction = new THREE.Vector3(1.15, 0.82, 1.15).normalize();

    camera.position.copy(direction.multiplyScalar(distance));
    camera.near = Math.max(distance / 1000, 0.001);
    camera.far = Math.max(distance * 20, 1000);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, result, size.height, size.width]);

  return null;
}

function CadScene({ result }: { result: CadConversionResult }) {
  const center = useMemo(() => {
    const box = result.metadata.boundingBox;
    if (!box) return [0, 0, 0] as [number, number, number];
    return [-(box.minX + box.maxX) / 2, -(box.minZ + box.maxZ) / 2, (box.minY + box.maxY) / 2] as [number, number, number];
  }, [result.metadata.boundingBox]);

  return (
    <group position={center}>
      {shouldShowEnvelopeSolid(result) ? <EnvelopeSolid result={result} /> : null}
      {result.geometry.extrusions.map((extrusion, index) => (
        <ExtrusionMesh key={`extrusion-${index}`} extrusion={extrusion} />
      ))}
      {result.geometry.triangles.length ? <TriangleMesh triangles={result.geometry.triangles} /> : null}
      {result.geometry.lines.map((line, index) => (
        <Line key={`line-${index}`} points={linePoints(line)} color="#2dd4bf" lineWidth={1.6} />
      ))}
      {result.geometry.circles.map((circle, index) => (
        <Line key={`circle-${index}`} points={circlePoints(circle)} color="#60a5fa" lineWidth={1.4} />
      ))}
      {result.geometry.arcs.map((arc, index) => (
        <Line key={`arc-${index}`} points={arcPoints(arc)} color="#f97316" lineWidth={1.4} />
      ))}
    </group>
  );
}

function TriangleMesh({ triangles }: { triangles: PreviewTriangle[] }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(triangles.length * 9);
    let offset = 0;

    triangles.forEach((triangle) => {
      triangle.points.forEach((point) => {
        const [x, y, z] = toThreePoint(point);
        positions[offset++] = x;
        positions[offset++] = y;
        positions[offset++] = z;
      });
    });

    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    bufferGeometry.computeVertexNormals();
    return bufferGeometry;
  }, [triangles]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#9ca3af" metalness={0.12} roughness={0.7} side={THREE.DoubleSide} />
      <Edges color="#64748b" threshold={28} />
    </mesh>
  );
}

function EnvelopeSolid({ result }: { result: CadConversionResult }) {
  const box = result.metadata.boundingBox;
  if (!box) return null;

  const largestDimension = Math.max(box.width, box.height, box.depth, 1);
  const minimumThickness = largestDimension * 0.002;
  const position = toThreePoint([(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2]);

  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={[Math.max(box.width, minimumThickness), Math.max(box.depth, minimumThickness), Math.max(box.height, minimumThickness)]} />
      <meshStandardMaterial color="#9ca3af" metalness={0.12} roughness={0.72} transparent opacity={0.78} side={THREE.DoubleSide} />
      <Edges color="#7dd3fc" lineWidth={1.15} />
    </mesh>
  );
}

function shouldShowEnvelopeSolid(result: CadConversionResult) {
  return result.geometry.extrusions.length === 0 && ["STEP", "IGES", "PLY"].includes(result.metadata.fileFormat);
}

function ExtrusionMesh({ extrusion }: { extrusion: PreviewExtrusion }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    extrusion.points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();

    const extrudeGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: extrusion.depth,
      bevelEnabled: false
    });
    extrudeGeometry.rotateX(-Math.PI / 2);
    extrudeGeometry.computeVertexNormals();
    return extrudeGeometry;
  }, [extrusion]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#9ca3af" metalness={0.14} roughness={0.66} side={THREE.DoubleSide} />
      <Edges color="#7dd3fc" lineWidth={1.1} />
    </mesh>
  );
}

function linePoints(line: PreviewLine): [number, number, number][] {
  return [toThreePoint(line.start), toThreePoint(line.end)];
}

function circlePoints(circle: PreviewCircle): [number, number, number][] {
  return anglePoints(circle, 0, Math.PI * 2, 96);
}

function arcPoints(arc: PreviewArc): [number, number, number][] {
  const end = arc.endAngle < arc.startAngle ? arc.endAngle + Math.PI * 2 : arc.endAngle;
  return anglePoints(arc, arc.startAngle, end, 48);
}

function anglePoints(circle: Pick<PreviewCircle, "center" | "radius">, startAngle: number, endAngle: number, segments: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  const span = endAngle - startAngle;
  const steps = Math.max(8, Math.ceil((segments * Math.abs(span)) / (Math.PI * 2)));

  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (span * index) / steps;
    points.push(toThreePoint([circle.center[0] + Math.cos(angle) * circle.radius, circle.center[1] + Math.sin(angle) * circle.radius, circle.center[2]]));
  }

  return points;
}

function toThreePoint(point: [number, number, number]): [number, number, number] {
  return [point[0], point[2], -point[1]];
}
