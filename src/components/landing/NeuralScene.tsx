// The landing page's 3D backdrop — a neural "thalamus" of ~4.5k particles
// that breathes with time and morphs with scroll. Scroll progress (a framer
// MotionValue, 0→1 over the whole page) drives: sphere→dispersed morph, hue
// shift indigo→emerald, camera drift, and rotation. Lazy-loaded from Landing
// so the three.js chunk never blocks first paint.
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { MotionValue } from "framer-motion";

const PARTICLE_COUNT = 2400;

const VERT = /* glsl */ `
  attribute vec3 aScattered;
  attribute float aSeed;
  uniform float uTime;
  uniform float uMorph;      // 0 = tight neural sphere, 1 = dispersed field
  varying float vSeed;
  varying float vDepth;

  void main() {
    vSeed = aSeed;
    // Blend between the organized sphere and the scattered cloud, with a
    // gentle per-particle breathing wobble so the shape never sits still.
    vec3 base = mix(position, aScattered, uMorph);
    float wobble = sin(uTime * 0.6 + aSeed * 6.2831) * 0.055;
    vec3 pos = base + normalize(base) * wobble;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.5 + aSeed * 1.8) * (300.0 / -mv.z);
  }
`;

const FRAG = /* glsl */ `
  uniform float uMorph;
  varying float vSeed;
  varying float vDepth;

  void main() {
    // Soft round sprite
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.08, d);

    // Indigo (hero) → emerald (deep scroll), with per-particle variation
    vec3 indigo  = vec3(0.42, 0.45, 0.95);
    vec3 emerald = vec3(0.22, 0.83, 0.60);
    vec3 amber   = vec3(0.98, 0.75, 0.30);
    vec3 color = mix(indigo, emerald, uMorph);
    color = mix(color, amber, step(0.965, vSeed) * 0.85); // rare warm sparks

    float fade = clamp(1.6 - vDepth * 0.12, 0.25, 1.0);
    gl_FragColor = vec4(color, alpha * 0.45 * fade);
  }
`;

function NeuralCloud({ progress }: { progress: MotionValue<number> }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const points = useRef<THREE.Points>(null);

  const { positions, scattered, seeds } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const scattered = new Float32Array(PARTICLE_COUNT * 3);
    const seeds = new Float32Array(PARTICLE_COUNT);
    // Deterministic pseudo-random so the scene is identical every load.
    let s = 42;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Fibonacci sphere with radial noise — reads as an organic brain-like shell
      const t = i / PARTICLE_COUNT;
      const phi = Math.acos(1 - 2 * t);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = 2.1 + (rand() - 0.5) * 0.55;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.82; // slightly oblate
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // Dispersed target: a wide flat starfield the sphere dissolves into
      scattered[i * 3] = (rand() - 0.5) * 11;
      scattered[i * 3 + 1] = (rand() - 0.5) * 7;
      scattered[i * 3 + 2] = (rand() - 0.5) * 6 - 1.5;

      seeds[i] = rand();
    }
    return { positions, scattered, seeds };
  }, []);

  useFrame(({ clock, camera }) => {
    const p = progress.get();
    if (material.current) {
      material.current.uniforms.uTime.value = clock.elapsedTime;
      // Sphere holds through the hero, dissolves across the middle sections,
      // and re-gathers slightly for the closing CTA.
      const morph = p < 0.72 ? Math.min(1, p * 1.7) : Math.max(0.55, 1 - (p - 0.72) * 2.2);
      material.current.uniforms.uMorph.value = morph;
    }
    if (points.current) {
      points.current.rotation.y = clock.elapsedTime * 0.04 + p * Math.PI * 1.35;
      points.current.rotation.x = Math.sin(p * Math.PI) * 0.22;
    }
    camera.position.z = 6.2 - p * 1.6;
    camera.position.y = p * -0.7;
    camera.lookAt(0, 0, 0);
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aScattered" args={[scattered, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={material}
        vertexShader={VERT}
        fragmentShader={FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{ uTime: { value: 0 }, uMorph: { value: 0 } }}
      />
    </points>
  );
}

// Faint structural wireframe inside the cloud — gives the "organ" a spine.
function CoreFrame({ progress }: { progress: MotionValue<number> }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const p = progress.get();
    mesh.current.rotation.y = -clock.elapsedTime * 0.06;
    mesh.current.rotation.z = p * Math.PI * 0.5;
    const scale = 1 - p * 0.35;
    mesh.current.scale.setScalar(Math.max(0.5, scale));
    (mesh.current.material as THREE.MeshBasicMaterial).opacity = 0.1 * (1 - p * 0.6);
  });
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.35, 1]} />
      <meshBasicMaterial color="#818cf8" wireframe transparent opacity={0.1} />
    </mesh>
  );
}

export default function NeuralScene({ progress }: { progress: MotionValue<number> }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 6.2], fov: 46 }}
      dpr={[1, 1.4]}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
      style={{ position: "absolute", inset: 0 }}
      aria-hidden
    >
      <NeuralCloud progress={progress} />
      <CoreFrame progress={progress} />
    </Canvas>
  );
}
