import * as THREE from 'three';

export const ROAD_CENTER_X = 18;
export const ROAD_WIDTH = 8;
export const ROAD_LANES = [ROAD_CENTER_X - 2, ROAD_CENTER_X + 2] as const;
export const ROAD_START_Z = 28;
export const ROAD_LENGTH = 100;
export const ROAD_CENTER_Z = -15;

export function yardPatrolPose(phase: number, warehouseZ: number) {
  return { x: 6.2 + 2.2 * Math.cos(phase), z: warehouseZ + 8.4 + 0.7 * Math.sin(phase), heading: Math.atan2(2.2 * Math.sin(phase), -0.7 * Math.cos(phase)) };
}

export function createYardCircuit() {
  // Keep each straight leg exactly on a lane centre. Lane changes happen only at the
  // broad turnarounds at the ends of the road.
  const [nearLane, farLane] = ROAD_LANES;
  const points = [
    new THREE.Vector3(nearLane, 0, ROAD_START_Z - 1), new THREE.Vector3(nearLane, 0, -57),
    new THREE.Vector3(ROAD_CENTER_X, 0, -61), new THREE.Vector3(farLane, 0, -57),
    new THREE.Vector3(farLane, 0, ROAD_START_Z - 1), new THREE.Vector3(ROAD_CENTER_X, 0, ROAD_START_Z + 3),
  ];
  return new THREE.CatmullRomCurve3(points, true, 'centripetal');
}
