'use client';

import { Text } from '@react-three/drei';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, type Group } from 'three';

function YardWorker({ paused }: { paused: boolean }) {
  const person = useRef<Group>(null);
  const legs = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    if (paused) return;
    elapsed.current += Math.min(delta, .05);
    if (person.current) {
      person.current.position.z = 1 + Math.sin(elapsed.current * .16) * 3;
      const heading = Math.cos(elapsed.current * .16) >= 0 ? 0 : Math.PI;
      person.current.rotation.y = MathUtils.damp(person.current.rotation.y, heading, 4, Math.min(delta, .05));
    }
    const stride = Math.abs(Math.cos(elapsed.current * .16));
    if (legs.current) legs.current.children.forEach((leg, i) => { leg.rotation.x = Math.sin(elapsed.current * 5 + i * Math.PI) * .25 * stride; });
  });
  return <group ref={person} position={[-16, 0, 1]}>
    <group ref={legs} position={[0,.52,0]}>{[-.14,.14].map(x => <group key={x} position={[x,0,0]}>
      <mesh position={[0,-.23,0]} castShadow><boxGeometry args={[.17,.46,.2]}/><meshStandardMaterial color="#344b60"/></mesh>
      <mesh position={[0,-.46,.06]} castShadow><boxGeometry args={[.2,.12,.34]}/><meshStandardMaterial color="#26323b"/></mesh>
    </group>)}</group>
    <mesh position={[0,.84,0]} castShadow><boxGeometry args={[.46,.62,.28]}/><meshStandardMaterial color="#e4ad3c"/></mesh>
    <mesh position={[0,.76,.15]}><boxGeometry args={[.47,.07,.015]}/><meshStandardMaterial color="#edf0ed"/></mesh>
    <mesh position={[0,1.28,0]} castShadow><sphereGeometry args={[.18,12,10]}/><meshStandardMaterial color="#c99573"/></mesh>
    <mesh position={[0,1.43,0]} castShadow><sphereGeometry args={[.21,12,8,0,Math.PI*2,0,Math.PI/2]}/><meshStandardMaterial color="#f0d469"/></mesh>
    {[-.3,.3].map(x => <mesh key={x} position={[x,.84,0]} castShadow><boxGeometry args={[.13,.47,.15]}/><meshStandardMaterial color="#354f60"/></mesh>)}
  </group>;
}

