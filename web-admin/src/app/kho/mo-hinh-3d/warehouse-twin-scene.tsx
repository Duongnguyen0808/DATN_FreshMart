'use client';

import { Fragment, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Billboard, MapControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Inventory } from '../../../lib/inventory-api';
import { ForkliftVehicle } from './forklift-vehicle';
import { FreightTruckModel } from './reference-vehicles';
import { LogisticsPallet, LogisticsYard, packagingFor } from './logistics-yard';
import { YardTraffic } from './yard-traffic';
import { ROAD_CENTER_X, ROAD_CENTER_Z, ROAD_LANES, ROAD_LENGTH, ROAD_WIDTH } from './yard-paths';

export type DemoState = 'IDLE' | 'TRUCK_APPROACHING' | 'TRUCK_DOCKING' | 'DOCKED' | 'TRUCK_UNLOADING' | 'WORKER_APPROACHING' | 'FORKLIFT_TO_TRUCK' | 'PALLET_UNLOADING' | 'IOT_RFID_SIMULATED' | 'IOT_CAMERA_SIMULATED' | 'WAITING_CONFIRMATION' | 'GOODS_RECEIVED' | 'MOVE_TO_STORAGE' | 'STORED' | 'TRANSFER_PREPARING' | 'FORKLIFT_PICKUP' | 'MOVE_TO_OUTBOUND' | 'IOT_RFID_OUT_SIMULATED' | 'FORKLIFT_DELIVER_TO_TRUCK' | 'TRANSFER_LOADING_TRUCK' | 'WAITING_DISPATCH_CONFIRM' | 'DISPATCHED' | 'IN_TRANSIT' | 'DESTINATION_ARRIVAL' | 'DESTINATION_PALLET_PICKUP' | 'IOT_RFID_IN_SIMULATED' | 'WAITING_RECEIVE_CONFIRM' | 'RECEIVED' | 'COMPLETE';
type Site = { id: string; name: string; code: string; storeName: string; items: Inventory[] };
type Props = {
  demoRunId: number; onMotionComplete: (state: DemoState) => void; warehouseName: string;
  destinationWarehouseId: string; campusWarehouses: Site[]; transferMode: boolean; items: Inventory[];
  selectedItem: Inventory | null; onSelectItem: (item: Inventory) => void; selectedZone: string;
  onSelectZone: (zone: string) => void; demoState: DemoState; demoPaused: boolean;
  demoProduct: { code: string; name: string; unit: string } | null; demoInventory?: Inventory;
};

