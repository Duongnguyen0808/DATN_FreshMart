'use client';

import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createYardCircuit, yardPatrolPose } from './yard-paths';
import { FreightTruckModel } from './reference-vehicles';

/** Visual simulation only: no sensor events, inventory writes or workflow callbacks. */
export function useYardPatrol(ref: RefObject<THREE.Group | null>, warehouseZ: number, enabled: boolean) {
  const phase = useRef(0);
  useFrame((_, delta) => {
    if (!enabled || !ref.current) return;
    phase.current += Math.min(delta, 0.1) * 0.24;
    const pose = yardPatrolPose(phase.current, warehouseZ);
    // Entire swept footprint stays in the apron, in front of the warehouse facade.
    ref.current.position.set(pose.x, 0, pose.z);
    ref.current.rotation.y = pose.heading;
  });
}

function CircuitTruck({ phase, enabled }: { phase: number; enabled: boolean }) {
  const vehicle = useRef<THREE.Group>(null);
  const distance = useRef(phase);
  const curve = useMemo(createYardCircuit, []);
  const length = useMemo(() => curve.getLength(), [curve]);
  const point = useMemo(() => new THREE.Vector3(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    if (!vehicle.current) return;
    if (enabled) {
      curve.getTangentAt(distance.current, tangent);
      // Slow through the two turning areas, cruise along the straight road.
      const speed = Math.abs(tangent.x) > 0.15 ? 0.9 : 2.2;
      distance.current = (distance.current + Math.min(delta, 0.1) * speed / length) % 1;
    }
    curve.getPointAt(distance.current, point);
    curve.getTangentAt(distance.current, tangent);
    vehicle.current.position.copy(point);
    // Truck models face local +Z; align that axis with the road tangent.
    vehicle.current.rotation.y = Math.atan2(tangent.x, tangent.z);
  });
  return <group ref={vehicle}>
    <FreightTruckModel refrigerated={phase > 0} />
  </group>;
}

export function YardTraffic({ enabled }: { enabled: boolean }) {
  return <group><CircuitTruck phase={0.16} enabled={enabled} /><CircuitTruck phase={0.66} enabled={enabled} /></group>;
}
