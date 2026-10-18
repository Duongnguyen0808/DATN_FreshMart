'use client';

import { Text } from '@react-three/drei';

export function FreightYard() {
  return <group>
    {[-21.5, 21.5].map((x) => <group key={x}>
      <mesh position={[x, -0.105, -18]} receiveShadow><boxGeometry args={[7.5, 0.05, 67]} /><meshStandardMaterial color="#c7d0d2" roughness={0.98} /></mesh>
      {[-43, -25, -7, 10].map((z) => <group key={z} position={[x, -0.067, z]}>
        {[-1.8, 1.8].map((side) => <mesh key={side} position={[side, 0, 0]}><boxGeometry args={[0.07, 0.015, 8.2]} /><meshStandardMaterial color="#f1efdc" /></mesh>)}
        <mesh position={[0, 0, -4.1]}><boxGeometry args={[3.6, 0.015, 0.07]} /><meshStandardMaterial color="#f1efdc" /></mesh>
      </group>)}
    </group>)}
    {/* Entrance checkpoint and weigh-in apron; the travel lanes remain clear. */}
    {[-17, 17].map((x) => <mesh key={x} position={[x, 0.7, 18]} castShadow><boxGeometry args={[0.4, 1.4, 0.4]} /><meshStandardMaterial color="#b0c2cc" roughness={0.8} /></mesh>)}
    <group position={[0, 0, 18.5]}>
      <mesh position={[0, -0.07, 0]} receiveShadow><boxGeometry args={[33, 0.05, 4.5]} /><meshStandardMaterial color="#82939e" roughness={0.96} /></mesh>
      <Text position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.8} color="#f4f0d7">KHU GIAO NHẬN HÀNG</Text>
    </group>
  </group>;
}