/** Fixed equipment stays outside the forklift aisle and the loading apron. */
export function WarehouseDetails({ paused = false }: { paused?: boolean }) {
  return <group>
    <YardWorker paused={paused}/>
    {/* Concrete expansion joints: flat markings, no obstacles in vehicle paths. */}
    {[-5,0,5].map(z => <mesh key={`joint-${z}`} rotation={[-Math.PI/2,0,0]} position={[0,-.047,z]}><planeGeometry args={[16,.025]}/><meshStandardMaterial color="#b6b8ba" roughness={1}/></mesh>)}
    {[-4,0,4].map(x => <mesh key={`joint-x-${x}`} rotation={[-Math.PI/2,0,0]} position={[x,-.047,0]}><planeGeometry args={[.025,13.4]}/><meshStandardMaterial color="#b6b8ba" roughness={1}/></mesh>)}
    {/* Service walkway is outside the vehicle and forklift routes. */}
    <mesh rotation={[-Math.PI/2,0,0]} position={[-16,-.025,0]} receiveShadow><planeGeometry args={[2.1,14.2]}/><meshStandardMaterial color="#b2c5c8" roughness={.92}/></mesh>
    {[-17.05,-14.95].map(x => <mesh key={x} rotation={[-Math.PI/2,0,0]} position={[x,-.01,0]}><planeGeometry args={[.07,14.2]}/><meshBasicMaterial color="#ffffff"/></mesh>)}
    {/* Pedestrian zebra crosswalk connecting walkway to the RFID employee access door */}
    {[-14.2,-13.4,-12.6,-11.8,-11.0,-10.2].map(cx => <mesh key={`zebra-${cx}`} rotation={[-Math.PI/2,0,0]} position={[cx,-.02,2.5]}><planeGeometry args={[.42,1.35]}/><meshBasicMaterial color="#f8fafc" transparent opacity={.85}/></mesh>)}
    <Text font="/fonts/ibm-plex-sans.ttf" position={[-16,.01,5.4]} rotation={[-Math.PI/2,0,Math.PI/2]} fontSize={.22} color="#1f4d4b">LỐI ĐI BỘ</Text>
    <group position={[-12,0,-1]}>
      {[-1.7,1.7].map(x => <mesh key={x} position={[x,1.65,-2.1]} castShadow><boxGeometry args={[.09,3.3,.09]}/><meshStandardMaterial color="#4c696b"/></mesh>)}
      <mesh position={[0,3.3,-.7]} rotation={[-.08,0,0]} castShadow><boxGeometry args={[4.1,.12,3.8]}/><meshStandardMaterial color="#65CFC7" roughness={.75}/></mesh>
      <mesh position={[0,3.15,1.2]}><boxGeometry args={[4.1,.24,.08]}/><meshStandardMaterial color="#3a7474"/></mesh>
    </group>
    {[-5.8,-1.8,2.2,6.2].map((x,i) => <group key={x} position={[x,3.7,-6.58]}>
      <mesh><boxGeometry args={[1.05,.42,.06]}/><meshStandardMaterial color="#39616a"/></mesh>
      <Text font="/fonts/ibm-plex-sans.ttf" position={[0,0,.04]} fontSize={.23} color="#f8f4dd">{i===0?'LỐI KHO':`A-${String(i).padStart(2,'0')}`}</Text>
    </group>)}
    {[-8, 8].map(x => <group key={x}>
      {[-6, -1, 5.8].map(z => <mesh key={z} position={[x, 2.4, z]} castShadow><boxGeometry args={[.22, 4.8, .22]}/><meshStandardMaterial color="#526773" metalness={.45} roughness={.6}/></mesh>)}
      <mesh position={[x, .35, 0]}><boxGeometry args={[.12, .28, 13]}/><meshStandardMaterial color="#d6a33e"/></mesh>
    </group>)}
    {[-6, 5.8].map(z => <mesh key={z} position={[0, 4.65, z]} castShadow><boxGeometry args={[16.2, .22, .22]}/><meshStandardMaterial color="#526773" metalness={.4}/></mesh>)}
    {[-6.2, -3.3].map(x => <mesh key={x} position={[x, -.035, -.8]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.07, 10]}/><meshStandardMaterial color="#e8b94c"/></mesh>)}
    {/* Inspection desk and empty pallet return area, beside the building. */}
    <group position={[-12, 0, 2]}>
      <mesh position={[0, -.015, 0]} rotation={[-Math.PI/2, 0, 0]} receiveShadow><planeGeometry args={[5.2, 7]}/><meshStandardMaterial color="#bfc3c5"/></mesh>
      {[-2.5, 2.5].map(x => <mesh key={x} position={[x, .005, 0]} rotation={[-Math.PI/2, 0, 0]}><planeGeometry args={[.08, 7]}/><meshBasicMaterial color="#f2e9cb"/></mesh>)}
      <mesh position={[0, 1.15, -2]} castShadow><boxGeometry args={[2.6, .13, 1.1]}/><meshStandardMaterial color="#e3e6de"/></mesh>
      {[-1.1, 1.1].map(x => <mesh key={x} position={[x, .55, -2]} castShadow><boxGeometry args={[.12, 1.1, .8]}/><meshStandardMaterial color="#526773"/></mesh>)}
      <mesh position={[.5, 1.53, -2.3]} castShadow><boxGeometry args={[.75, .55, .08]}/><meshStandardMaterial color="#243e48"/></mesh>
      <mesh position={[.5, 1.53, -2.25]}><planeGeometry args={[.64, .43]}/><meshBasicMaterial color="#77b2b0"/></mesh>
      <Text font="/fonts/ibm-plex-sans.ttf" position={[0, 2.3, -2.5]} fontSize={.22} color="#244c50">KIỂM HÀNG · ĐÓNG GÓI</Text>
      {[0, 1, 2, 3].map(level => <group key={level} position={[0, .12 + level*.2, 1.5]}>
        {[-.6, 0, .6].map(z => <mesh key={z} position={[0, 0, z]} castShadow><boxGeometry args={[2, .09, .2]}/><meshStandardMaterial color="#b78d5f"/></mesh>)}
        {[-.8, .8].map(x => <mesh key={x} position={[x, -.07, 0]} castShadow><boxGeometry args={[.16, .09, 1.5]}/><meshStandardMaterial color="#98744e"/></mesh>)}
      </group>)}
      <Text font="/fonts/ibm-plex-sans.ttf" position={[0, .02, 2.8]} rotation={[-Math.PI/2, 0, 0]} fontSize={.24} color="#355e60">PALLET RỖNG</Text>
    </group>
    <group position={[7.8, .65, 5.3]}>
      <mesh castShadow><cylinderGeometry args={[.15, .15, .75, 12]}/><meshStandardMaterial color="#c84236"/></mesh>
      <mesh position={[0, .43, 0]}><boxGeometry args={[.19, .12, .12]}/><meshStandardMaterial color="#263b42"/></mesh>
    </group>
  </group>;
}
