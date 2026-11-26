'use client';

import { Fragment, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, Environment, Lightformer, MapControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Inventory } from '../../../lib/inventory-api';
import {
  ForkliftVehicle,
  FreightTruckModel,
  LogisticsPallet,
  LogisticsYard,
  packagingFor,
  ROAD_CENTER_X,
  ROAD_CENTER_Z,
  ROAD_LANES,
  ROAD_LENGTH,
  ROAD_WIDTH,
  YardTraffic,
} from './logistics-yard';
import { WarehouseDetails } from './warehouse-details';
import { SurroundingWorld } from './surrounding-world';
import {
  getAsphaltTexture,
  getConcreteYardTexture,
  getCorrugatedMetalTexture,
  getSkyDomeTexture,
} from './procedural-textures';
import type { AccessPhase } from './warehouse-door-experience';

type SceneTargets = {
  truck: THREE.Group | null;
  fork: THREE.Group | null;
  destinationFork: THREE.Group | null;
  employee: THREE.Group | null;
};

export type DemoState = 'IDLE' | 'TRUCK_APPROACHING' | 'TRUCK_DOCKING' | 'DOCKED' | 'TRUCK_UNLOADING' | 'WORKER_APPROACHING' | 'FORKLIFT_TO_TRUCK' | 'PALLET_UNLOADING' | 'IOT_CAMERA_SIMULATED' | 'WAITING_CONFIRMATION' | 'GOODS_RECEIVED' | 'MOVE_TO_STORAGE' | 'STORED' | 'TRANSFER_PREPARING' | 'FORKLIFT_PICKUP' | 'MOVE_TO_OUTBOUND' | 'IOT_CAMERA_OUT_SIMULATED' | 'FORKLIFT_DELIVER_TO_TRUCK' | 'TRANSFER_LOADING_TRUCK' | 'WAITING_DISPATCH_CONFIRM' | 'DISPATCHED' | 'IN_TRANSIT' | 'DESTINATION_ARRIVAL' | 'DESTINATION_PALLET_PICKUP' | 'IOT_CAMERA_IN_SIMULATED' | 'WAITING_RECEIVE_CONFIRM' | 'RECEIVED' | 'COMPLETE';
type Site = { id: string; name: string; code: string; storeName: string; items: Inventory[] };
type Props = {
  demoRunId: number; onMotionComplete: (state: DemoState) => void; warehouseName: string;
  destinationWarehouseId: string; campusWarehouses: Site[]; transferMode: boolean; items: Inventory[];
  selectedItem: Inventory | null; onSelectItem: (item: Inventory) => void; selectedZone: string;
  onSelectZone: (zone: string) => void; demoState: DemoState; demoPaused: boolean;
  demoProduct: { code: string; name: string; unit: string } | null; demoInventory?: Inventory;
  accessDoorState?: 'OPEN' | 'CLOSED' | 'UNKNOWN'; accessAlert?: boolean;
  accessFocus?: boolean; onAccessMotionComplete?: (phase: AccessPhase) => void; accessEmployeePhase?: AccessPhase; accessEmployeeName?: string; onSelectDoor?: () => void;
  speedMultiplier?: number;
};

const movement = new Set<DemoState>(['TRUCK_APPROACHING','TRUCK_DOCKING','TRUCK_UNLOADING','FORKLIFT_TO_TRUCK','FORKLIFT_PICKUP','MOVE_TO_OUTBOUND','MOVE_TO_STORAGE','TRANSFER_LOADING_TRUCK','IN_TRANSIT','DESTINATION_ARRIVAL','DESTINATION_PALLET_PICKUP','TRANSFER_PREPARING','IOT_CAMERA_SIMULATED','IOT_CAMERA_IN_SIMULATED','FORKLIFT_DELIVER_TO_TRUCK']);
const route: Partial<Record<DemoState, [number, number][]>> = {
  // Inbound truck parks to the right of the entrance, leaving the doorway and camera aisle clear.
  // Start on the centre of the inbound lane, follow the road straight, then turn once at the apron.
  TRUCK_APPROACHING: [[ROAD_LANES[0],28],[ROAD_LANES[0],15],[ROAD_LANES[0],11.5],[9,11.5],[4.4,11.5]], TRUCK_DOCKING: [[4.4,11.5],[3.8,11.5]],
  WORKER_APPROACHING: [[10,5.1],[10,10]],
  // Approach the inbound truck's rear loading edge from the east apron.
  FORKLIFT_TO_TRUCK: [[10,10],[10,11.5],[8.8,11.5]],
  // Pass through the clear front doorway (x=-4.7), turn in the yard apron (z=12.6), and enter the camera gate from the front.
  // Keeping x=-4.7 all the way through the door guarantees large clearance from the racks at x=-1.8.
  MOVE_TO_OUTBOUND: [[-4.7,-.3],[-4.7,4.5],[-4.7,8.2],[-4.7,12.6],[6,12.6],[6,9.2]],
  // Back straight out through guard bollards (z=12.6), turn onto the east apron (z=14.6), and drive straight (+X) up to the rear doors of the parked truck at [16, 10.7] (rear door at x=14.39, z=10.7).
  FORKLIFT_DELIVER_TO_TRUCK: [[6,9.2],[6,14.6],[11.6,14.6],[11.6,10.7],[12.8,10.7]],
  // Back out of receiving bay past bollards (z=12.6), move to doorway axis (x=-4.7), and drive straight through the front door into the west aisle.
  MOVE_TO_STORAGE: [[-6,9.2],[-6,12.6],[-4.7,12.6],[-4.7,8.2],[-4.7,4.5],[-4.7,-1.3]],
  IN_TRANSIT: [[16,10.7],[16,-10],[16,-28]],
  DESTINATION_ARRIVAL: [[16,-12.5],[9,-12.5],[4.4,-12.5],[3.8,-12.5]],
  IOT_CAMERA_SIMULATED: [[8.8,11.5],[8.8,14.2],[-6,14.2],[-6,9.2]],
  IOT_CAMERA_IN_SIMULATED: [[1.2,-26],[0,-27],[-5.5,-27]],
};
type GridNode = { x: number; z: number; g: number; f: number };
const PICKUP_START: [number,number] = [0,11.8];
const PICKUP_STAGING: [number,number] = [-4.7,-.3];
const transferPickupRoute: [number, number][] = [
  [0, 11.8],
  [0, 8.8],
  [-4.7, 8.8],
  [-4.7, 6.8],
  [-4.7, 4.5],
  [-4.7, -0.3],
];
function smoothstep(a: number, b: number, x: number) { const t = THREE.MathUtils.clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
/** Frame-rate independent shortest-path angle damping (prevents heading snaps at waypoints). */
function dampAngle(current: number, target: number, lambda: number, delta: number) {
  const diff = Math.atan2(Math.sin(target-current), Math.cos(target-current));
  return current + diff*(1-Math.exp(-lambda*delta));
}
/** Smooth, clearance-conscious turns and distance-based motion. */
function sampleRoute(points: [number, number][], progress: number, corner = .4) {
  if (points.length < 2) return { x: points[0]?.[0] ?? 0, z: points[0]?.[1] ?? 0, dx: 0, dz: -1 };
  const path: THREE.Vector3[] = [new THREE.Vector3(points[0][0], 0, points[0][1])];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = new THREE.Vector3(points[i - 1][0], 0, points[i - 1][1]);
    const turn = new THREE.Vector3(points[i][0], 0, points[i][1]);
    const next = new THREE.Vector3(points[i + 1][0], 0, points[i + 1][1]);
    const radius = Math.min(corner, prev.distanceTo(turn) * .32, next.distanceTo(turn) * .32);
    const before = turn.clone().add(prev.clone().sub(turn).normalize().multiplyScalar(radius));
    const after = turn.clone().add(next.clone().sub(turn).normalize().multiplyScalar(radius));
    path.push(before);
    for (let s = 1; s <= 6; s++) {
      const t = s / 6;
      path.push(before.clone().multiplyScalar((1-t)*(1-t)).add(turn.clone().multiplyScalar(2*(1-t)*t)).add(after.clone().multiplyScalar(t*t)));
    }
  }
  path.push(new THREE.Vector3(points.at(-1)![0], 0, points.at(-1)![1]));
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = lengths.at(-1)!;
  const atDistance = (distance: number) => {
    const target = THREE.MathUtils.clamp(distance, 0, total);
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < target) i++;
    const t = (target - lengths[i - 1]) / Math.max(.0001, lengths[i] - lengths[i - 1]);
    return path[i - 1].clone().lerp(path[i], t);
  };
  const target = THREE.MathUtils.clamp(progress, 0, 1) * total;
  const p = atDistance(target);
  // WareTrack uses a short axle chord for heading, which prevents the body snapping at each waypoint.
  const rear = atDistance(target - .42), front = atDistance(target + .42);
  const chord = front.sub(rear).normalize();
  return { x: p.x, z: p.z, dx: chord.x, dz: chord.z };
}

function Label({ children, position, color = '#173d5b', size = .28 }: { children: string; position: [number,number,number]; color?: string; size?: number }) {
  return <Billboard position={position}><Text font="/fonts/ibm-plex-sans.ttf" fontSize={size} color={color} outlineWidth={0.025} outlineColor="white" anchorX="center" anchorY="middle" maxWidth={5}>{children}</Text></Billboard>;
}
const RACK_POST_GEO = new THREE.BoxGeometry(0.11, 4, 0.11);
const RACK_BEAM_GEO = new THREE.BoxGeometry(3.3, 0.11, 1.05);
const RACK_BRACKET_GEO = new THREE.BoxGeometry(0.1, 0.32, 1.02);
const RACK_BOX_GEO = new THREE.BoxGeometry(0.86, 0.47, 0.72);
const RACK_LABEL_GEO = new THREE.BoxGeometry(0.32, 0.18, 0.012);

