'use client';

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createForklift } from '../../../vendor/waretrack/models/forklift.js';
import { useRollingWheels } from './reference-vehicles';

/** WareTrack forklift adapted to FreshMart's -Z travel axis and cargo anchor. */
export function ForkliftVehicle({ liftRef, driverRef, steeringRef, cargo }: {
  liftRef: RefObject<THREE.Group | null>; driverRef: RefObject<THREE.Group | null>;
  steeringRef: RefObject<THREE.Mesh | null>; cargo?: ReactNode;
}) {
  const model = useMemo(() => createForklift({ operator: true }), []);
  const cargoAnchor = useRef<THREE.Group>(null);
  useRollingWheels(model);
  useEffect(() => {
    const anchor = model.userData.forkAnchor as THREE.Group;
    const pallet = cargoAnchor.current;
    if (!pallet) return;
    // WareTrack's forkAnchor is calibrated to the fork heel; parenting here keeps a load seated
    // on the blades and makes it rise with the carriage instead of floating at vehicle centre.
    anchor.add(pallet);
    pallet.position.set(0, 0, 0);
    pallet.rotation.set(0, 0, 0);
    return () => { anchor.remove(pallet); };
  }, [model]);
  useEffect(() => {
    driverRef.current = model.userData.driver;
    return () => { driverRef.current = null; };
  }, [model, driverRef]);
  useFrame(() => {
    // Existing business animation drives the lift; forks and cargo share the same height.
    model.userData.setForkHeight((liftRef.current?.position.y ?? 0.08) + 0.09);
  });
  return <group>
    <group position={[0, 0, -0.39]} rotation={[0, Math.PI, 0]}>
      <primitive object={model} dispose={null} />
    </group>
    <group ref={liftRef} position={[0, 0.08, 0]} />
    <group ref={cargoAnchor}>{cargo}</group>
    <mesh ref={steeringRef} position={[0, 1.35, -0.48]} rotation={[Math.PI / 3, 0, 0]}>
      <torusGeometry args={[0.15, 0.02, 6, 16]} /><meshStandardMaterial color="#202a32" />
    </mesh>
  </group>;
}
