import assert from 'node:assert/strict';
import { createYardCircuit, yardPatrolPose, ROAD_CENTER_X, ROAD_CENTER_Z, ROAD_WIDTH, ROAD_LENGTH, ROAD_LANES, ROAD_START_Z } from '../src/app/kho/mo-hinh-3d/yard-paths.ts';

const curve = createYardCircuit();
for (let i = 0; i <= 2000; i++) {
  const t = i / 2000;
  const p = curve.getPointAt(t);
  const heading = curve.getTangentAt(t);
  // Oriented truck footprint: include cab projection and mirrors.
  const extentX = Math.abs(heading.x) * 2.2 + Math.abs(heading.z) * 1.05;
  const extentZ = Math.abs(heading.z) * 2.2 + Math.abs(heading.x) * 1.05;
  assert(p.x - extentX > ROAD_CENTER_X - ROAD_WIDTH/2 + .18, 'Truck crosses left edge marking');
  assert(p.x + extentX < ROAD_CENTER_X + ROAD_WIDTH/2 - .18, 'Truck crosses right edge marking');
  assert(p.z - extentZ > ROAD_CENTER_Z - ROAD_LENGTH/2, 'Truck leaves north road end');
  assert(p.z + extentZ < ROAD_CENTER_Z + ROAD_LENGTH/2, 'Truck leaves south road end');
  if (p.z > -56.5 && p.z < ROAD_START_Z - 1.5) {
    const lane = heading.z < 0 ? ROAD_LANES[0] : ROAD_LANES[1];
    assert(Math.abs(p.x - lane) < .001, 'Truck drifts away from lane centre on straight road');
    assert(Math.abs(heading.x) < .001, 'Truck points across straight road');
    assert(p.x - extentX > lane - ROAD_WIDTH/4 && p.x + extentX < lane + ROAD_WIDTH/4, 'Truck crosses lane boundary');
  }
  for (const z of [0, -18, -36]) {
    const pose = yardPatrolPose(t * Math.PI * 2, z);
    const extentZ = Math.abs(Math.cos(pose.heading)) * 2.1 + Math.abs(Math.sin(pose.heading)) * 0.7;
    assert(pose.z - extentZ > z + 4.5, 'Patrol forklift crosses warehouse facade');
  }
}
assert(curve.getPointAt(0).distanceTo(curve.getPointAt(1)) < 0.001, 'Traffic loop teleports at wrap');
assert(curve.getTangentAt(0).dot(curve.getTangentAt(1)) > .999, 'Truck snaps its heading at wrap');
console.log('PASS 2001 swept-footprint samples: lane centres, edge markings, road ends, warehouse facades, continuous loop');