const RACK_POST_MAT = new THREE.MeshStandardMaterial({ color: '#1e3a8a', metalness: 0.42, roughness: 0.38 });
const RACK_BEAM_MAT = new THREE.MeshStandardMaterial({ color: '#f97316', metalness: 0.22, roughness: 0.42 });
const RACK_LABEL_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const RACK_BOX_MATS = {
  blue: new THREE.MeshStandardMaterial({ color: '#0284c7', roughness: 0.65, metalness: 0.08 }),
  white: new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.72 }),
  cardboard: new THREE.MeshStandardMaterial({ color: '#d4a373', roughness: 0.74 }),
  selected: new THREE.MeshStandardMaterial({ color: '#2dd4bf', roughness: 0.45, emissive: '#0d9488', emissiveIntensity: 0.45 }),
};

function Rack({ x, z, items, onSelect, selectedItemId }: { x: number; z: number; items: Inventory[]; onSelect: (item: Inventory) => void; selectedItemId?: string }) {
  return <group position={[x,0,z]}>
    {[-1.55,1.55].flatMap(px=>[-.48,.48].map(pz=><mesh key={`${px}-${pz}`} position={[px,2,pz]} geometry={RACK_POST_GEO} material={RACK_POST_MAT}/>))}
    {[0,1,2,3].map((level) => <group key={level} position={[0,.72+level*.86,0]}>
      <mesh position={[0,0,0]} geometry={RACK_BEAM_GEO} material={RACK_BEAM_MAT}/>
      {[-1.48,1.48].map(px=><mesh key={px} position={[px,-.05,0]} geometry={RACK_BRACKET_GEO} material={RACK_POST_MAT}/>)}
      {Array.from({length:3},(_,slot)=>items.length ? items[(level*3+slot)%items.length] : null).map((item,i)=>item&&<group key={`${item.id}-${i}`} position={[-1.08+i*1.08,.26,0]} onClick={(e)=>{e.stopPropagation();onSelect(item)}}>
        <mesh geometry={RACK_BOX_GEO} material={item.id===selectedItemId ? RACK_BOX_MATS.selected : RACK_BOX_MATS[packagingFor(item.sku.product.name)]}/>
        <mesh position={[0,0,.366]} geometry={RACK_LABEL_GEO} material={RACK_LABEL_MAT}/>
      </group>)}
    </group>)}
  </group>;
}
function speedScale(raw = 1) { return raw === 1.5 ? 1.6 : raw === 2 ? 2.2 : raw; }
function vehicleSpeedScale(raw = 1) { return raw === 1.5 ? 2.4 : raw === 2 ? 4 : raw; }
function AccessDoor({ state, alert, phase, speedMultiplier = 1, onSelect, onComplete }: { state: 'OPEN' | 'CLOSED' | 'UNKNOWN'; alert: boolean; phase: AccessPhase; speedMultiplier?: number; onSelect?: () => void; onComplete?: (phase: AccessPhase) => void }) {
  const curtain = useRef<THREE.Group>(null), drum = useRef<THREE.Mesh>(null);
  const amount = useRef(state === 'OPEN' ? 1 : 0), velocity = useRef(0);
  const reported = useRef<AccessPhase | null>(null);
  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;
  useEffect(() => { reported.current = null; }, [phase]);
  useFrame((_, delta) => {
    const target = state === 'OPEN' ? 1 : 0;
    // When not running a door-access simulation (phase === 'IDLE'), open rapidly so vehicles never hit a half-lowered shutter.
    const dt = Math.min(delta, .05);
    const speed = speedScale(speedRef.current);
    const motorRate = (phase === 'IDLE' && target === 1 ? 1.8 : 0.45) * speed;
    if (amount.current < target) {
      amount.current = Math.min(target, amount.current + motorRate * dt);
    } else if (amount.current > target) {
      amount.current = Math.max(target, amount.current - motorRate * dt);
    }
    if (curtain.current) {
      curtain.current.scale.y = Math.max(0.035, 1 - amount.current * 0.965);
    }
    if (drum.current) {
      drum.current.rotation.x = amount.current * Math.PI * 6;
    }
    if (reported.current !== phase && Math.abs(amount.current - target) < .01 && ((phase === 'OPENING' && target === 1) || (phase === 'CLOSING' && target === 0))) {
      reported.current = phase; onComplete?.(phase);
    }
  });
  const checkpoint = alert ? '#e4534c' : phase === 'SCANNING' || phase === 'VERIFYING' ? '#efba45' : ['GRANTED','OPENING','ENTERING','WAITING_CLOSE','WAITING_ALERT'].includes(phase) || state === 'OPEN' ? '#28b780' : '#0d9488';
  const slatCount = 7;
  return <group position={[0, 0, 6.82]} onClick={event => { event.stopPropagation(); onSelect?.(); }} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    {/* Heavy-duty vertical side guide tracks for the front roller shutter */}
    {[-6.46, 6.46].map(x => <mesh key={`guide-${x}`} position={[x, 1.82, 0.08]} castShadow><boxGeometry args={[0.18, 3.64, 0.28]}/><meshStandardMaterial color={alert ? '#b84e46' : '#243f4b'} roughness={0.5} metalness={0.35}/></mesh>)}
    {/* Overhead roller drum inside the front portal header */}
    <mesh ref={drum} position={[0, 3.66, 0.06]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.16, 0.16, 12.76, 12]}/><meshStandardMaterial color="#47626e" metalness={0.55} roughness={0.38}/></mesh>
    {/* Glowing LED status strip across the front portal header */}
    <mesh position={[0, 3.88, 0.26]}><boxGeometry args={[12.8, 0.1, 0.04]}/><meshBasicMaterial color={checkpoint}/></mesh>
    {/* Reed Switch magnetic door sensor mounted at top-left of the roller frame */}
    <mesh position={[-5.95, 3.5, 0.25]}><boxGeometry args={[0.38, 0.11, 0.1]}/><meshStandardMaterial color={state === 'OPEN' ? '#efba45' : '#28b780'} emissive={state === 'OPEN' ? '#efba45' : '#28b780'} emissiveIntensity={0.55}/></mesh>
    {/* Safety yellow-black threshold line across the front entrance */}
    <mesh position={[0, 0.014, 0.18]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[12.76, 0.42]}/><meshBasicMaterial color={alert ? '#e4534c' : '#f59e0b'} transparent opacity={0.65}/></mesh>
    {/* Motorised vertical roller-shutter curtain anchored at top header (y = 3.62) */}
    <group ref={curtain} position={[0, 3.62, 0.06]}>
      {/* Main metallic backing sheet */}
      <mesh position={[0, -1.81, 0]} castShadow receiveShadow>
        <boxGeometry args={[12.76, 3.58, 0.09]}/>
        <meshStandardMaterial color={alert ? '#d9776c' : '#8fa6b2'} roughness={0.46} metalness={0.42}/>
      </mesh>
      {/* Horizontal ribbed industrial roller slats */}
      {Array.from({ length: slatCount }, (_, i) => {
        const y = -0.26 - i * (3.1 / slatCount);
        return <mesh key={`slat-${i}`} position={[0, y, 0]}>
          <boxGeometry args={[12.72, 0.22, 0.13]}/>
          <meshStandardMaterial color={alert ? '#c85a4f' : i % 2 === 0 ? '#b8c9d1' : '#9fb4be'} roughness={0.42} metalness={0.48}/>
        </mesh>;
      })}
      {/* Glazed vision strip across eye level */}
      <mesh position={[0, -1.48, 0]}>
        <boxGeometry args={[11.2, 0.28, 0.15]}/>
        <meshStandardMaterial color="#d8f5f1" transparent opacity={0.78} emissive="#38bdf8" emissiveIntensity={0.12}/>
      </mesh>
      {/* Heavy bottom sealing bar with high-visibility yellow hazard stripe */}
      <mesh position={[0, -3.54, 0]}>
        <boxGeometry args={[12.78, 0.16, 0.16]}/>
        <meshStandardMaterial color={alert ? '#dc2626' : '#f59e0b'} roughness={0.45} metalness={0.25}/>
      </mesh>
    </group>
    {/* RFID + Reed Switch access control pedestal stationed at the left front column */}
    <group position={[-7.25, 0, 0.62]}>
      <mesh position={[0, 0.58, 0]} castShadow><boxGeometry args={[0.22, 1.16, 0.22]}/><meshStandardMaterial color="#1e3a46" metalness={0.35} roughness={0.5}/></mesh>
      <mesh position={[0, 1.28, 0.06]} castShadow><boxGeometry args={[0.52, 0.68, 0.26]}/><meshStandardMaterial color="#18333d" roughness={0.45}/></mesh>
      <mesh position={[0, 1.44, 0.2]}><boxGeometry args={[0.36, 0.18, 0.025]}/><meshBasicMaterial color={checkpoint}/></mesh>
      <mesh position={[0, 1.16, 0.2]}><boxGeometry args={[0.3, 0.22, 0.025]}/><meshStandardMaterial color="#e6f7f5" emissive={checkpoint} emissiveIntensity={phase === 'SCANNING' ? 0.5 : 0.15}/></mesh>
      <Label position={[0, 1.92, 0.12]} size={0.14}>RFID · REED SWITCH</Label>
    </group>
    <Label position={[3.8, 3.88, 0.48]} size={0.18} color={alert ? '#b23930' : '#0f5257'}>{alert ? 'CẢNH BÁO · CỬA KHO' : phase === 'OPENING' ? 'ĐANG MỞ · CỬA KHO' : phase === 'CLOSING' ? 'ĐANG ĐÓNG · CỬA KHO' : state === 'OPEN' ? 'ĐANG MỞ · CỬA KHO' : 'CỬA KHO ĐANG ĐÓNG'}</Label>
  </group>;
}
function WarehouseEmployee({ phase, doorOpen, employeeName, speedMultiplier = 1, onComplete, targetsRef }: { phase: AccessPhase; doorOpen: boolean; employeeName?: string; speedMultiplier?: number; onComplete?: (phase: AccessPhase) => void; targetsRef?: React.MutableRefObject<SceneTargets> }) {
  const actor = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), torso = useRef<THREE.Group>(null);
  useEffect(() => {
    if (targetsRef) targetsRef.current.employee = actor.current;
  }, [targetsRef]);
  const leftLeg = useRef<THREE.Group>(null), rightLeg = useRef<THREE.Group>(null), leftShin = useRef<THREE.Group>(null), rightShin = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null), otherArm = useRef<THREE.Group>(null), head = useRef<THREE.Group>(null);
  const elapsed = useRef(0), reported = useRef(false), entered = useRef(false);
  const speed = useRef(0), gait = useRef(0), stride = useRef(0);
  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;
  const target = useMemo(() => new THREE.Vector3(), []), offset = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    elapsed.current = 0;
    reported.current = false;
    if (phase === 'APPROACH' || phase === 'IDLE' || phase === 'WAITING_REAL') {
      entered.current = false;
      if (actor.current && actor.current.position.z < 7.5) {
        actor.current.position.set(-7.25, 0, 10.6);
        actor.current.rotation.y = Math.PI;
      }
    }
  }, [phase]);
  useFrame(({ clock }, rawDelta) => {
    const sp = speedScale(speedRef.current);
    const delta = Math.min(rawDelta, .05) * sp; elapsed.current += delta;
    if (!actor.current) return;
    // Wait in the front yard facing the main roller-shutter entrance.
    target.set(-7.25, 0, 10.6);
    if (phase !== 'IDLE' && phase !== 'WAITING_REAL') target.set(-7.25, 0, 8.05);
    if ((['ENTERING','WAITING_CLOSE','WAITING_ALERT'].includes(phase) || entered.current) && doorOpen) {
      // Step sideways to clear the front portal column, then walk straight through the main roller shutter door.
      if (Math.abs(actor.current.position.x - -4.6) > .12 && actor.current.position.z > 6.8) target.set(-4.6, 0, 8.05);
      else target.set(-4.6, 0, 4.2);
      if (actor.current.position.z < 5.8) entered.current = true;
    } else if (entered.current) target.set(-4.6, 0, 4.2);
    // A closed roller shutter never permits walking through the front entrance.
    if (!doorOpen && actor.current.position.z > 7.2 && target.z < 7.2) target.set(-4.6, 0, 7.85);
    offset.copy(target).sub(actor.current.position);
    const distance = offset.length();
    const moving = distance > .025;
    // Human-like locomotion: ~1.35 m/s cruise, accelerate from rest, decelerate before stopping.
    const desired = moving ? Math.min(1.35, Math.sqrt(2 * 1.6 * distance)) : 0;
    speed.current = THREE.MathUtils.damp(speed.current, desired, 6, delta);
    if (moving) {
      const step = Math.min(distance, speed.current * delta);
      actor.current.position.addScaledVector(offset.normalize(), step);
      stride.current += step;
      actor.current.rotation.y = dampAngle(actor.current.rotation.y, Math.atan2(offset.x, offset.z), 9, delta);
    } else if (phase === 'SCANNING' || phase === 'VERIFYING' || phase === 'IDLE' || phase === 'WAITING_REAL') {
      actor.current.rotation.y = dampAngle(actor.current.rotation.y, Math.PI, 7, delta);
    }
    // Gait phase follows travelled distance (≈0.7 m per step), so feet never slide.
    gait.current = stride.current / .7 * Math.PI;
    const walk = THREE.MathUtils.clamp(speed.current / 1.35, 0, 1);
    const swing = Math.sin(gait.current) * .5 * walk;
    const knee = (s: number) => Math.max(0, Math.sin(gait.current + s)) * .75 * walk;
    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    if (leftShin.current) leftShin.current.rotation.x = knee(Math.PI);
    if (rightShin.current) rightShin.current.rotation.x = knee(0);
    // Vertical bob twice per stride, slight lean forward and torso twist; idle breathing when still.
    const breathe = Math.sin(clock.elapsedTime * 1.8) * .012 * (1 - walk);
    if (body.current) { body.current.position.y = Math.abs(Math.cos(gait.current)) * .045 * walk + breathe; body.current.rotation.x = .06 * walk; }
    if (torso.current) torso.current.rotation.y = -swing * .18;
    if (head.current) head.current.rotation.y = swing * .12 + (phase === 'VERIFYING' ? Math.sin(clock.elapsedTime * 1.2) * .08 : 0);
    const scanning = phase === 'SCANNING';
    if (arm.current) arm.current.rotation.x = THREE.MathUtils.damp(arm.current.rotation.x, scanning ? -1.35 : -swing * .85, scanning ? 7 : 12, delta);
    if (otherArm.current) otherArm.current.rotation.x = THREE.MathUtils.damp(otherArm.current.rotation.x, swing * .85, 12, delta);
    // ENTERING completes as soon as the employee clears the front roller shutter (z < 6.0).
    const enteredDoor = actor.current ? actor.current.position.z < 6.0 : false;
    if (enteredDoor && !entered.current && phase !== 'CLOSING' && phase !== 'COMPLETE') entered.current = true;
    const done = phase === 'APPROACH' ? distance < .03 : phase === 'GRANTED' ? elapsed.current > .7 : phase === 'ENTERING' ? entered.current : false;
    if (done && !reported.current) { reported.current = true; onComplete?.(phase); }
  });
  const uniform = '#4fb8b0', trousers = '#2c4a57', skin = '#d2a07e';
  return <group ref={actor} position={[-7.25, 0, 10.6]} rotation={[0, Math.PI, 0]}>
    <group ref={body}>
      {[-1,1].map(side => <group key={side} ref={side < 0 ? leftLeg : rightLeg} position={[side*.13,.92,0]}>
        <mesh position={[0,-.22,0]} castShadow><boxGeometry args={[.16,.44,.18]}/><meshStandardMaterial color={trousers} roughness={.85}/></mesh>
        <group ref={side < 0 ? leftShin : rightShin} position={[0,-.44,0]}>
          <mesh position={[0,-.21,0]} castShadow><boxGeometry args={[.14,.42,.16]}/><meshStandardMaterial color={trousers} roughness={.85}/></mesh>
          <mesh position={[0,-.44,.05]} castShadow><boxGeometry args={[.16,.1,.28]}/><meshStandardMaterial color="#1d2a30" roughness={.6}/></mesh>
        </group>
      </group>)}
      <group ref={torso} position={[0,1.22,0]}>
        <mesh castShadow><boxGeometry args={[.5,.66,.28]}/><meshStandardMaterial color={uniform} roughness={.75}/></mesh>
        {/* High-visibility safety vest stripes */}
        {[.12,-.12].map(y => <mesh key={y} position={[0,y,.146]}><boxGeometry args={[.48,.045,.01]}/><meshStandardMaterial color="#f4f1d0" emissive="#f4f1d0" emissiveIntensity={.25}/></mesh>)}
        <mesh position={[.14,.18,.148]}><boxGeometry args={[.1,.07,.01]}/><meshStandardMaterial color="#ffffff"/></mesh>
        <group ref={arm} position={[-.32,.27,0]}>
          <mesh position={[0,-.29,0]} castShadow><boxGeometry args={[.13,.58,.14]}/><meshStandardMaterial color={uniform} roughness={.75}/></mesh>
          <mesh position={[0,-.61,0]} castShadow><sphereGeometry args={[.068,10,8]}/><meshStandardMaterial color={skin} roughness={.6}/></mesh>
          {/* RFID card in hand */}
          <mesh position={[0,-.65,.08]} rotation={[-.3,0,0]}><boxGeometry args={[.14,.09,.01]}/><meshStandardMaterial color="#fff9e8" emissive="#65cfc7" emissiveIntensity={phase === 'SCANNING' ? .6 : 0}/></mesh>
        </group>
        <group ref={otherArm} position={[.32,.27,0]}>
          <mesh position={[0,-.29,0]} castShadow><boxGeometry args={[.13,.58,.14]}/><meshStandardMaterial color={uniform} roughness={.75}/></mesh>
          <mesh position={[0,-.61,0]} castShadow><sphereGeometry args={[.068,10,8]}/><meshStandardMaterial color={skin} roughness={.6}/></mesh>
        </group>
        <group ref={head} position={[0,.5,0]}>
          <mesh position={[0,-.08,0]}><cylinderGeometry args={[.07,.08,.1,10]}/><meshStandardMaterial color={skin}/></mesh>
          <mesh position={[0,.1,0]} castShadow><sphereGeometry args={[.17,14,12]}/><meshStandardMaterial color={skin} roughness={.55}/></mesh>
          {/* Safety helmet */}
          <mesh position={[0,.17,0]} castShadow><sphereGeometry args={[.19,14,10,0,Math.PI*2,0,Math.PI/2]}/><meshStandardMaterial color="#f2b632" roughness={.35}/></mesh>
          <mesh position={[0,.17,.05]}><cylinderGeometry args={[.21,.21,.02,14]}/><meshStandardMaterial color="#e3a520" roughness={.4}/></mesh>
        </group>
      </group>
    </group>
    <Label position={[0,2.35,0]} size={.15} color="#16424a">{employeeName ? `${employeeName.toUpperCase()} · THẺ RFID` : 'NHÂN VIÊN · THẺ RFID'}</Label>
  </group>;
}
function IndoorWarehouseWorker({ paused }: { paused: boolean }) {
  const actor = useRef<THREE.Group>(null), leftLeg = useRef<THREE.Group>(null), rightLeg = useRef<THREE.Group>(null), arm = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (paused || !actor.current) return;
    const t = clock.elapsedTime * 0.55;
    const cycle = Math.sin(t);
    const walking = Math.abs(Math.cos(t)) > 0.25;
    actor.current.position.set(0.2, 0, -1.25 + cycle * 2.2);
    actor.current.rotation.y = Math.cos(t) >= 0 ? 0 : Math.PI;
    const swing = walking ? Math.sin(clock.elapsedTime * 4.6) * 0.36 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    if (arm.current) arm.current.rotation.x = -0.55 + Math.sin(clock.elapsedTime * 2.4) * 0.08;
  });
  const uniform = '#2563eb', trousers = '#1e293b', skin = '#d2a07e';
  return <group ref={actor} position={[0.2, 0, -1.25]}>
    {[-1, 1].map(side => <group key={side} ref={side < 0 ? leftLeg : rightLeg} position={[side * 0.13, 0.92, 0]}>
      <mesh position={[0, -0.42, 0]} castShadow><boxGeometry args={[0.15, 0.84, 0.17]}/><meshStandardMaterial color={trousers} roughness={0.85}/></mesh>
    </group>)}
    <group position={[0, 1.22, 0]}>
      <mesh castShadow><boxGeometry args={[0.48, 0.64, 0.27]}/><meshStandardMaterial color={uniform} roughness={0.75}/></mesh>
      {[0.11, -0.11].map(y => <mesh key={y} position={[0, y, 0.14]}><boxGeometry args={[0.46, 0.045, 0.01]}/><meshStandardMaterial color="#fde047" emissive="#fde047" emissiveIntensity={0.22}/></mesh>)}
      <group ref={arm} position={[0.31, 0.24, 0]}>
        <mesh position={[0, -0.26, 0]} castShadow><boxGeometry args={[0.12, 0.52, 0.13]}/><meshStandardMaterial color={uniform}/></mesh>
        <mesh position={[0, -0.54, 0.1]} rotation={[-0.4, 0, 0]}><boxGeometry args={[0.18, 0.22, 0.02]}/><meshStandardMaterial color="#f8fafc" emissive="#38bdf8" emissiveIntensity={0.2}/></mesh>
      </group>
      <group position={[-0.31, 0.24, 0]}>
        <mesh position={[0, -0.26, 0]} castShadow><boxGeometry args={[0.12, 0.52, 0.13]}/><meshStandardMaterial color={uniform}/></mesh>
      </group>
      <group position={[0, 0.48, 0]}>
        <mesh position={[0, 0.1, 0]} castShadow><sphereGeometry args={[0.16, 12, 10]}/><meshStandardMaterial color={skin}/></mesh>
        <mesh position={[0, 0.17, 0]} castShadow><sphereGeometry args={[0.18, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2]}/><meshStandardMaterial color="#38bdf8" roughness={0.35}/></mesh>
      </group>
    </group>
    <Label position={[0, 2.28, 0]} size={0.135} color="#1e3a8a">NV KHO · KIỂM KỆ</Label>
  </group>;
}
const TRUCK_STATES = new Set<DemoState>(['TRUCK_APPROACHING', 'TRUCK_DOCKING', 'DOCKED', 'TRUCK_UNLOADING', 'IN_TRANSIT', 'DESTINATION_ARRIVAL']);
const DEST_FORK_STATES = new Set<DemoState>(['DESTINATION_PALLET_PICKUP', 'IOT_CAMERA_IN_SIMULATED', 'WAITING_RECEIVE_CONFIRM', 'RECEIVED', 'MOVE_TO_STORAGE', 'STORED']);
const CAMERA_GATE_STATES = new Set<DemoState>(['IOT_CAMERA_SIMULATED', 'WAITING_CONFIRMATION', 'GOODS_RECEIVED', 'IOT_CAMERA_OUT_SIMULATED', 'IOT_CAMERA_IN_SIMULATED', 'WAITING_RECEIVE_CONFIRM']);
const ACTIVE_ACCESS_PHASES = new Set<AccessPhase>(['APPROACH', 'SCANNING', 'VERIFYING', 'GRANTED', 'OPENING', 'ENTERING', 'WAITING_CLOSE', 'CLOSING']);

