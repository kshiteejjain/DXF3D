"use client";

import { Bounds, Grid, Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import type { CadConversionResult, PreviewArc, PreviewCircle, PreviewExtrusion, PreviewLine } from "@/lib/cad";

type CadViewerProps = {
  result: CadConversionResult | null;
};

export default function CadViewer({ result }: CadViewerProps) {
  return (
    <div className="viewer-shell">
      <Canvas camera={{ position: [80, 80, 80], fov: 45 }} shadows>
        <color attach="background" args={["#0b1020"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[40, 80, 30]} intensity={1.7} />
        <Grid infiniteGrid cellSize={10} sectionSize={50} fadeDistance={700} fadeStrength={1.2} cellColor="#263244" sectionColor="#3b82f6" />
        <axesHelper args={[80]} />
        {result ? (
          <Bounds fit clip observe margin={1.35}>
            <CadScene result={result} />
          </Bounds>
        ) : null}
        <OrbitControls makeDefault enableDamping />
      </Canvas>
      {!result ? <div className="viewer-empty">Upload a DXF file to preview supported geometry.</div> : null}
    </div>
  );
}

function CadScene({ result }: { result: CadConversionResult }) {
  const center = useMemo(() => {
    const box = result.metadata.boundingBox;
    if (!box) return [0, 0, 0] as [number, number, number];
    return [-(box.minX + box.maxX) / 2, -(box.minZ + box.maxZ) / 2, (box.minY + box.maxY) / 2] as [number, number, number];
  }, [result.metadata.boundingBox]);

  return (
    <group position={center}>
      {result.geometry.extrusions.map((extrusion, index) => (
        <ExtrusionMesh key={`extrusion-${index}`} extrusion={extrusion} />
      ))}
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

function ExtrusionMesh({ extrusion }: { extrusion: PreviewExtrusion }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    extrusion.points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, -y);
      else shape.lineTo(x, -y);
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

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#22d3ee" emissive="#083344" metalness={0.08} roughness={0.56} transparent opacity={0.46} side={THREE.DoubleSide} />
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
