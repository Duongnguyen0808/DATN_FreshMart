'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createTruck } from '../../../vendor/waretrack/models/truck.js';

/** Spins cached model wheels from actual displacement, including reverse motion. */
export function useRollingWheels(model: THREE.Group, scale = 1) {
  const previous = useRef<THREE.Vector3 | null>(null);
  const position = useMemo(() => new THREE.Vector3(), []);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Quaternion(), []);
  useFrame(() => {
    model.getWorldPosition(position);
    if (previous.current) {
      model.getWorldQuaternion(rotation);
      forward.set(0, 0, 1).applyQuaternion(rotation);
      const distance = forward.dot(position.clone().sub(previous.current));
      // Ignore resets; parked and paused vehicles naturally have zero displacement.
      if (Math.abs(distance) < 2) for (const wheel of model.userData.wheels as THREE.Mesh[]) {
        wheel.rotation.x += distance / (wheel.userData.radius * scale);
      }
    }
    if (!previous.current) previous.current = new THREE.Vector3();
    previous.current.copy(position);
  });
}

export function FreightTruckModel({ refrigerated = false }: { refrigerated?: boolean }) {
  const model = useMemo(() => createTruck({ carrier: 'waretrack', reefer: refrigerated }), [refrigerated]);
  useRollingWheels(model, 0.45);
  // Preserve the existing rear loading platform and waypoint footprint exactly.
  return <group position={[0.25, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
    <primitive object={model} scale={[0.63, 0.45, 0.355]} dispose={null} />
  </group>;
}

export function ParkedFreightTrucks() {
  return <group>{[[21.5, 10], [-21.5, -25]].map(([x, z], index) => <group key={x} position={[x, 0, z]} rotation={[0, Math.PI / 2, 0]}>
    <FreightTruckModel refrigerated={index === 1} />
  </group>)}</group>;
}