function SceneCameraDirector({
  phase,
  demoState,
  transferMode,
  campusCount,
  targetsRef,
}: {
  focus: boolean;
  phase: AccessPhase;
  demoState: DemoState;
  transferMode: boolean;
  campusCount: number;
  targetsRef: React.MutableRefObject<SceneTargets>;
}) {
  const camera = useThree(state => state.camera);
  const gl = useThree(state => state.gl);
  const controls = useThree(state => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  const returningToOverview = useRef(false);
  const wasTracking = useRef(false);
  const userInteractingUntil = useRef(0);
  const desiredTarget = useMemo(() => new THREE.Vector3(), []);
  const desiredPos = useMemo(() => new THREE.Vector3(), []);

  // Only follow automatically when a demo animation is actively moving. Never lock the camera while idle!
  const accessActive = ACTIVE_ACCESS_PHASES.has(phase);
  const demoActive = demoState !== 'IDLE' && demoState !== 'COMPLETE';
  const tracking = accessActive || demoActive;

  useEffect(() => {
    const dom = gl.domElement;
    const onUserInteract = () => {
      returningToOverview.current = false;
      userInteractingUntil.current = performance.now() + 2200;
    };
    dom.addEventListener('pointerdown', onUserInteract, { passive: true });
    dom.addEventListener('wheel', onUserInteract, { passive: true });
    return () => {
      dom.removeEventListener('pointerdown', onUserInteract);
      dom.removeEventListener('wheel', onUserInteract);
    };
  }, [gl]);

  useEffect(() => {
    if (wasTracking.current && !tracking) {
      returningToOverview.current = true;
    }
    if (tracking) {
      returningToOverview.current = false;
    }
    wasTracking.current = tracking;
  }, [tracking]);

  useFrame((_, delta) => {
    if (!tracking && !returningToOverview.current) return;
    if (performance.now() < userInteractingUntil.current) return;

    if (accessActive) {
      const emp = targetsRef.current.employee?.position;
      const ex = emp ? emp.x : -6.5;
      const ez = emp ? emp.z : 8.2;
      const checkpoint = ['SCANNING', 'VERIFYING', 'GRANTED', 'OPENING'].includes(phase);
      desiredTarget.set((ex + -2.5) * 0.5, 1.85, (ez + 6.8) * 0.5);
      desiredPos.set(ex - (checkpoint ? 5.8 : 7.5), checkpoint ? 6.2 : 7.8, ez + (checkpoint ? 9.2 : 11.5));
    } else if (demoActive) {
      if (TRUCK_STATES.has(demoState) && targetsRef.current.truck) {
        const tp = targetsRef.current.truck.position;
        desiredTarget.set(tp.x - 1.2, 1.4, tp.z - 0.4);
        desiredPos.set(tp.x + 14.5, 12.2, tp.z + 15.5);
      } else if (transferMode && DEST_FORK_STATES.has(demoState) && targetsRef.current.destinationFork) {
        const dfp = targetsRef.current.destinationFork.position;
        const closeGate = CAMERA_GATE_STATES.has(demoState);
        desiredTarget.set(dfp.x, 1.35, dfp.z);
        desiredPos.set(dfp.x + (closeGate ? 10.2 : 12.2), closeGate ? 9.2 : 11.0, dfp.z + (closeGate ? 11.2 : 13.2));
      } else if (targetsRef.current.fork) {
        const fp = targetsRef.current.fork.position;
        const closeGate = CAMERA_GATE_STATES.has(demoState);
        desiredTarget.set(fp.x, 1.35, fp.z);
        desiredPos.set(fp.x + (closeGate ? 10.2 : 12.2), closeGate ? 9.2 : 11.0, fp.z + (closeGate ? 11.2 : 13.2));
      } else {
        desiredTarget.set(0, 0, campusCount > 1 ? -12 * (campusCount - 1) : 2);
        desiredPos.set(campusCount > 1 ? 34 : 26, campusCount > 1 ? 36 : 24, campusCount > 1 ? 22 : 32);
      }
    } else {
      desiredTarget.set(0, 0, campusCount > 1 ? -12 * (campusCount - 1) : 2);
      desiredPos.set(campusCount > 1 ? 34 : 26, campusCount > 1 ? 36 : 24, campusCount > 1 ? 22 : 32);
    }

    const alpha = 1 - Math.exp(-3.6 * Math.min(delta, 0.08));
    camera.position.lerp(desiredPos, alpha);
    controls?.target.lerp(desiredTarget, alpha);
    controls?.update();

    if (
      returningToOverview.current &&
      camera.position.distanceTo(desiredPos) < 0.25 &&
      (!controls || controls.target.distanceTo(desiredTarget) < 0.25)
    ) {
      returningToOverview.current = false;
    }
  });
  return null;
}
function Warehouse({ site, index, onSelectItem, selectedItemId, onSelectZone, selectedZone, activeSite, demoState, paused, accessDoorState, accessAlert, onSelectDoor, accessEmployeePhase, accessEmployeeName, onAccessMotionComplete, speedMultiplier, targetsRef, transferMode }: { site: Site; index: number; onSelectItem: (item: Inventory)=>void; selectedItemId?: string; onSelectZone: (zone:string)=>void; selectedZone:string; activeSite:boolean; demoState:DemoState; paused:boolean; accessDoorState?: 'OPEN' | 'CLOSED' | 'UNKNOWN'; accessAlert?: boolean; onSelectDoor?: () => void; accessEmployeePhase?: AccessPhase; accessEmployeeName?: string; onAccessMotionComplete?: (phase: AccessPhase) => void; speedMultiplier?: number; targetsRef?: React.MutableRefObject<SceneTargets>; transferMode?: boolean }) {
  const z = -index*28;
  const stocks = site.items;
  const corrugatedTex = useMemo(() => getCorrugatedMetalTexture(8, 2), []);
  const floorTex = useMemo(() => getConcreteYardTexture(6, 5), []);
  const wallMat = <meshStandardMaterial color="#f4f7f9" map={corrugatedTex ?? undefined} roughness={.58} metalness={.16} />;
  const plinthMat = <meshStandardMaterial color="#1e293b" roughness={.55} metalness={.25} />;
  const fasciaMat = <meshStandardMaterial color={activeSite ? '#0f766e' : '#334155'} emissive={activeSite ? '#0d9488' : '#000000'} emissiveIntensity={activeSite ? 0.14 : 0} roughness={.38} metalness={.32} />;
  const effectiveDoorState: 'OPEN' | 'CLOSED' | 'UNKNOWN' = index > 0 || transferMode || (demoState !== 'IDLE' && demoState !== 'COMPLETE') || ['OPENING', 'ENTERING', 'WAITING_ALERT'].includes(accessEmployeePhase ?? 'IDLE') ? 'OPEN' : accessEmployeePhase === 'CLOSING' ? 'CLOSED' : (accessDoorState ?? 'CLOSED');
  return <group position={[0,0,z]}>
    <WarehouseDetails paused={paused}/>
    <AccessDoor state={effectiveDoorState} alert={!!accessAlert && demoState === 'IDLE'} phase={accessEmployeePhase ?? 'IDLE'} speedMultiplier={speedMultiplier} onSelect={onSelectDoor} onComplete={onAccessMotionComplete}/>
    {index===0 && <WarehouseEmployee phase={accessEmployeePhase ?? 'IDLE'} doorOpen={effectiveDoorState === 'OPEN'} employeeName={accessEmployeeName} speedMultiplier={speedMultiplier} onComplete={onAccessMotionComplete} targetsRef={targetsRef}/>}
    <IndoorWarehouseWorker paused={paused}/>
    {/* Polished industrial concrete slab with subtle border apron & glowing active zone ring */}
    <mesh position={[0,-.24,0]} receiveShadow><boxGeometry args={[17.4,.34,14.4]}/><meshStandardMaterial color={activeSite ? '#0d9488' : '#94a3b8'} roughness={.75}/></mesh>
    <mesh position={[0,-.22,0]} receiveShadow><boxGeometry args={[16.8,.35,13.8]}/><meshStandardMaterial color="#e8eef2" map={floorTex ?? undefined} roughness={.46} metalness={.1}/></mesh>
    {/* Glowing emerald/amber safety aisle runner along the West Forklift Aisle (x = -4.7) */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-4.7, -0.042, 0.4]}>
      <planeGeometry args={[2.1, 11.4]} />
      <meshBasicMaterial color="#0d9488" transparent opacity={0.14} />
    </mesh>
    {[-5.75, -3.65].map(ax => (
      <mesh key={`aisle-line-${ax}`} rotation={[-Math.PI / 2, 0, 0]} position={[ax, -0.038, 0.4]}>
        <planeGeometry args={[0.09, 11.4]} />
        <meshBasicMaterial color="#14b8a6" transparent opacity={0.75} />
      </mesh>
    ))}
    {/* Exterior dock apron safety stripes */}
    {[-6.2, 6.2].map(sx => (
      <mesh key={`dock-stripe-${sx}`} rotation={[-Math.PI / 2, 0, 0]} position={[sx, -0.04, 10.2]}>
        <planeGeometry args={[0.14, 6.2]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.7} />
      </mesh>
    ))}
    {/* Exterior industrial walls + dark slate base plinth + teal architectural roofline fascia */}
    <mesh position={[0,2.2,-6.8]} castShadow>{/* rear wall */}<boxGeometry args={[17,4.8,.35]}/>{wallMat}</mesh>
    <mesh position={[0,.35,-6.8]}><boxGeometry args={[17.08,.72,.39]}/>{plinthMat}</mesh>
    <mesh position={[0,4.52,-6.8]}><boxGeometry args={[17.12,.26,.41]}/>{fasciaMat}</mesh>
    <mesh position={[8.3,2.2,0]} castShadow><boxGeometry args={[.35,4.8,13.6]}/>{wallMat}</mesh>
    <mesh position={[8.3,.35,0]}><boxGeometry args={[.39,.72,13.68]}/>{plinthMat}</mesh>
    <mesh position={[8.3,4.52,0]}><boxGeometry args={[.41,.26,13.72]}/>{fasciaMat}</mesh>
    <mesh position={[-8.3,2.2,0]} castShadow><boxGeometry args={[.35,4.8,13.6]}/>{wallMat}</mesh>
    <mesh position={[-8.3,.35,0]}><boxGeometry args={[.39,.72,13.68]}/>{plinthMat}</mesh>
    <mesh position={[-8.3,4.52,0]}><boxGeometry args={[.41,.26,13.72]}/>{fasciaMat}</mesh>
    {/* Overhead open steel roof trusses + industrial LED high-bay lights */}
    {[-3.6, 0, 3.6].map(tz => <group key={`truss-${tz}`} position={[0,4.56,tz]}>
      <mesh castShadow><boxGeometry args={[16.5,.12,.14]}/><meshStandardMaterial color="#486370" metalness={.55} roughness={.42}/></mesh>
      {[-5.5, 0, 5.5].map(tx => <group key={tx} position={[tx,.12,0]}>
        <mesh><boxGeometry args={[.14,.18,.14]}/><meshStandardMaterial color="#37515f" metalness={.5}/></mesh>
        <mesh position={[0,-.22,0]}><boxGeometry args={[.72,.06,.24]}/><meshStandardMaterial color="#f8fafc" emissive="#e0f2fe" emissiveIntensity={.75}/></mesh>
      </group>)}
    </group>)}
    {/* Front warehouse portal: side facade columns + overhead rolled-up shutter housing, keeping the lower aisle 100% open for forklifts. */}
    {[-7.55,7.55].map(x => <group key={`front-col-${x}`}>
      <mesh position={[x,2.2,6.8]} castShadow><boxGeometry args={[1.85,4.8,.35]}/>{wallMat}</mesh>
      <mesh position={[x,.35,6.8]}><boxGeometry args={[1.89,.72,.39]}/>{plinthMat}</mesh>
    </group>)}
    <mesh position={[0,4.25,6.8]} castShadow><boxGeometry args={[13.25,.7,.35]}/>{wallMat}</mesh>
    <mesh position={[0,4.52,6.8]}><boxGeometry args={[17.12,.26,.41]}/>{fasciaMat}</mesh>
    <mesh position={[0,3.72,6.82]} castShadow><boxGeometry args={[13.1,.38,.44]}/><meshStandardMaterial color="#2f4d5c" roughness={.5} metalness={.3}/></mesh>
    {[-6.55,6.55].map(x => <group key={`bay-jamb-${x}`}>
      <mesh position={[x,1.8,6.82]}><boxGeometry args={[.16,3.6,.4]}/><meshStandardMaterial color="#2f4d5c" roughness={.55}/></mesh>
      <mesh position={[x,.42,7.05]} castShadow><cylinderGeometry args={[.1,.12,.84,10]}/><meshStandardMaterial color="#f59e0b" roughness={.45}/></mesh>
    </group>)}
    <Billboard position={[0,5.9,6.98]}>
      <mesh position={[0,0,-.02]}><boxGeometry args={[6.44,.98,.1]}/><meshStandardMaterial color={activeSite ? '#0f766e' : '#334155'} roughness={.4}/></mesh>
      <mesh position={[0,0,0]}><boxGeometry args={[6.24,.82,.12]}/><meshStandardMaterial color="#ffffff" roughness={.6}/></mesh>
      <mesh position={[-2.94,0,.07]}><boxGeometry args={[.14,.62,.02]}/><meshBasicMaterial color={activeSite ? '#14b8a6' : '#64748b'}/></mesh>
      <Text font="/fonts/ibm-plex-sans.ttf" position={[0,.13,.085]} fontSize={.26} color="#0f172a" anchorX="center" anchorY="middle" maxWidth={5.6}>{site.name}</Text>
      <Text font="/fonts/ibm-plex-sans.ttf" position={[0,-.17,.085]} fontSize={.13} color="#0f766e" anchorX="center" anchorY="middle" maxWidth={5.6}>{`${site.storeName} · ${site.code}`}</Text>
    </Billboard>
    {/* Two dense rack banks leave the west aisle clear for the camera-to-storage forklift route. */}
    {[-3,.5].map((rackZ,row)=>[-1.8,2.2,6.2].map((rackX,col)=><Rack key={`${row}-${col}`} x={rackX} z={rackZ} items={stocks.slice(row*3+col).concat(stocks.slice(0,row*3+col))} onSelect={onSelectItem} selectedItemId={selectedItemId}/>))}
    {!activeSite&&demoState==='IDLE'&&<ParkedForklift position={[10,0,5.1]}/>}
    <CameraGate x={-6} z={9.2} zone="receiving" selected={selectedZone==='receiving'} active={activeSite&&['WAITING_CONFIRMATION','IOT_CAMERA_SIMULATED','IOT_CAMERA_IN_SIMULATED'].includes(demoState)} onSelect={onSelectZone}/>
    <CameraGate x={6} z={9.2} zone="shipping" selected={selectedZone==='shipping'} active={activeSite&&demoState==='IOT_CAMERA_OUT_SIMULATED'} onSelect={onSelectZone}/>
    {stocks.length===0 && <Label position={[0,.4,0]} size={.28}>Chưa có tồn kho</Label>}
  </group>;
}
function ParkedForklift({position}:{position:[number,number,number]}){
  const lift=useRef<THREE.Group>(null);const driver=useRef<THREE.Group>(null);const wheel=useRef<THREE.Mesh>(null);
  return <group position={position}><ForkliftVehicle liftRef={lift} driverRef={driver} steeringRef={wheel}/></group>;
}
function CameraGate({x,z,zone,selected,active,onSelect}:{x:number;z:number;zone:'receiving'|'shipping';selected:boolean;active:boolean;onSelect:(zone:string)=>void}){
  const led=useRef<THREE.Mesh>(null); const ring=useRef<THREE.Mesh>(null);
  const receiving=zone==='receiving';
  const accent=receiving?'#65CFC7':'#e88b20';
  const title=receiving?'NHẬP · ESP32-CAM':'XUẤT · ESP32-CAM';
  useFrame(({clock})=>{const pulse=(Math.sin(clock.elapsedTime*4)+1)/2;if(led.current){const material=led.current.material as THREE.MeshBasicMaterial;material.color.set(active?accent:selected?accent:'#7897a8');material.opacity=active?.72+pulse*.28:.85;}if(ring.current){ring.current.scale.setScalar(active?1+pulse*.08:1);const material=ring.current.material as THREE.MeshBasicMaterial;material.color.set(active?accent:selected?accent:'#79bbca');material.opacity=active?.35+pulse*.25:selected?.58:.18;}});
  return <group position={[x,0,z]} onClick={()=>onSelect(zone)}>
    <mesh position={[-1.75,1.7,-1.55]} castShadow><boxGeometry args={[.18,3.4,.18]}/><meshStandardMaterial color="#526c7b" metalness={.4}/></mesh>
    <mesh position={[-.875,3.4,-1.55]} castShadow><boxGeometry args={[1.9,.14,.14]}/><meshStandardMaterial color="#526c7b" metalness={.4}/></mesh>
    <mesh position={[-1.75,.12,-1.55]} receiveShadow><boxGeometry args={[.65,.24,.65]}/><meshStandardMaterial color="#77858b"/></mesh>
    <mesh position={[-1.75,1.35,-1.35]} castShadow><boxGeometry args={[.55,.7,.28]}/><meshStandardMaterial color="#e5ebea"/></mesh>
    <mesh position={[-1.75,1.4,-1.2]}><planeGeometry args={[.38,.32]}/><meshBasicMaterial color={active?accent:'#304b59'}/></mesh>
    {[-1,1].map(side=><group key={`guard-${side}`} position={[side*1.9,0,.8]}>
      <mesh position={[0,.4,0]} castShadow><cylinderGeometry args={[.09,.12,.8,10]}/><meshStandardMaterial color="#efbc42"/></mesh>
      <mesh position={[0,.52,0]}><cylinderGeometry args={[.094,.1,.15,10]}/><meshStandardMaterial color="#34434b"/></mesh>
    </group>)}
    {/* Camera housing and lens aimed at the parcel inspection area. */}
    <group position={[0,3.45,-1.55]}>
      <mesh position={[0,0,-.08]} castShadow><boxGeometry args={[.14,.14,.25]}/><meshStandardMaterial color="#526c7b" metalness={.35}/></mesh>
      <mesh position={[0,0,.68]} castShadow><boxGeometry args={[.1,.1,1.48]}/><meshStandardMaterial color="#526c7b" metalness={.35}/></mesh>
      <mesh position={[0,-.18,1.32]} castShadow><boxGeometry args={[.65,.4,.72]}/><meshStandardMaterial color="#e8eef0" metalness={.15} roughness={.5}/></mesh>
      <mesh position={[0,-.22,1.71]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.17,.17,.16,24]}/><meshStandardMaterial color="#152b36" metalness={.4}/></mesh>
      <mesh position={[0,-.22,1.8]}><circleGeometry args={[.11,24]}/><meshStandardMaterial color="#49aac4" emissive={active?'#168567':'#102a36'} emissiveIntensity={.6}/></mesh>
      <mesh position={[0,-.48,-.08]} castShadow><boxGeometry args={[.48,.5,.22]}/><meshStandardMaterial color="#e4edf1" metalness={.2}/></mesh>
      <mesh ref={led} position={[.15,-.47,.04]}><sphereGeometry args={[.055,12,10]}/><meshBasicMaterial color="#7897a8"/></mesh>
    </group>
    <Billboard position={[0,3.52,.68]}>
      <mesh><boxGeometry args={[2.82,.64,.06]}/><meshBasicMaterial color={accent}/></mesh>
      <Text font="/fonts/ibm-plex-sans.ttf" position={[0,.12,.055]} fontSize={.17} color="#ffffff" anchorX="center" anchorY="middle" maxWidth={2.6}>{title}</Text>
      <Text font="/fonts/ibm-plex-sans.ttf" position={[0,-.13,.055]} fontSize={.11} color="#ffffff" anchorX="center" anchorY="middle" maxWidth={2.6}>{receiving?(active?'ĐỐI CHIẾU MÃ KIỆN':'ĐƯA TEM QR VÀO CAMERA'):'QUÉT MÃ XUẤT KHO'}</Text>
    </Billboard>    {[-1,1].map((side)=><mesh key={side} rotation={[-Math.PI/2,0,0]} position={[side*1.28,.018,0]}><planeGeometry args={[.045,2.35]}/><meshBasicMaterial color={accent} transparent opacity={selected||active?.62:.3}/></mesh>)}
    {[-1,1].map((side)=><mesh key={`end-${side}`} rotation={[-Math.PI/2,0,0]} position={[0,.018,side*1.18]}><planeGeometry args={[2.6,.045]}/><meshBasicMaterial color={accent} transparent opacity={selected||active?.62:.3}/></mesh>)}
    <mesh ref={ring} rotation={[-Math.PI/2,0,0]} position={[0,.02,0]}><planeGeometry args={[2.3,2.1]}/><meshBasicMaterial color={accent} transparent opacity={.15} depthWrite={false}/></mesh>
    <Text font="/fonts/ibm-plex-sans.ttf" position={[0,.035,.4]} rotation={[-Math.PI/2,0,0]} fontSize={.25} color="#f5fffa">{receiving?'01 · NHẬP':'02 · XUẤT'}</Text>
  </group>;
}
function ActiveVehicles({ state, paused, runId, callback, product, inventory, destinationZ, transferMode, speedMultiplier = 1, targetsRef }: { state:DemoState; paused:boolean; runId:number; callback:(s:DemoState)=>void; product:Props['demoProduct']; inventory?:Inventory; destinationZ:number; transferMode:boolean; speedMultiplier?: number; targetsRef?: React.MutableRefObject<SceneTargets> }) {
  const truck=useRef<THREE.Group>(null); const fork=useRef<THREE.Group>(null); const lift=useRef<THREE.Group>(null); const driver=useRef<THREE.Group>(null); const steering=useRef<THREE.Mesh>(null);
  const destinationFork=useRef<THREE.Group>(null); const destinationLift=useRef<THREE.Group>(null); const destinationDriver=useRef<THREE.Group>(null); const destinationSteering=useRef<THREE.Mesh>(null); const destinationCargo=useRef<THREE.Group>(null);
  const elapsed=useRef(0); const done=useRef(''); const current=useRef(state); const cargo=useRef<THREE.Group>(null); const forkCargo=useRef<THREE.Group>(null); const pickPallet=useRef<THREE.Group>(null); const gate=useRef<THREE.Group>(null);
  const speedRef=useRef(speedMultiplier); speedRef.current=speedMultiplier;
  useEffect(() => {
    if (!targetsRef) return;
    targetsRef.current.truck = truck.current;
    targetsRef.current.fork = fork.current;
    targetsRef.current.destinationFork = destinationFork.current;
  });
  useEffect(()=>{if(current.current!==state){current.current=state;elapsed.current=0;done.current='';}},[state,runId]);
  useEffect(()=>{
    if(state==='TRUCK_APPROACHING'&&truck.current){
      truck.current.position.set(ROAD_LANES[0],0,28);truck.current.rotation.y=Math.PI/2;
      if(cargo.current){cargo.current.visible=true;cargo.current.position.set(-.55,.68,0);}
      if(gate.current)gate.current.rotation.z=0;
      if(forkCargo.current)forkCargo.current.visible=false;
      if(pickPallet.current){pickPallet.current.visible=false;pickPallet.current.position.y=0;}
      if(fork.current){fork.current.position.set(10,0,5.1);fork.current.rotation.y=0;}
      if(lift.current)lift.current.position.y=.08;
    }
    if(state==='TRANSFER_PREPARING'&&truck.current){
      truck.current.position.set(ROAD_LANES[0],0,10.7);truck.current.rotation.y=0;
      if(cargo.current){cargo.current.visible=false;cargo.current.position.set(-.55,.68,0);}
      if(gate.current)gate.current.rotation.z=0;
      if(forkCargo.current)forkCargo.current.visible=false;
      if(pickPallet.current){pickPallet.current.visible=true;pickPallet.current.position.y=0;}
      if(fork.current){fork.current.position.set(0,0,11.8);fork.current.rotation.y=0;}
      if(lift.current)lift.current.position.y=.08;
    }
  },[state,runId]);
  useFrame((_,delta)=>{
    if(paused)return;
    const sp=vehicleSpeedScale(speedRef.current);
    const dt=Math.min(delta,.16)*sp;
    elapsed.current+=dt;
    const phase=current.current;
    const routeNow=phase==='TRANSFER_PREPARING' ? transferPickupRoute
      : phase==='IN_TRANSIT' ? [[ROAD_LANES[0],10.7],[ROAD_LANES[0],-10],[ROAD_LANES[0],destinationZ+11.5]] as [number,number][]
      : phase==='DESTINATION_ARRIVAL' ? [[ROAD_LANES[0],destinationZ+11.5],[9,destinationZ+11.5],[4.4,destinationZ+11.5],[3.8,destinationZ+11.5]] as [number,number][]
      : phase==='DESTINATION_PALLET_PICKUP' ? [[10,destinationZ+5.1],[10,destinationZ+11.5],[8.8,destinationZ+11.5]] as [number,number][]
      : phase==='IOT_CAMERA_IN_SIMULATED' ? [[8.8,destinationZ+11.5],[8.8,destinationZ+12.8],[-6,destinationZ+12.8],[-6,destinationZ+9.2]] as [number,number][]
      : phase==='MOVE_TO_STORAGE' ? (transferMode ? [[-6,destinationZ+9.2],[-6,destinationZ+12.2],[-4.7,destinationZ+12.2],[-4.7,destinationZ+8.2],[-4.7,destinationZ+4.5],[-4.7,destinationZ-1.3]] : [[-6,9.2],[-6,12.2],[-4.7,12.2],[-4.7,8.2],[-4.7,4.5],[-4.7,-1.3]]) as [number,number][]
      : route[phase];
    if(phase==='TRUCK_APPROACHING'||phase==='TRUCK_DOCKING'||phase==='IN_TRANSIT'||phase==='DESTINATION_ARRIVAL'){
      const t=Math.min(1,elapsed.current*(phase==='IN_TRANSIT'?1/5.5:phase==='TRUCK_APPROACHING'?1/5.5:phase==='DESTINATION_ARRIVAL'?1/2.2:.7));
      if(truck.current&&routeNow){const p=sampleRoute(routeNow,smoothstep(0,1,t),1.7);truck.current.position.set(p.x,0,p.z);const heading=Math.atan2(-p.dz,p.dx);truck.current.rotation.y=elapsed.current<.05?heading:dampAngle(truck.current.rotation.y,heading,7,dt);}
      if(((phase==='TRUCK_APPROACHING'||phase==='TRUCK_DOCKING')&&t>=1 || phase==='DESTINATION_ARRIVAL'&&elapsed.current>=4.2 || phase==='IN_TRANSIT'&&t>=1)&&done.current!==phase){done.current=phase;callback(phase)}
    }
    if(phase==='TRUCK_UNLOADING'||phase==='DESTINATION_ARRIVAL'){
      if(cargo.current){
        if(phase==='TRUCK_UNLOADING'){
          cargo.current.position.x=-.55-2.75*smoothstep(0,3.2,elapsed.current);
          cargo.current.position.y=.68*(1-smoothstep(2.5,3.4,elapsed.current));
        } else {
          // Wait until truck completely stops (2.2s), open rear liftgate, then slide pallet out and lower smoothly.
          cargo.current.position.x=-.55-2.45*smoothstep(2.7,3.45,elapsed.current);
          cargo.current.position.y=.68*(1-smoothstep(3.4,4.05,elapsed.current));
        }
      }
      if(gate.current)gate.current.rotation.z=phase==='TRUCK_UNLOADING'?-.55*smoothstep(0,1.2,elapsed.current):-.55*smoothstep(2.2,2.9,elapsed.current);
      if(phase==='TRUCK_UNLOADING'&&elapsed.current>3.6&&done.current!==phase){done.current=phase;callback(phase)}
    }
    if(transferMode&&cargo.current){
      const loaded=['WAITING_DISPATCH_CONFIRM','DISPATCHED','IN_TRANSIT','DESTINATION_ARRIVAL','DESTINATION_PALLET_PICKUP'].includes(phase);
      if(phase!=='TRANSFER_LOADING_TRUCK')cargo.current.visible=loaded;
      if(['WAITING_DISPATCH_CONFIRM','DISPATCHED','IN_TRANSIT'].includes(phase)){
        cargo.current.position.set(-.55,.68,0);
        if(gate.current)gate.current.rotation.z=0;
      }
      if(phase==='WAITING_DISPATCH_CONFIRM'&&forkCargo.current)forkCargo.current.visible=false;
    }
    if(phase==='WAITING_CONFIRMATION'||phase==='GOODS_RECEIVED'){if(forkCargo.current)forkCargo.current.visible=true;}
    if(phase==='IOT_CAMERA_OUT_SIMULATED'){if(forkCargo.current)forkCargo.current.visible=true;if(fork.current)fork.current.position.set(6,0,9.2);}
    if(phase==='WAITING_RECEIVE_CONFIRM'||phase==='RECEIVED'){if(destinationCargo.current)destinationCargo.current.visible=true;}
    const destinationPhase=transferMode&&['DESTINATION_PALLET_PICKUP','IOT_CAMERA_IN_SIMULATED','WAITING_RECEIVE_CONFIRM','RECEIVED','MOVE_TO_STORAGE','STORED'].includes(phase);
    const activeForkRef=destinationPhase?destinationFork:fork;const activeLiftRef=destinationPhase?destinationLift:lift;const activeCargoRef=destinationPhase?destinationCargo:forkCargo;
    if(activeForkRef.current&&routeNow&&['WORKER_APPROACHING','TRANSFER_PREPARING','FORKLIFT_TO_TRUCK','FORKLIFT_PICKUP','MOVE_TO_OUTBOUND','MOVE_TO_STORAGE','IOT_CAMERA_SIMULATED','DESTINATION_PALLET_PICKUP','IOT_CAMERA_IN_SIMULATED','FORKLIFT_DELIVER_TO_TRUCK'].includes(phase)){
      // WareTrack's simulated forklift cruises around 2.2–2.6 m/s. Smoothstep has a 1.5×
      // peak/average ratio, so durations below are based on measured route length and keep peaks realistic.
      const travel=phase==='WORKER_APPROACHING'?2.4:phase==='TRANSFER_PREPARING'?5.2:phase==='MOVE_TO_OUTBOUND'?9.5:phase==='MOVE_TO_STORAGE'?7.8:phase==='IOT_CAMERA_IN_SIMULATED'?11:phase==='IOT_CAMERA_SIMULATED'?10:phase==='FORKLIFT_DELIVER_TO_TRUCK'?8.5:phase==='FORKLIFT_TO_TRUCK'?3.4:phase==='DESTINATION_PALLET_PICKUP'?3.6:4.8;
      const t=Math.min(1,elapsed.current/travel);const p=sampleRoute(routeNow,smoothstep(0,1,t),.34);activeForkRef.current.position.set(p.x,0,p.z);
      // The WareTrack forklift points along local -Z in this scene; steer through turns smoothly.
      const heading=Math.atan2(-p.dx,-p.dz);
      const prevHeading=activeForkRef.current.rotation.y;
      activeForkRef.current.rotation.y=elapsed.current<.05?heading:dampAngle(prevHeading,heading,11,dt);
      // Steering wheel follows the yaw rate, like a driver turning into the corner.
      const yawRate=Math.atan2(Math.sin(activeForkRef.current.rotation.y-prevHeading),Math.cos(activeForkRef.current.rotation.y-prevHeading))/Math.max(dt,.001);
      const wheelRef=destinationPhase?destinationSteering:steering;
      if(wheelRef.current)wheelRef.current.rotation.z=THREE.MathUtils.damp(wheelRef.current.rotation.z,THREE.MathUtils.clamp(yawRate*1.6,-2.4,2.4),6,dt);
      if(phase==='FORKLIFT_DELIVER_TO_TRUCK'&&gate.current)gate.current.rotation.z=-.55*smoothstep(.15,.65,t);
      if(activeLiftRef.current){activeLiftRef.current.position.y=phase==='FORKLIFT_TO_TRUCK'?.08:phase==='FORKLIFT_PICKUP'?.08+.5*smoothstep(12.2,13.2,elapsed.current):phase==='DESTINATION_PALLET_PICKUP'?.08+.5*smoothstep(3.6,4.4,elapsed.current):phase==='MOVE_TO_STORAGE'?.08+.5*(1-smoothstep(7.2,8.2,elapsed.current)):phase==='IOT_CAMERA_IN_SIMULATED'?.58:phase==='IOT_CAMERA_SIMULATED'||phase==='MOVE_TO_OUTBOUND'||phase==='FORKLIFT_DELIVER_TO_TRUCK'?.58:.08;}
      if(activeCargoRef.current)activeCargoRef.current.visible=phase==='FORKLIFT_TO_TRUCK'?false:phase==='DESTINATION_PALLET_PICKUP'?elapsed.current>4.4:phase==='PALLET_UNLOADING'||phase==='MOVE_TO_OUTBOUND'||phase==='IOT_CAMERA_OUT_SIMULATED'||phase==='FORKLIFT_DELIVER_TO_TRUCK'||phase==='MOVE_TO_STORAGE'||phase==='IOT_CAMERA_SIMULATED'||phase==='IOT_CAMERA_IN_SIMULATED';
      if(phase==='DESTINATION_PALLET_PICKUP'&&elapsed.current>4.4&&cargo.current)cargo.current.visible=false;
      if(done.current!==phase&&(phase==='DESTINATION_PALLET_PICKUP'?elapsed.current>=4.8:t>=1)){done.current=phase;callback(phase)}
    }
    if(phase==='FORKLIFT_PICKUP'){
      const liftProgress=smoothstep(.15,1.5,elapsed.current);
      if(lift.current)lift.current.position.y=.08+.5*liftProgress;
      if(pickPallet.current){pickPallet.current.position.y=.55*liftProgress;pickPallet.current.visible=liftProgress<.88;}
      if(forkCargo.current)forkCargo.current.visible=liftProgress>=.88;
      if(elapsed.current>=2.25&&done.current!==phase){done.current=phase;callback(phase);}
    }
    if(phase==='PALLET_UNLOADING'){
      const liftProgress=smoothstep(.05,1.25,elapsed.current);
      if(lift.current)lift.current.position.y=.08+.5*liftProgress;
      if(cargo.current){cargo.current.position.y=.7*liftProgress;cargo.current.visible=liftProgress<.84;}
      if(forkCargo.current)forkCargo.current.visible=liftProgress>=.84;
      if(elapsed.current>=1.5&&done.current!==phase){done.current=phase;callback(phase);}
    }
    if(phase==='TRANSFER_LOADING_TRUCK'){
      if(truck.current){truck.current.position.set(ROAD_LANES[0],0,10.7);truck.current.rotation.y=0;}
      const nudge=smoothstep(0,.45,elapsed.current)*(1-smoothstep(1.35,1.85,elapsed.current));
      if(fork.current){fork.current.position.set(12.8+.65*nudge,0,10.7);fork.current.rotation.y=-Math.PI/2;}
      if(lift.current){lift.current.position.y=elapsed.current<1.25?.58+.18*smoothstep(0,.6,elapsed.current):.76-.68*smoothstep(1.25,1.9,elapsed.current);}
      const placed=elapsed.current>=.85;
      if(forkCargo.current)forkCargo.current.visible=!placed;
      if(cargo.current){
        cargo.current.visible=placed;
        if(placed)cargo.current.position.set(-1.55+1.0*smoothstep(.85,1.5,elapsed.current),.68,0);
      }
      if(gate.current)gate.current.rotation.z=-.55*(1-smoothstep(1.55,2.25,elapsed.current));
      if(elapsed.current>=2.45&&done.current!==phase){done.current=phase;callback(phase);}
    }
    if(phase==='STORED'){if(forkCargo.current)forkCargo.current.visible=false;if(destinationCargo.current)destinationCargo.current.visible=false;}
  });
  const activeTruck=state!=='IDLE'&&state!=='COMPLETE';
  const destinationForkActive=transferMode&&['DESTINATION_PALLET_PICKUP','IOT_CAMERA_IN_SIMULATED','WAITING_RECEIVE_CONFIRM','RECEIVED','MOVE_TO_STORAGE','STORED','COMPLETE'].includes(state);
  const activeFork=!destinationForkActive&&!['DISPATCHED','IN_TRANSIT','DESTINATION_ARRIVAL'].includes(state);
  if(fork.current&&(state==='IDLE'||state==='COMPLETE'))fork.current.position.set(transferMode?0:10,0,transferMode?11.8:5.1);
  return <>
    <group ref={truck} position={[ROAD_LANES[0],0,28]} rotation={[0,Math.PI/2,0]} visible={activeTruck}>
      <FreightTruckModel refrigerated/>
      <group ref={gate} position={[-1.61,.55,0]}><mesh><boxGeometry args={[.1,1.05,1.45]}/><meshStandardMaterial color="#d8e5eb"/></mesh></group>
      <group ref={cargo} position={[-.55,.68,0]}><LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/><Label position={[0,1.35,0]} size={.18}>{product?.name ?? 'KIỆN HÀNG'}</Label></group>
    </group>
    <group ref={fork} position={[transferMode?0:10,0,transferMode?11.8:5.1]} visible={activeFork}>
      <ForkliftVehicle liftRef={lift} driverRef={driver} steeringRef={steering} cargo={<group ref={forkCargo} position={[0,.1,0]} visible={false}><LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/></group>}/>
    </group>
    {transferMode&&<group ref={pickPallet} position={[-4.7,0,-2.2]} visible={state==='TRANSFER_PREPARING'||state==='FORKLIFT_PICKUP'}>
      <LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/>
      <Label position={[0,1.25,0]} size={.16} color="#80521a">{product?.name ?? 'PALLET THEO PHIẾU'}</Label>
    </group>}
    {transferMode&&<group ref={destinationFork} position={[10,0,destinationZ+5.1]} visible={destinationForkActive}>
      <ForkliftVehicle liftRef={destinationLift} driverRef={destinationDriver} steeringRef={destinationSteering} cargo={<group ref={destinationCargo} position={[0,.1,0]} visible={false}><LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/></group>}/>
    </group>}
  </>;
}
function InstancedMainRoadMarkings() {
  const centerRef = useRef<THREE.InstancedMesh>(null);
  const edgeRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const dummy = new THREE.Object3D();
    if (centerRef.current) {
      for (let i = 0; i < 16; i++) {
        dummy.position.set(ROAD_CENTER_X, -0.025, 28 - i * 6);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        centerRef.current.setMatrixAt(i, dummy.matrix);
      }
      centerRef.current.instanceMatrix.needsUpdate = true;
    }
    if (edgeRef.current) {
      let idx = 0;
      for (let i = 0; i < 16; i++) {
        dummy.position.set(ROAD_CENTER_X - ROAD_WIDTH / 2 + 0.18, -0.026, 28 - i * 6);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        edgeRef.current.setMatrixAt(idx++, dummy.matrix);
        dummy.position.set(ROAD_CENTER_X + ROAD_WIDTH / 2 - 0.18, -0.026, 28 - i * 6);
        dummy.updateMatrix();
        edgeRef.current.setMatrixAt(idx++, dummy.matrix);
      }
      edgeRef.current.instanceMatrix.needsUpdate = true;
    }
  }, []);
  return (
    <group>
      <instancedMesh ref={centerRef} args={[undefined, undefined, 16]}>
        <planeGeometry args={[0.16, 2.4]} />
        <meshBasicMaterial color="#fbbf24" />
      </instancedMesh>
      <instancedMesh ref={edgeRef} args={[undefined, undefined, 32]}>
        <planeGeometry args={[0.09, 2.6]} />
        <meshBasicMaterial color="#f8fafc" transparent opacity={0.75} />
      </instancedMesh>
    </group>
  );
}