const movement = new Set<DemoState>(['TRUCK_APPROACHING','TRUCK_DOCKING','TRUCK_UNLOADING','FORKLIFT_TO_TRUCK','FORKLIFT_PICKUP','MOVE_TO_OUTBOUND','MOVE_TO_STORAGE','IN_TRANSIT','DESTINATION_ARRIVAL','DESTINATION_PALLET_PICKUP','TRANSFER_PREPARING','IOT_RFID_SIMULATED','IOT_RFID_IN_SIMULATED','FORKLIFT_DELIVER_TO_TRUCK']);
const route: Partial<Record<DemoState, [number, number][]>> = {
  // Inbound truck parks to the right of the entrance, leaving the doorway and RFID aisle clear.
  // Start on the centre of the inbound lane, follow the road straight, then turn once at the apron.
  TRUCK_APPROACHING: [[ROAD_LANES[1],28],[ROAD_LANES[1],15],[ROAD_LANES[1],11.5],[9,11.5],[4.4,11.5]], TRUCK_DOCKING: [[4.4,11.5],[3.8,11.5]],
  WORKER_APPROACHING: [[10,5.1],[10,10]],
  // Approach the inbound truck's rear loading edge from the east apron.
  FORKLIFT_TO_TRUCK: [[10,10],[10,11.5],[8.8,11.5]],
  // Pass through the clear doorway, turn in the cross-aisle, then use the west aisle.
  // x=0 between the rack rows is too narrow for a forklift and its load.
  // Exit through the door, align with the RFID gate from its approach side, and pass through it.
  MOVE_TO_OUTBOUND: [[-4.7,-.3],[-4.7,2.5],[-4.7,5.8],[0,5.8],[0,7.4],[6,7.4],[6,8.5]],
  // Keep the load on the forks after RFID; approach the parked truck from behind, then stop at reach distance.
  FORKLIFT_DELIVER_TO_TRUCK: [[6,10],[10,10],[12,10],[12,17],[16,17],[16,15.3]],
  // Enter past the receiving gate, use the open doorway, then take the west aisle to the rack.
  MOVE_TO_STORAGE: [[-6,8.5],[0,8.5],[0,5.8],[-4.7,5.8],[-4.7,2.5],[-4.7,-1.3]],
  IN_TRANSIT: [[16,10.7],[16,-10],[16,-28]],
  DESTINATION_ARRIVAL: [[16,-12.5],[9,-12.5],[4.4,-12.5],[3.8,-12.5]],
  IOT_RFID_SIMULATED: [[8.8,11.5],[8.8,14],[-6,14],[-6,8.5]],
  IOT_RFID_IN_SIMULATED: [[1.2,-26],[0,-27],[-5.5,-27]],
};
type GridNode = { x: number; z: number; g: number; f: number };
const PICKUP_START: [number,number] = [10,5.1];
const PICKUP_STAGING: [number,number] = [-4.7,-.3];
const PATH_GRID = .5;
function findShortestPickupRoute(start: [number,number], goal: [number,number]): [number,number][] {
  const blocked = (x:number,z:number) => {
    if(x < -10 || x > 11 || z < -8.5 || z > 14) return true;
    if(Math.abs(Math.abs(x)-8.3) < .58 && z > -6.8 && z < 6.8) return true;
    if(Math.abs(z+6.8) < .58 && Math.abs(x) < 8.8) return true;
    return [-3,.5].some(rz => [-1.8,2.2,6.2].some(rx => Math.abs(x-rx) < 2.1 && Math.abs(z-rz) < 1.05));
  };
  const toGrid = (p:[number,number]) => ({x:Math.round(p[0]/PATH_GRID),z:Math.round(p[1]/PATH_GRID)});
  const fromGrid = (p:{x:number;z:number}):[number,number] => [p.x*PATH_GRID,p.z*PATH_GRID];
  const source=toGrid(start), target=toGrid(goal), key=(x:number,z:number)=>`${x},${z}`;
  const h=(x:number,z:number)=>Math.hypot(target.x-x,target.z-z);
  const open:GridNode[]=[];
  const push=(n:GridNode)=>{let i=open.push(n)-1;while(i>0){const p=(i-1)>>1;if(open[p].f<=n.f)break;open[i]=open[p];i=p;}open[i]=n;};
  const pop=()=>{const first=open[0],last=open.pop()!;if(open.length){let i=0;while(true){let c=i*2+1;if(c>=open.length)break;if(c+1<open.length&&open[c+1].f<open[c].f)c++;if(open[c].f>=last.f)break;open[i]=open[c];i=c;}open[i]=last;}return first;};
  const startKey=key(source.x,source.z),goalKey=key(target.x,target.z),cost=new Map([[startKey,0]]),parent=new Map<string,string>();
  push({...source,g:0,f:h(source.x,source.z)});let visited=0;
  while(open.length&&visited++<12000){
    const node=pop(),nodeKey=key(node.x,node.z);if(node.g>(cost.get(nodeKey)??Infinity))continue;if(nodeKey===goalKey)break;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
      if(!dx&&!dz)continue;const x=node.x+dx,z=node.z+dz,world=fromGrid({x,z});if(blocked(...world))continue;
      if(dx&&dz&&(blocked(...fromGrid({x:node.x+dx,z:node.z}))||blocked(...fromGrid({x:node.x,z:node.z+dz}))))continue;
      const nextKey=key(x,z),nextCost=node.g+(dx&&dz?Math.SQRT2:1);if(nextCost>=(cost.get(nextKey)??Infinity))continue;
      cost.set(nextKey,nextCost);parent.set(nextKey,nodeKey);push({x,z,g:nextCost,f:nextCost+h(x,z)});
    }
  }
  if(!parent.has(goalKey))return [start,goal];
  const points:{x:number;z:number}[]=[];let cursor=goalKey;while(cursor!==startKey){const [x,z]=cursor.split(',').map(Number);points.push({x,z});cursor=parent.get(cursor)!;}points.push(source);points.reverse();
  const clear=(a:{x:number;z:number},b:{x:number;z:number})=>{const steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)*PATH_GRID/(PATH_GRID*.3));for(let i=1;i<steps;i++){const t=i/steps;if(blocked((a.x+(b.x-a.x)*t)*PATH_GRID,(a.z+(b.z-a.z)*t)*PATH_GRID))return false;}return true;};
  const result:[number,number][]=[start];let i=0;while(i<points.length-1){let j=points.length-1;while(j>i+1&&!clear(points[i],points[j]))j--;result.push(j===points.length-1?goal:fromGrid(points[j]));i=j;}
  return result;
}
const transferPickupRoute=findShortestPickupRoute(PICKUP_START,PICKUP_STAGING);
function smoothstep(a: number, b: number, x: number) { const t = THREE.MathUtils.clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
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
  return <Billboard position={position}><Text fontSize={size} color={color} outlineWidth={0.025} outlineColor="white" anchorX="center" anchorY="middle" maxWidth={5}>{children}</Text></Billboard>;
}
function Rack({ x, z, items, onSelect, selectedItemId }: { x: number; z: number; items: Inventory[]; onSelect: (item: Inventory) => void; selectedItemId?: string }) {
  return <group position={[x,0,z]}>
    {[0,1,2,3].map((level) => <group key={level} position={[0,.72+level*.86,0]}>
      <mesh position={[0,0,0]} castShadow><boxGeometry args={[3.3,.13,1.05]}/><meshStandardMaterial color="#e8a92d"/></mesh>
      {[-1.48,1.48].map(px=><mesh key={px} position={[px,-.05,0]} castShadow><boxGeometry args={[.11,.34,1.02]}/><meshStandardMaterial color="#27485d"/></mesh>)}
      {Array.from({length:3},(_,slot)=>items.length ? items[(level*3+slot)%items.length] : null).map((item,i)=>item&&<group key={`${item.id}-${i}`} position={[-1.08+i*1.08,.27,0]} onClick={(e)=>{e.stopPropagation();onSelect(item)}}>
        <mesh castShadow><boxGeometry args={[.88,.48,.72]}/><meshStandardMaterial color={item.id===selectedItemId?'#53c7e8':packagingFor(item.sku.product.name)==='blue'?'#267bc1':packagingFor(item.sku.product.name)==='white'?'#e8f0ed':'#bf8b53'}/></mesh>
        <mesh position={[0,0,.366]}><boxGeometry args={[.32,.19,.012]}/><meshStandardMaterial color="#f7f3e8"/></mesh>
      </group>)}
    </group>)}
  </group>;
}
function Warehouse({ site, index, onSelectItem, selectedItemId, onSelectZone, selectedZone, activeSite, demoState }: { site: Site; index: number; onSelectItem: (item: Inventory)=>void; selectedItemId?: string; onSelectZone: (zone:string)=>void; selectedZone:string; activeSite:boolean; demoState:DemoState }) {
  const z = -index*24;
  const stocks = site.items;
  const wallMat = <meshStandardMaterial color="#b9cfda" roughness={.82} />;
  return <group position={[0,0,z]}>
    <mesh position={[0,-.23,0]} receiveShadow><boxGeometry args={[17,.35,14]}/><meshStandardMaterial color="#d3dce0"/></mesh>
    <mesh position={[0,2.2,-6.8]} castShadow>{/* rear wall */}<boxGeometry args={[17,4.8,.35]}/>{wallMat}</mesh>
    {[-8.3,8.3].map(x=><mesh key={x} position={[x,2.2,0]} castShadow><boxGeometry args={[.35,4.8,13.6]}/>{wallMat}</mesh>)}
    {/* Fully open front: no shutter, gate leaf, or facade panels obstruct the receiving/shipping aisle. */}
    <Billboard position={[0,4.92,6.98]}>
      <mesh position={[0,0,0]}><boxGeometry args={[5.8,.72,.12]}/><meshStandardMaterial color="#f8fbfd" roughness={.8}/></mesh>
      <Text position={[0,.11,.075]} fontSize={.27} color="#174766" anchorX="center" anchorY="middle" maxWidth={5.4}>{site.name}</Text>
      <Text position={[0,-.17,.075]} fontSize={.13} color="#547184" anchorX="center" anchorY="middle" maxWidth={5.4}>{`${site.storeName} · ${site.code}`}</Text>
    </Billboard>
    {/* Two dense rack banks leave the west aisle clear for the RFID-to-storage forklift route. */}
    {[-3,.5].map((rackZ,row)=>[-1.8,2.2,6.2].map((rackX,col)=><Rack key={`${row}-${col}`} x={rackX} z={rackZ} items={stocks.slice(row*3+col).concat(stocks.slice(0,row*3+col))} onSelect={onSelectItem} selectedItemId={selectedItemId}/>))}
    {!activeSite&&<ParkedForklift position={[10,0,5.1]}/>}
    <RfidGate x={-6} z={8.5} zone="receiving" selected={selectedZone==='receiving'} active={activeSite&&['IOT_RFID_SIMULATED','IOT_RFID_IN_SIMULATED'].includes(demoState)} onSelect={onSelectZone}/>
    <RfidGate x={6} z={8.5} zone="shipping" selected={selectedZone==='shipping'} active={activeSite&&demoState==='IOT_RFID_OUT_SIMULATED'} onSelect={onSelectZone}/>
    {stocks.length===0 && <Label position={[0,.4,0]} size={.28}>Chưa có tồn kho</Label>}
  </group>;
}
function ParkedForklift({position}:{position:[number,number,number]}){
  const lift=useRef<THREE.Group>(null);const driver=useRef<THREE.Group>(null);const wheel=useRef<THREE.Mesh>(null);
  return <group position={position}><ForkliftVehicle liftRef={lift} driverRef={driver} steeringRef={wheel}/></group>;
}
function RfidGate({x,z,zone,selected,active,onSelect}:{x:number;z:number;zone:'receiving'|'shipping';selected:boolean;active:boolean;onSelect:(zone:string)=>void}){
  const led=useRef<THREE.Mesh>(null); const ring=useRef<THREE.Mesh>(null);
  const receiving=zone==='receiving';
  const accent=receiving?'#10a985':'#e88b20';
  const title=receiving?'NHẬN HÀNG · RFID':'XUẤT HÀNG · RFID';
  useFrame(({clock})=>{const pulse=(Math.sin(clock.elapsedTime*4)+1)/2;if(led.current){const material=led.current.material as THREE.MeshBasicMaterial;material.color.set(active?accent:selected?accent:'#7897a8');material.opacity=active?.72+pulse*.28:.85;}if(ring.current){ring.current.scale.setScalar(active?1+pulse*.08:1);const material=ring.current.material as THREE.MeshBasicMaterial;material.color.set(active?accent:selected?accent:'#79bbca');material.opacity=active?.35+pulse*.25:selected?.58:.18;}});
  return <group position={[x,0,z]} onClick={()=>onSelect(zone)}>
    {/* Fixed RFID reader and overhead antenna mounted from the warehouse eave. */}
    <group position={[0,3.45,-1.55]}>
      <mesh position={[0,0,-.08]} castShadow><boxGeometry args={[.14,.14,.25]}/><meshStandardMaterial color="#526c7b" metalness={.35}/></mesh>
      <mesh position={[0,0,.68]} castShadow><boxGeometry args={[.1,.1,1.48]}/><meshStandardMaterial color="#526c7b" metalness={.35}/></mesh>
      <mesh position={[0,-.12,1.32]} castShadow><boxGeometry args={[2.1,.1,.62]}/><meshStandardMaterial color="#e8eef0" metalness={.15} roughness={.5}/></mesh>
      <mesh position={[0,-.205,1.32]}><boxGeometry args={[1.45,.018,.42]}/><meshStandardMaterial color={accent}/></mesh>
      <mesh position={[0,-.48,-.08]} castShadow><boxGeometry args={[.48,.5,.22]}/><meshStandardMaterial color="#e4edf1" metalness={.2}/></mesh>
      <mesh ref={led} position={[.15,-.47,.04]}><sphereGeometry args={[.055,12,10]}/><meshBasicMaterial color="#7897a8"/></mesh>
    </group>
    <Billboard position={[0,3.25,.72]}>
      <mesh><boxGeometry args={[2.55,.5,.06]}/><meshBasicMaterial color={accent}/></mesh>
      <Text position={[0,.075,.045]} fontSize={.17} color="#ffffff" outlineWidth={.018} outlineColor="#183248" anchorX="center" anchorY="middle" maxWidth={2.4}>{title}</Text>
      <Text position={[0,-.14,.045]} fontSize={.105} color="#ffffff" outlineWidth={.014} outlineColor="#183248" anchorX="center" anchorY="middle" maxWidth={2.4}>{active?'ĐANG QUÉT':receiving?'VÀO KHO':'RA KHO'}</Text>
    </Billboard>    {[-1,1].map((side)=><mesh key={side} rotation={[-Math.PI/2,0,0]} position={[side*1.28,.018,0]}><planeGeometry args={[.045,2.35]}/><meshBasicMaterial color={accent} transparent opacity={selected||active?.62:.3}/></mesh>)}
    {[-1,1].map((side)=><mesh key={`end-${side}`} rotation={[-Math.PI/2,0,0]} position={[0,.018,side*1.18]}><planeGeometry args={[2.6,.045]}/><meshBasicMaterial color={accent} transparent opacity={selected||active?.62:.3}/></mesh>)}
    <mesh ref={ring} rotation={[-Math.PI/2,0,0]} position={[0,.02,0]}><ringGeometry args={[.42,.49,40]}/><meshBasicMaterial color={accent} transparent opacity={.25} side={THREE.DoubleSide}/></mesh>
    {active&&<group position={[0,.025,0]}>
      <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.72,.78,40]}/><meshBasicMaterial color={accent} transparent opacity={.36} side={THREE.DoubleSide}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[1.02,1.07,40]}/><meshBasicMaterial color={accent} transparent opacity={.2} side={THREE.DoubleSide}/></mesh>
    </group>}
  </group>;
}
function ActiveVehicles({ state, paused, runId, callback, product, inventory, destinationZ, transferMode }: { state:DemoState; paused:boolean; runId:number; callback:(s:DemoState)=>void; product:Props['demoProduct']; inventory?:Inventory; destinationZ:number; transferMode:boolean }) {
  const truck=useRef<THREE.Group>(null); const fork=useRef<THREE.Group>(null); const lift=useRef<THREE.Group>(null); const driver=useRef<THREE.Group>(null); const steering=useRef<THREE.Mesh>(null);
  const destinationFork=useRef<THREE.Group>(null); const destinationLift=useRef<THREE.Group>(null); const destinationDriver=useRef<THREE.Group>(null); const destinationSteering=useRef<THREE.Mesh>(null); const destinationCargo=useRef<THREE.Group>(null);
  const elapsed=useRef(0); const done=useRef(''); const current=useRef(state); const cargo=useRef<THREE.Group>(null); const forkCargo=useRef<THREE.Group>(null); const pickPallet=useRef<THREE.Group>(null); const gate=useRef<THREE.Group>(null);
  useEffect(()=>{if(current.current!==state){current.current=state;elapsed.current=0;done.current='';}},[state,runId]);
  useEffect(()=>{
    if((state==='TRUCK_APPROACHING'||state==='TRANSFER_PREPARING')&&truck.current){
      truck.current.position.set(ROAD_LANES[1],0,28);truck.current.rotation.y=Math.PI;
      if(cargo.current){cargo.current.visible=true;cargo.current.position.set(-.8,1.15,0);}
      if(gate.current)gate.current.rotation.z=0;
      if(forkCargo.current)forkCargo.current.visible=false;
      if(pickPallet.current){pickPallet.current.visible=false;pickPallet.current.position.y=0;}
      if(fork.current){fork.current.position.set(10,0,5.1);fork.current.rotation.y=0;}
      if(lift.current)lift.current.position.y=.08;
    }
    if(state==='TRANSFER_PREPARING'&&truck.current){truck.current.position.set(ROAD_LANES[0],0,10.7);truck.current.rotation.y=Math.PI/2;if(cargo.current)cargo.current.position.set(-3,1.15,0);}
  },[state,runId]);
  useFrame((_,delta)=>{
    if(paused)return;
    elapsed.current+=Math.min(delta,.06);
    const phase=current.current;
    const routeNow=phase==='TRANSFER_PREPARING' ? transferPickupRoute
      : phase==='IN_TRANSIT' ? [[ROAD_LANES[0],10.7],[ROAD_LANES[0],-10],[ROAD_LANES[0],destinationZ+11.5]] as [number,number][]
      : phase==='DESTINATION_ARRIVAL' ? [[ROAD_LANES[0],destinationZ+11.5],[9,destinationZ+11.5],[4.4,destinationZ+11.5],[3.8,destinationZ+11.5]] as [number,number][]
      : phase==='DESTINATION_PALLET_PICKUP' ? [[13.5,destinationZ+11.5],[8.8,destinationZ+11.5]] as [number,number][]
      : phase==='IOT_RFID_IN_SIMULATED' ? [[8.8,destinationZ+11.5],[10,destinationZ+11.5],[10,destinationZ+13.8],[1.2,destinationZ+13.8],[-6,destinationZ+13.8],[-6,destinationZ+8.5]] as [number,number][]
      : phase==='MOVE_TO_STORAGE' ? [[-6,destinationZ+8.5],[0,destinationZ+8.5],[0,destinationZ+5.8],[-4.7,destinationZ+5.8],[-4.7,destinationZ+2.5],[-4.7,destinationZ-1.3]] as [number,number][]
      : route[phase];
    if(phase==='TRUCK_APPROACHING'||phase==='TRUCK_DOCKING'||phase==='IN_TRANSIT'||phase==='DESTINATION_ARRIVAL'){
      const t=Math.min(1,elapsed.current*(phase==='IN_TRANSIT'?1/7:phase==='TRUCK_APPROACHING'?1/7:phase==='DESTINATION_ARRIVAL'?1/4:.6));
      if(truck.current&&routeNow){const p=sampleRoute(routeNow,smoothstep(0,1,t),1.7);truck.current.position.set(p.x,0,p.z);const heading=Math.atan2(p.dx,p.dz);truck.current.rotation.y=heading;}
      if(((phase==='TRUCK_APPROACHING'||phase==='TRUCK_DOCKING')&&t>=1 || phase==='DESTINATION_ARRIVAL'&&elapsed.current>4 || phase==='IN_TRANSIT'&&t>=1)&&done.current!==phase){done.current=phase;callback(phase)}
    }
    if(phase==='TRUCK_UNLOADING'||phase==='DESTINATION_ARRIVAL'){
      if(cargo.current){
        if(phase==='TRUCK_UNLOADING'){
          cargo.current.position.x=-.8-2.5*smoothstep(0,3.2,elapsed.current);
          cargo.current.position.y=1.05*(1-smoothstep(2.5,3.4,elapsed.current));
        } else {
          // At the receiving dock the loaded pallet slides off the rear lift and settles on the ground.
          cargo.current.position.x=-3;
          cargo.current.position.y=1.15*(1-smoothstep(1.35,2.65,elapsed.current));
        }
      }
      if(gate.current)gate.current.rotation.z=-.55*smoothstep(0,1.2,elapsed.current);
      if(phase==='TRUCK_UNLOADING'&&elapsed.current>3.6&&done.current!==phase){done.current=phase;callback(phase)}
    }
    if(transferMode&&cargo.current){
      const loaded=['WAITING_DISPATCH_CONFIRM','DISPATCHED','IN_TRANSIT','DESTINATION_ARRIVAL','DESTINATION_PALLET_PICKUP'].includes(phase);
      cargo.current.visible=loaded;
      if(phase==='WAITING_DISPATCH_CONFIRM'&&forkCargo.current)forkCargo.current.visible=false;
    }
    const destinationPhase=transferMode&&['DESTINATION_PALLET_PICKUP','IOT_RFID_IN_SIMULATED','WAITING_RECEIVE_CONFIRM','RECEIVED','MOVE_TO_STORAGE','STORED'].includes(phase);
    const activeForkRef=destinationPhase?destinationFork:fork;const activeLiftRef=destinationPhase?destinationLift:lift;const activeCargoRef=destinationPhase?destinationCargo:forkCargo;
    if(activeForkRef.current&&routeNow&&['WORKER_APPROACHING','TRANSFER_PREPARING','FORKLIFT_TO_TRUCK','FORKLIFT_PICKUP','MOVE_TO_OUTBOUND','MOVE_TO_STORAGE','IOT_RFID_SIMULATED','DESTINATION_PALLET_PICKUP','IOT_RFID_IN_SIMULATED','FORKLIFT_DELIVER_TO_TRUCK'].includes(phase)){
      // WareTrack's simulated forklift cruises around 2.2–2.6 m/s. Smoothstep has a 1.5×
      // peak/average ratio, so durations below are based on measured route length and keep peaks realistic.
      const travel=phase==='WORKER_APPROACHING'?2.8:phase==='TRANSFER_PREPARING'?10.5:phase==='MOVE_TO_OUTBOUND'?15:phase==='MOVE_TO_STORAGE'?11.5:phase==='IOT_RFID_IN_SIMULATED'?18:phase==='IOT_RFID_SIMULATED'?15:phase==='FORKLIFT_DELIVER_TO_TRUCK'?12.5:phase==='FORKLIFT_TO_TRUCK'?4.2:phase==='DESTINATION_PALLET_PICKUP'?4.2:5.8;
      const t=Math.min(1,elapsed.current/travel);const p=sampleRoute(routeNow,smoothstep(0,1,t),.34);activeForkRef.current.position.set(p.x,0,p.z);
      // The WareTrack forklift points along local -Z in this scene; steer through turns smoothly.
      const heading=Math.atan2(-p.dx,-p.dz);
      activeForkRef.current.rotation.y=heading;
      if(activeLiftRef.current){activeLiftRef.current.position.y=phase==='FORKLIFT_TO_TRUCK'?.08:phase==='FORKLIFT_PICKUP'?.08+.5*smoothstep(12.2,13.2,elapsed.current):phase==='DESTINATION_PALLET_PICKUP'?.08+.5*smoothstep(4.2,5.25,elapsed.current):phase==='MOVE_TO_STORAGE'?.08+.5*(1-smoothstep(9.8,10.8,elapsed.current)):phase==='IOT_RFID_IN_SIMULATED'?.58:phase==='IOT_RFID_SIMULATED'||phase==='MOVE_TO_OUTBOUND'||phase==='FORKLIFT_DELIVER_TO_TRUCK'?.58:.08;}
      if(activeCargoRef.current)activeCargoRef.current.visible=phase==='FORKLIFT_TO_TRUCK'?false:phase==='DESTINATION_PALLET_PICKUP'?elapsed.current>5.25:phase==='PALLET_UNLOADING'||phase==='MOVE_TO_OUTBOUND'||phase==='IOT_RFID_OUT_SIMULATED'||phase==='FORKLIFT_DELIVER_TO_TRUCK'||phase==='MOVE_TO_STORAGE'||phase==='IOT_RFID_SIMULATED'||phase==='IOT_RFID_IN_SIMULATED';
      if(phase==='DESTINATION_PALLET_PICKUP'&&elapsed.current>5.25&&cargo.current)cargo.current.visible=false;
      if(done.current!==phase&&(phase==='DESTINATION_PALLET_PICKUP'?elapsed.current>=6:t>=1)){done.current=phase;callback(phase)}
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
    }
    if(phase==='TRANSFER_LOADING_TRUCK'){
      const raised=smoothstep(0,.75,elapsed.current);
      const lowering=smoothstep(1.1,2,elapsed.current);
      if(lift.current)lift.current.position.y=.08+.92*raised*(1-lowering);
      if(elapsed.current>=1.25){if(forkCargo.current)forkCargo.current.visible=false;if(cargo.current)cargo.current.visible=true;}
    }
    if(phase==='STORED'){if(forkCargo.current)forkCargo.current.visible=false;if(destinationCargo.current)destinationCargo.current.visible=false;}
  });
  const activeTruck=state!=='IDLE'&&state!=='COMPLETE';
  const destinationForkActive=transferMode&&['DESTINATION_PALLET_PICKUP','IOT_RFID_IN_SIMULATED','WAITING_RECEIVE_CONFIRM','RECEIVED','MOVE_TO_STORAGE','STORED','COMPLETE'].includes(state);
  const activeFork=!destinationForkActive&&!['DISPATCHED','IN_TRANSIT','DESTINATION_ARRIVAL'].includes(state);
  if(fork.current&&(state==='IDLE'||state==='COMPLETE'))fork.current.position.set(10,0,5.1);
  return <>
    <group ref={truck} position={[19.8,0,15]} visible={activeTruck}>
      <FreightTruckModel refrigerated/>
      <group ref={gate} position={[-1.7,.65,0]}><mesh><boxGeometry args={[.12,1.2,1.65]}/><meshStandardMaterial color="#d8e5eb"/></mesh></group>
      <group ref={cargo} position={[-.8,1.15,0]}><LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/><Label position={[0,1.5,0]} size={.19}>{product?.name ?? 'KIỆN HÀNG'}</Label></group>
    </group>
    <group ref={fork} position={[10,0,5.1]} visible={activeFork}>
      <ForkliftVehicle liftRef={lift} driverRef={driver} steeringRef={steering} cargo={<group ref={forkCargo} position={[0,.1,0]} visible={false}><LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/></group>}/>
    </group>
    {transferMode&&<group ref={pickPallet} position={[-4.7,0,-2.2]} visible={state==='TRANSFER_PREPARING'||state==='FORKLIFT_PICKUP'}>
      <LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/>
      <Label position={[0,1.25,0]} size={.16} color="#80521a">{product?.name ?? 'PALLET THEO PHIẾU'}</Label>
    </group>}
    {transferMode&&<group ref={destinationFork} position={[13.5,0,destinationZ+11.5]} visible={destinationForkActive}>
      <ForkliftVehicle liftRef={destinationLift} driverRef={destinationDriver} steeringRef={destinationSteering} cargo={<group ref={destinationCargo} position={[0,.1,0]} visible={false}><LogisticsPallet kind={inventory?packagingFor(inventory.sku.product.name):'cardboard'}/></group>}/>
    </group>}
  </>;
}
function Campus({ props }: { props: Props }) {
  const selectedId=props.selectedItem?.id;
  const idle=props.demoState==='IDLE'||props.demoState==='COMPLETE';
  return <>
    <color attach="background" args={['#dce9f1']}/><fog attach="fog" args={['#dce9f1',65,140]}/>
    <ambientLight intensity={1.35}/><directionalLight position={[18,25,18]} intensity={2.2} castShadow shadow-mapSize={[2048,2048]}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.055,-15]} receiveShadow><planeGeometry args={[62,100]}/><meshStandardMaterial color="#d4dce0"/></mesh>
    {/* marked two-way truck road and yard apron */}
    <mesh rotation={[-Math.PI/2,0,0]} position={[ROAD_CENTER_X,-.045,ROAD_CENTER_Z]}><planeGeometry args={[ROAD_WIDTH,ROAD_LENGTH]}/><meshStandardMaterial color="#8299aa"/></mesh>
    {Array.from({length:16},(_,i)=><mesh key={i} rotation={[-Math.PI/2,0,0]} position={[ROAD_CENTER_X,-.025,28-i*6]}><planeGeometry args={[.16,2.3]}/><meshBasicMaterial color="#f3d36a"/></mesh>)}
    {Array.from({length:16},(_,i)=><Fragment key={`road-edge-${i}`}>
      <mesh rotation={[-Math.PI/2,0,0]} position={[ROAD_CENTER_X-ROAD_WIDTH/2+.18,-.026,28-i*6]}><planeGeometry args={[.08,2.5]}/><meshBasicMaterial color="#e8eef0" transparent opacity={.62}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[ROAD_CENTER_X+ROAD_WIDTH/2-.18,-.026,28-i*6]}><planeGeometry args={[.08,2.5]}/><meshBasicMaterial color="#e8eef0" transparent opacity={.62}/></mesh>
    </Fragment>)}
    {['TRUCK_UNLOADING','WORKER_APPROACHING','FORKLIFT_TO_TRUCK','PALLET_UNLOADING'].includes(props.demoState)&&<>
      <group position={[7.1,-.02,11.5]}>
        <mesh position={[0,0,-1.15]}><boxGeometry args={[2.5,.025,.07]}/><meshBasicMaterial color="#f5bf35"/></mesh>
        <mesh position={[0,0,1.15]}><boxGeometry args={[2.5,.025,.07]}/><meshBasicMaterial color="#f5bf35"/></mesh>
        <mesh position={[-1.22,0,0]}><boxGeometry args={[.07,.025,2.3]}/><meshBasicMaterial color="#f5bf35"/></mesh>
        <mesh position={[1.22,0,0]}><boxGeometry args={[.07,.025,2.3]}/><meshBasicMaterial color="#f5bf35"/></mesh>
      </group>
      <Label position={[7.1,2,11.5]} size={.2} color="#a56608">{props.demoState==='TRUCK_UNLOADING'?'ĐIỂM HẠ PALLET':props.demoState==='PALLET_UNLOADING'?'XE NÂNG ĐANG NHẤC PALLET':'PALLET ĐÃ HẠ · CHỜ XE NÂNG'}</Label>
    </>}
    {Array.from({length:3},(_,i)=><Warehouse key={props.campusWarehouses[i]?.id??i} site={props.campusWarehouses[i]??{id:`site-${i}`,name:'Kho FreshMart',code:`WH-0${i+1}`,storeName:'Chi nhánh',items:[]}} index={i} onSelectItem={props.onSelectItem} selectedItemId={selectedId} onSelectZone={props.onSelectZone} selectedZone={props.selectedZone} activeSite={i===0||(props.transferMode&&props.campusWarehouses[i]?.id===props.destinationWarehouseId&&['DESTINATION_PALLET_PICKUP','IOT_RFID_IN_SIMULATED','WAITING_RECEIVE_CONFIRM','RECEIVED','MOVE_TO_STORAGE','STORED','COMPLETE'].includes(props.demoState))} demoState={props.demoState}/>)}
    <LogisticsYard/>{idle&&!props.demoPaused&&<YardTraffic enabled/>}
    <ActiveVehicles state={props.demoState} paused={props.demoPaused} runId={props.demoRunId} callback={props.onMotionComplete} product={props.demoProduct} inventory={props.demoInventory} transferMode={props.transferMode} destinationZ={props.transferMode?-Math.max(0,props.campusWarehouses.findIndex(site=>site.id===props.destinationWarehouseId))*24:0}/>
    <MapControls makeDefault enableRotate enableDamping dampingFactor={.08} minDistance={18} maxDistance={90} maxPolarAngle={Math.PI/2.12} target={[0,0,-24]}/>
  </>;
}

export function WarehouseTwinScene(props: Props) {
  return <Canvas shadows dpr={[1,1.6]} camera={{position:[28,30,14],fov:43,near:.1,far:220}} gl={{antialias:true,alpha:false}}>
    <Campus props={props}/>
  </Canvas>;
}
