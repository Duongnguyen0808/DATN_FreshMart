import assert from 'node:assert/strict';
import { createYardCircuit, yardPatrolPose } from '../src/app/kho/mo-hinh-3d/yard-paths.ts';

const curve = createYardCircuit();
for (let i = 0; i <= 2000; i++) {
  const t = i / 2000;
  const p = curve.getPointAt(t);
  const heading = curve.getTangentAt(t);
  // Oriented truck footprint: include cab projection and mirrors.
  const extentX = Math.abs(heading.x) * 2.2 + Math.abs(heading.z) * 0.95;
  assert(p.x - extentX > 8.6, 'Truck sweeps into warehouse/RFID corridor');
  assert(p.x + extentX < 17, 'Truck crosses perimeter fence');
  for (const z of [0, -18, -36]) {
    const pose = yardPatrolPose(t * Math.PI * 2, z);
    const extentZ = Math.abs(Math.cos(pose.heading)) * 2.1 + Math.abs(Math.sin(pose.heading)) * 0.7;
    assert(pose.z - extentZ > z + 4.5, 'Patrol forklift crosses warehouse facade');
  }
}
assert(curve.getPointAt(0).distanceTo(curve.getPointAt(1)) < 0.001, 'Traffic loop teleports at wrap');
console.log('PASS 2001 swept-footprint samples: road/fence clearance, three warehouse facades, continuous loop');