function Campus({ props }: { props: Props }) {
  const selectedId=props.selectedItem?.id;
  const idle=props.demoState==='IDLE'||props.demoState==='COMPLETE';
  const targetsRef = useRef<SceneTargets>({ truck: null, fork: null, destinationFork: null, employee: null });
  const yardConcreteTex = useMemo(() => getConcreteYardTexture(14, 24), []);
  const roadAsphaltTex = useMemo(() => getAsphaltTexture(3, 28), []);
  const skyTex = useMemo(() => getSkyDomeTexture(), []);
  return <>
    <color attach="background" args={['#e6f0f7']}/><fog attach="fog" args={['#e6f0f7',96,235]}/>
    <mesh position={[0, 0, -15]}>
      <sphereGeometry args={[245, 16, 12]} />
      <meshBasicMaterial map={skyTex ?? undefined} color="#ffffff" side={THREE.BackSide} fog={false} />
    </mesh>
    <Environment resolution={64} frames={1}>
      <Lightformer form="rect" intensity={1.9} position={[0, 12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[30, 30, 1]} color="#f8fafc" />
      <Lightformer form="circle" intensity={2.5} position={[-20, 16, 14]} scale={8} color="#fffbeb" />
      <Lightformer form="rect" intensity={1.0} position={[20, 6, -15]} rotation={[0, -Math.PI / 2, 0]} scale={[24, 10, 1]} color="#ccfbf1" />
      <Lightformer form="rect" intensity={0.65} position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[40, 40, 1]} color="#cbd5e1" />
    </Environment>
    <hemisphereLight args={['#ffffff','#94a3b8',.88]}/><ambientLight intensity={.32}/>
    <directionalLight position={[-22,34,16]} color="#fffaf0" intensity={2.35} castShadow shadow-mapSize={[1024,1024]} shadow-bias={-.0005} shadow-camera-left={-42} shadow-camera-right={42} shadow-camera-top={42} shadow-camera-bottom={-68} shadow-normalBias={.03}/>
    <directionalLight position={[22,14,-18]} color="#e0f2fe" intensity={.48}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.055,-15]} receiveShadow><planeGeometry args={[64,104]}/><meshStandardMaterial color="#dce4e8" map={yardConcreteTex ?? undefined} roughness={.86}/></mesh>
    {/* marked two-way truck road and yard apron */}
    <mesh rotation={[-Math.PI/2,0,0]} position={[ROAD_CENTER_X,-.045,ROAD_CENTER_Z]} receiveShadow><planeGeometry args={[ROAD_WIDTH,ROAD_LENGTH]}/><meshStandardMaterial color="#334155" map={roadAsphaltTex ?? undefined} roughness={.85}/></mesh>
    <InstancedMainRoadMarkings />
    {['TRUCK_UNLOADING','WORKER_APPROACHING','FORKLIFT_TO_TRUCK','PALLET_UNLOADING'].includes(props.demoState)&&<>
      <group position={[7.1,-.02,11.5]}>
        <mesh position={[0,0,-1.15]}><boxGeometry args={[2.5,.025,.07]}/><meshBasicMaterial color="#f5bf35"/></mesh>
        <mesh position={[0,0,1.15]}><boxGeometry args={[2.5,.025,.07]}/><meshBasicMaterial color="#f5bf35"/></mesh>
        <mesh position={[-1.22,0,0]}><boxGeometry args={[.07,.025,2.3]}/><meshBasicMaterial color="#f5bf35"/></mesh>
        <mesh position={[1.22,0,0]}><boxGeometry args={[.07,.025,2.3]}/><meshBasicMaterial color="#f5bf35"/></mesh>
      </group>
      <Label position={[7.1,2,11.5]} size={.2} color="#a56608">{props.demoState==='TRUCK_UNLOADING'?'ĐIỂM HẠ PALLET':props.demoState==='PALLET_UNLOADING'?'XE NÂNG ĐANG NHẤC PALLET':'PALLET ĐÃ HẠ · CHỜ XE NÂNG'}</Label>
    </>}
    {props.campusWarehouses.map((site,i)=><Warehouse key={site.id} site={site} index={i} onSelectItem={props.onSelectItem} selectedItemId={selectedId} onSelectZone={props.onSelectZone} selectedZone={props.selectedZone} activeSite={i===0||(props.transferMode&&props.campusWarehouses[i]?.id===props.destinationWarehouseId&&['DESTINATION_PALLET_PICKUP','IOT_CAMERA_IN_SIMULATED','WAITING_RECEIVE_CONFIRM','RECEIVED','MOVE_TO_STORAGE','STORED','COMPLETE'].includes(props.demoState))} demoState={props.demoState} paused={props.demoPaused} accessDoorState={i===0?props.accessDoorState:undefined} accessAlert={i===0 && props.demoState === 'IDLE' ? props.accessAlert : false} onSelectDoor={i===0?props.onSelectDoor:undefined} accessEmployeePhase={i===0?props.accessEmployeePhase:'IDLE'} accessEmployeeName={i===0?props.accessEmployeeName:undefined} onAccessMotionComplete={i===0?props.onAccessMotionComplete:undefined} speedMultiplier={props.speedMultiplier} targetsRef={i===0?targetsRef:undefined} transferMode={props.transferMode}/>)}
    <SurroundingWorld paused={props.demoPaused}/>
    <LogisticsYard/>{idle&&!props.demoPaused&&<YardTraffic enabled/>}
    <ActiveVehicles state={props.demoState} paused={props.demoPaused} runId={props.demoRunId} callback={props.onMotionComplete} product={props.demoProduct} inventory={props.demoInventory} transferMode={props.transferMode} destinationZ={props.transferMode?-Math.max(0,props.campusWarehouses.findIndex(site=>site.id===props.destinationWarehouseId))*28:0} speedMultiplier={props.speedMultiplier} targetsRef={targetsRef}/>
    <MapControls makeDefault enableRotate enableDamping dampingFactor={.1} panSpeed={1.15} rotateSpeed={0.85} zoomSpeed={1.1} minDistance={7} maxDistance={105} maxPolarAngle={Math.PI/2.12} target={[0,0,props.campusWarehouses.length > 1 ? -14*(props.campusWarehouses.length-1) : 2]}/>
    <SceneCameraDirector phase={props.accessEmployeePhase ?? 'IDLE'} focus={!!props.accessFocus} demoState={props.demoState} transferMode={props.transferMode} campusCount={props.campusWarehouses.length} targetsRef={targetsRef}/>
  </>;
}

export function WarehouseTwinScene(props: Props) {
  return <Canvas shadows dpr={1} camera={{position:props.campusWarehouses.length > 1 ? [34,36,22] : [26,24,32],fov:43,near:.1,far:340}} gl={{antialias:true,alpha:false,powerPreference:'high-performance',toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.02}}>
    <color attach="background" args={['#dcebf4']}/>
    <Suspense fallback={null}><Campus props={props}/></Suspense>
  </Canvas>;
}
