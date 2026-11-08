'use client';

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createForklift } from '../../../vendor/waretrack/models/forklift.js';
import { createPallet } from '../../../vendor/waretrack/models/pallet.js';
import { createCharger, createContainer, createFence, createGuardBooth, createParkingBay, createTree } from '../../../vendor/waretrack/models/props.js';
import { createTruck } from '../../../vendor/waretrack/models/truck.js';

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
  const [nearLane, farLane] = ROAD_LANES;
  const north = -57, south = ROAD_START_Z - 1;
  const radius = (farLane - nearLane) / 2;
  const k = radius * 4 * (Math.sqrt(2) - 1) / 3;
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.LineCurve3(v(nearLane, south), v(nearLane, north)));
  path.add(new THREE.CubicBezierCurve3(v(nearLane, north), v(nearLane, north - k), v(ROAD_CENTER_X - k, north - radius), v(ROAD_CENTER_X, north - radius)));
  path.add(new THREE.CubicBezierCurve3(v(ROAD_CENTER_X, north - radius), v(ROAD_CENTER_X + k, north - radius), v(farLane, north - k), v(farLane, north)));
  path.add(new THREE.LineCurve3(v(farLane, north), v(farLane, south)));
  path.add(new THREE.CubicBezierCurve3(v(farLane, south), v(farLane, south + k), v(ROAD_CENTER_X + k, south + radius), v(ROAD_CENTER_X, south + radius)));
  path.add(new THREE.CubicBezierCurve3(v(ROAD_CENTER_X, south + radius), v(ROAD_CENTER_X - k, south + radius), v(nearLane, south + k), v(nearLane, south)));
  return path;
}

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
  return <group position={[0.25, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
    <primitive object={model} scale={[0.63, 0.45, 0.355]} dispose={null} />
  </group>;
}

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
      const speed = Math.abs(tangent.x) > 0.15 ? 0.9 : 2.2;
      distance.current = (distance.current + Math.min(delta, 0.1) * speed / length) % 1;
    }
    curve.getPointAt(distance.current, point);
    curve.getTangentAt(distance.current, tangent);
    vehicle.current.position.copy(point);
    vehicle.current.rotation.y = Math.atan2(-tangent.z, tangent.x);
  });
  return <group ref={vehicle}>
    <FreightTruckModel refrigerated={phase > 0} />
  </group>;
}

export function YardTraffic({ enabled }: { enabled: boolean }) {
  return <group><CircuitTruck phase={0.16} enabled={enabled} /><CircuitTruck phase={0.66} enabled={enabled} /></group>;
}

export function LogisticsPallet({ kind = 'cardboard' }: { kind?: 'cardboard' | 'blue' | 'white' }) {
  const model = useMemo(() => createPallet({ kind, layers: 2, seed: 7 }), [kind]);
  return <primitive object={model} scale={[1.08, 1, 1.05]} dispose={null} />;
}

/** Packaging is illustrative; names and stock quantities remain sourced from inventory. */
export function packagingFor(name: string): 'cardboard' | 'blue' | 'white' {
  if (/sữa|milk|sua/i.test(name)) return 'white';
  if (/nước|chai|water|nuoc/i.test(name)) return 'blue';
  return 'cardboard';
}

/** Decorative equipment only; warehouse inventory continues to come from the API. */
export function LogisticsYard() {
  const assets = useMemo(() => {
    const result: THREE.Object3D[] = [];
    const place = (object: THREE.Object3D, x: number, z: number, scale = 1, rotation = 0) => {
      object.position.set(x, -0.055, z);
      object.scale.setScalar(scale);
      object.rotation.y = rotation;
      result.push(object);
    };
    [-10, -28, -46].forEach((z) => {
      place(createCharger(), 12.5, z + 7, 0.8, -Math.PI / 2);
    });
    [[26.5, -25], [26.5, -7], [-26.5, -43], [-26.5, -7]].forEach(([x, z], i) => {
      place(createContainer({ color: i % 2 ? 0x65cfc7 : 0x567886, label: 'FRESHMART', length: 6.1 }), x, z, 0.95, Math.PI / 2);
    });
    place(createGuardBooth({ barrier: false }), -13.7, 15, 0.75);
    const perimeter = createFence(78, { height: 1.8 });
    perimeter.position.set(-23, -0.055, 29);
    perimeter.rotation.y = Math.PI / 2;
    result.push(perimeter);
    [-1, -25, -49].forEach((z) => {
      const bay = createParkingBay(4.4, 7.2);
      bay.position.set(12.2, -0.08, z);
      result.push(bay);
    });
    [-55, -45, -37, -29, -19, -11, -1, 8, 16, 23].forEach((z, i) => {
      place(createTree({ size: 1.15, seed: i + 31 }), -20.5, z);
      place(createTree({ size: 1, seed: i + 51 }), 23.5, z);
    });
    return result;
  }, []);
  useEffect(() => () => {
    assets.forEach(object => {
      const led = object.userData.led as THREE.Mesh | undefined;
      if (led && led.material instanceof THREE.Material) led.material.dispose();
    });
  }, [assets]);
  return <group>
    {assets.map((object, index) => <primitive key={index} object={object} dispose={null} />)}
    {[-48, -24, 0, 22].map(z => <group key={z} position={[23, 0, z]}>
      <mesh position={[0, 2.65, 0]} castShadow><cylinderGeometry args={[.07, .12, 5.3, 8]} /><meshStandardMaterial color="#52676c" metalness={.45} /></mesh>
      <mesh position={[-.65, 5.25, 0]} castShadow><boxGeometry args={[1.4, .08, .1]} /><meshStandardMaterial color="#52676c" /></mesh>
      <mesh position={[-1.2, 5.19, 0]}><boxGeometry args={[.7, .1, .3]} /><meshStandardMaterial color="#f4e4ba" emissive="#f1dca3" emissiveIntensity={.4} /></mesh>
    </group>)}
    {[-36, -12, 12].map(z => <group key={z} position={[-20, .1, z]}>
      <mesh receiveShadow><boxGeometry args={[2.7, .32, 4.6]} /><meshStandardMaterial color="#d4dcd8" roughness={.88} /></mesh>
      <mesh position={[0, .2, 0]}><boxGeometry args={[2.45, .15, 4.35]} /><meshStandardMaterial color="#4f7556" roughness={.92} /></mesh>
      {[-1.5, -.5, .5, 1.5].map(pz => <mesh key={pz} position={[0, .52, pz]} castShadow><sphereGeometry args={[.65, 12, 10]} /><meshStandardMaterial color={pz > 0 ? '#59986b' : '#478259'} roughness={.88} /></mesh>)}
    </group>)}
  </group>;
}
