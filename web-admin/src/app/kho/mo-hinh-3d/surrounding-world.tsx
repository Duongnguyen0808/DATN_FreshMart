'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { ROAD_CENTER_X, ROAD_WIDTH } from './logistics-yard';
import {
  getAsphaltTexture,
  getConcreteYardTexture,
  getCorrugatedMetalTexture,
  getFacadeWindowTexture,
  getGrassTexture,
} from './procedural-textures';

const BOULEVARD_Z = 39;
const BOULEVARD_WIDTH = 9.2;

function LushTree({
  position,
  scale = 1,
  variant = 0,
}: {
  position: [number, number, number];
  scale?: number;
  variant?: number;
}) {
  const leafPalette = ['#3f7d4e', '#4d8e5c', '#356d43', '#5a9b68'];
  const mainColor = leafPalette[variant % leafPalette.length]!;
  const accentColor = leafPalette[(variant + 1) % leafPalette.length]!;
  return (
    <group position={position} scale={scale}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[0.68, 10]} />
        <meshStandardMaterial color="#5b4636" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.13, 0.23, 2.2, 6]} />
        <meshStandardMaterial color="#684e39" roughness={0.92} />
      </mesh>
      <mesh position={[0, 2.6, 0]}>
        <dodecahedronGeometry args={[1.08, 0]} />
        <meshStandardMaterial color={mainColor} roughness={0.86} />
      </mesh>
      <mesh position={[0.58, 2.28, 0.36]}>
        <dodecahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color={accentColor} roughness={0.88} />
      </mesh>
      <mesh position={[-0.52, 2.38, -0.32]}>
        <dodecahedronGeometry args={[0.74, 0]} />
        <meshStandardMaterial color={accentColor} roughness={0.88} />
      </mesh>
      <mesh position={[0.12, 3.28, -0.15]}>
        <dodecahedronGeometry args={[0.64, 0]} />
        <meshStandardMaterial color={mainColor} roughness={0.85} />
      </mesh>
    </group>
  );
}

function ParkedCar({
  position,
  rotationY = 0,
  color = '#3b82f6',
}: {
  position: [number, number, number];
  rotationY?: number;
  color?: string;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.38, 0]}>
        <boxGeometry args={[1.78, 0.44, 3.95]} />
        <meshStandardMaterial color={color} roughness={0.26} metalness={0.48} />
      </mesh>
      <mesh position={[0, 0.56, 1.35]} rotation={[0.08, 0, 0]}>
        <boxGeometry args={[1.7, 0.16, 1.1]} />
        <meshStandardMaterial color={color} roughness={0.24} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.84, -0.15]}>
        <boxGeometry args={[1.46, 0.44, 2.02]} />
        <meshStandardMaterial color="#0f172a" roughness={0.08} metalness={0.85} />
      </mesh>
      <mesh position={[0, 1.08, -0.18]}>
        <boxGeometry args={[1.4, 0.05, 1.75]} />
        <meshStandardMaterial color={color} roughness={0.24} metalness={0.5} />
      </mesh>
      {[
        [-0.86, 0.25, 1.18],
        [0.86, 0.25, 1.18],
        [-0.86, 0.25, -1.18],
        [0.86, 0.25, -1.18],
      ].map(([wx, wy, wz], idx) => (
        <mesh key={idx} position={[wx, wy, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.26, 0.26, 0.18, 10]} />
          <meshStandardMaterial color="#111827" roughness={0.85} />
        </mesh>
      ))}
      {[-0.6, 0.6].map((lx, idx) => (
        <mesh key={`hl-${idx}`} position={[lx, 0.42, 1.98]}>
          <boxGeometry args={[0.32, 0.13, 0.03]} />
          <meshBasicMaterial color="#fef9c3" />
        </mesh>
      ))}
      {[-0.6, 0.6].map((lx, idx) => (
        <mesh key={`tl-${idx}`} position={[lx, 0.44, -1.98]}>
          <boxGeometry args={[0.34, 0.12, 0.03]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
      ))}
    </group>
  );
}

function DeliveryVan({ color = '#f8fafc', stripe = '#0d9488' }: { color?: string; stripe?: string }) {
  return (
    <group>
      <mesh position={[0, 0.96, -0.35]}>
        <boxGeometry args={[2.06, 1.62, 3.65]} />
        <meshStandardMaterial color={color} roughness={0.42} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0.92, -0.35]}>
        <boxGeometry args={[2.09, 0.24, 3.55]} />
        <meshStandardMaterial color={stripe} roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.74, 1.88]}>
        <boxGeometry args={[1.92, 1.15, 1.08]} />
        <meshStandardMaterial color={color} roughness={0.32} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.98, 2.42]} rotation={[-0.14, 0, 0]}>
        <boxGeometry args={[1.74, 0.48, 0.05]} />
        <meshStandardMaterial color="#0f172a" roughness={0.08} metalness={0.85} />
      </mesh>
      {[
        [-0.95, 0.29, 1.65],
        [0.95, 0.29, 1.65],
        [-0.95, 0.29, -1.35],
        [0.95, 0.29, -1.35],
      ].map(([wx, wy, wz], idx) => (
        <mesh key={idx} position={[wx, wy, wz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.3, 0.3, 0.2, 10]} />
          <meshStandardMaterial color="#111827" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** Tòa nhà kho phụ trợ / Cross-Dock công nghiệp với mái tôn, cửa cuốn bốc dỡ & pin mặt trời */
function IndustrialWarehouseBlock({
  position,
  size,
  wallColor = '#e6edf0',
  accentColor = '#0d7a73',
  corrugatedTex,
  dockFace = 'west',
  dockCount = 3,
  solar = true,
}: {
  position: [number, number, number];
  size: [number, number, number];
  wallColor?: string;
  accentColor?: string;
  corrugatedTex: THREE.CanvasTexture | null;
  dockFace?: 'west' | 'east' | 'south';
  dockCount?: number;
  solar?: boolean;
}) {
  const [w, h, d] = size;
  const isSideDock = dockFace === 'west' || dockFace === 'east';
  const span = isSideDock ? d : w;
  const dockOffsets = Array.from({ length: dockCount }, (_, i) => {
    const step = span / (dockCount + 1);
    return -span / 2 + step * (i + 1);
  });

  return (
    <group position={[position[0], h / 2 - 0.06, position[2]]}>
      {/* Thân kho công nghiệp tôn sóng */}
      <mesh receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={wallColor}
          map={corrugatedTex ?? undefined}
          roughness={0.58}
          metalness={0.2}
        />
      </mesh>
      {/* Chân tường bê tông tối màu */}
      <mesh position={[0, -h / 2 + 0.45, 0]}>
        <boxGeometry args={[w + 0.16, 0.9, d + 0.16]} />
        <meshStandardMaterial color="#334155" roughness={0.75} />
      </mesh>
      {/* Diềm mái đặc trưng khu kho */}
      <mesh position={[0, h / 2 + 0.18, 0]}>
        <boxGeometry args={[w + 0.36, 0.36, d + 0.36]} />
        <meshStandardMaterial color={accentColor} roughness={0.45} metalness={0.25} />
      </mesh>
      {/* Mái bằng công nghiệp */}
      <mesh position={[0, h / 2 + 0.37, 0]}>
        <boxGeometry args={[w - 0.2, 0.06, d - 0.2]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Các cửa dock bốc dỡ hàng + đầu container rơ-moóc đỗ sẵn */}
      {dockOffsets.map((offset, idx) => {
        const doorPos: [number, number, number] =
          dockFace === 'west'
            ? [-w / 2 - 0.04, -h / 2 + 1.65, offset]
            : dockFace === 'east'
              ? [w / 2 + 0.04, -h / 2 + 1.65, offset]
              : [offset, -h / 2 + 1.65, d / 2 + 0.04];
        const doorSize: [number, number, number] = isSideDock ? [0.1, 2.9, 2.6] : [2.6, 2.9, 0.1];
        return (
          <group key={`dock-${idx}`}>
            <mesh position={doorPos}>
              <boxGeometry args={doorSize} />
              <meshStandardMaterial color="#475569" roughness={0.45} metalness={0.45} />
            </mesh>
            {/* Mái hiên che mưa cửa dock */}
            <mesh
              position={[
                dockFace === 'west' ? -w / 2 - 0.55 : dockFace === 'east' ? w / 2 + 0.55 : offset,
                -h / 2 + 3.25,
                isSideDock ? offset : d / 2 + 0.55,
              ]}
            >
              <boxGeometry args={isSideDock ? [1.1, 0.1, 3.0] : [3.0, 0.1, 1.1]} />
              <meshStandardMaterial color={accentColor} roughness={0.5} />
            </mesh>
          </group>
        );
      })}
      {/* Dàn pin năng lượng mặt trời trên mái kho */}
      {solar && (
        <group position={[0, h / 2 + 0.52, 0]}>
          {[-d * 0.24, 0, d * 0.24].map((sz, i) => (
            <mesh key={i} position={[0, 0, sz]} rotation={[0.2, 0, 0]}>
              <boxGeometry args={[w * 0.72, 0.08, Math.min(2.3, d * 0.18)]} />
              <meshStandardMaterial color="#172554" roughness={0.14} metalness={0.84} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/** Tòa nhà điều hành trung tâm khu kho (Logistics Control Tower / Office) */
function LogisticsControlOffice({
  position,
  facadeTex,
}: {
  position: [number, number, number];
  facadeTex: THREE.CanvasTexture | null;
}) {
  return (
    <group position={[position[0], 0, position[2]]}>
      <mesh position={[0, 4.8, 0]} receiveShadow>
        <boxGeometry args={[15, 9.6, 13]} />
        <meshStandardMaterial color="#dbeafe" map={facadeTex ?? undefined} roughness={0.35} metalness={0.28} />
      </mesh>
      <mesh position={[0, 9.75, 0]}>
        <boxGeometry args={[15.4, 0.35, 13.4]} />
        <meshStandardMaterial color="#0f766e" roughness={0.45} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <boxGeometry args={[15.3, 1.4, 13.3]} />
        <meshStandardMaterial color="#1e293b" roughness={0.6} />
      </mesh>
      {/* Sảnh đón kính phía mặt đường */}
      <mesh position={[-8.1, 1.8, 0]}>
        <boxGeometry args={[1.6, 0.16, 6.2]} />
        <meshStandardMaterial color="#0d9488" roughness={0.4} metalness={0.3} />
      </mesh>
      <Text
        font="/fonts/ibm-plex-sans.ttf"
        position={[-7.55, 8.6, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        fontSize={0.62}
        color="#0f766e"
        outlineWidth={0.04}
        outlineColor="#ffffff"
        anchorX="center"
        anchorY="middle"
      >
        TRUNG TÂM ĐIỀU HÀNH KHU KHO
      </Text>
    </group>
  );
}

/** Cụm Bồn chứa nước PCCC & Trạm làm lạnh công nghiệp (Cold-Chain Chiller Plant) */
function IndustrialUtilityZone({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Sàn bê tông kỹ thuật */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[13, 12]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.9} />
      </mesh>
      {/* Hai bồn inox công nghiệp lớn */}
      {[-3.2, 0.8].map((x, idx) => (
        <group key={`tank-${idx}`} position={[x, 0, -2.5]}>
          <mesh position={[0, 2.8, 0]}>
            <cylinderGeometry args={[1.65, 1.65, 5.6, 16]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.25} metalness={0.78} />
          </mesh>
          <mesh position={[0, 5.7, 0]}>
            <cylinderGeometry args={[0.2, 1.65, 0.45, 16]} />
            <meshStandardMaterial color="#94a3b8" roughness={0.3} metalness={0.75} />
          </mesh>
          <mesh position={[0, 4.6, 0]}>
            <cylinderGeometry args={[1.68, 1.68, 0.42, 16]} />
            <meshStandardMaterial color={idx === 0 ? '#0d9488' : '#dc2626'} roughness={0.45} />
          </mesh>
        </group>
      ))}
      {/* Cụm máy lạnh Chiller & máy phát điện dự phòng */}
      <mesh position={[2.2, 1.3, 2.8]}>
        <boxGeometry args={[4.8, 2.6, 2.6]} />
        <meshStandardMaterial color="#475569" roughness={0.55} metalness={0.35} />
      </mesh>
      <mesh position={[2.2, 2.65, 2.8]}>
        <boxGeometry args={[4.4, 0.25, 2.2]} />
        <meshStandardMaterial color="#1e293b" roughness={0.5} />
      </mesh>
      {/* Tháp nước PCCC cao nổi bật */}
      <group position={[-3.5, 0, 3.2]}>
        {[
          [-0.9, -0.9],
          [0.9, -0.9],
          [-0.9, 0.9],
          [0.9, 0.9],
        ].map(([lx, lz], i) => (
          <mesh key={`leg-${i}`} position={[lx, 4.2, lz]}>
            <cylinderGeometry args={[0.1, 0.14, 8.4, 6]} />
            <meshStandardMaterial color="#475569" metalness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, 9.5, 0]}>
          <cylinderGeometry args={[1.7, 1.5, 2.6, 14]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.45} />
        </mesh>
        <mesh position={[0, 9.5, 0]}>
          <cylinderGeometry args={[1.72, 1.62, 0.65, 14]} />
          <meshStandardMaterial color="#dc2626" roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

/** Bãi xếp Container 20ft/40ft đặc trưng khu kho vận */
function ContainerYardStack({
  position,
  corrugatedTex,
}: {
  position: [number, number, number];
  corrugatedTex: THREE.CanvasTexture | null;
}) {
  const containers = [
    { pos: [0, 1.3, 0] as [number, number, number], color: '#0d9488' },
    { pos: [2.8, 1.3, 0] as [number, number, number], color: '#334155' },
    { pos: [5.6, 1.3, 0] as [number, number, number], color: '#c2410c' },
    { pos: [0, 3.9, 0] as [number, number, number], color: '#1e3a8a' },
    { pos: [2.8, 3.9, 0] as [number, number, number], color: '#0f766e' },
    { pos: [0, 1.3, 7.2] as [number, number, number], color: '#475569' },
    { pos: [2.8, 1.3, 7.2] as [number, number, number], color: '#0d9488' },
  ];
  return (
    <group position={position}>
      {containers.map((c, idx) => (
        <mesh key={`cy-${idx}`} position={c.pos}>
          <boxGeometry args={[2.45, 2.55, 6.1]} />
          <meshStandardMaterial
            color={c.color}
            map={corrugatedTex ?? undefined}
            roughness={0.55}
            metalness={0.28}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Cổng chào Khu Kho FreshMart bắc ngang đường chính (cao 5.6m, xe tải đi lọt hoàn toàn bên dưới) */
function LogisticsParkGateArch() {
  return (
    <group position={[ROAD_CENTER_X, -0.05, 31.8]}>
      {/* Hai trụ cổng hai bên mép đường (x = 18 ± 4.8) */}
      {[-4.85, 4.85].map((px, i) => (
        <group key={`arch-col-${i}`} position={[px, 0, 0]}>
          <mesh position={[0, 3.0, 0]}>
            <boxGeometry args={[0.75, 6.0, 0.85]} />
            <meshStandardMaterial color="#1e293b" roughness={0.45} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[0.92, 1.1, 1.02]} />
            <meshStandardMaterial color="#f59e0b" roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* Dầm cổng bắc ngang ở độ cao 5.65m */}
      <mesh position={[0, 5.65, 0]}>
        <boxGeometry args={[10.8, 1.15, 0.95]} />
        <meshStandardMaterial color="#0f766e" roughness={0.38} metalness={0.28} />
      </mesh>
      <mesh position={[0, 5.65, 0.49]}>
        <boxGeometry args={[9.2, 0.82, 0.04]} />
        <meshStandardMaterial color="#ffffff" roughness={0.35} />
      </mesh>
      <Text
        font="/fonts/ibm-plex-sans.ttf"
        position={[0, 5.76, 0.53]}
        fontSize={0.38}
        color="#0f766e"
        anchorX="center"
        anchorY="middle"
      >
        FRESHMART LOGISTICS PARK
      </Text>
      <Text
        font="/fonts/ibm-plex-sans.ttf"
        position={[0, 5.42, 0.53]}
        fontSize={0.17}
        color="#334155"
        anchorX="center"
        anchorY="middle"
      >
        KHU KHO PHÂN PHỐI THÔNG MINH · KHO 1 – 3
      </Text>
      {/* Đèn báo làn xe trên cổng */}
      <mesh position={[-2.0, 5.02, 0.4]}>
        <boxGeometry args={[0.9, 0.12, 0.12]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
      <mesh position={[2.0, 5.02, 0.4]}>
        <boxGeometry args={[0.9, 0.12, 0.12]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
    </group>
  );
}

/** Trạm cân xe tải điện tử gắn chìm trên làn xe nhập kho (phẳng mặt đường, xe chạy qua bình thường) */
function TruckWeighbridge() {
  return (
    <group position={[ROAD_CENTER_X - 2, -0.04, 24.5]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[3.2, 7.6]} />
        <meshStandardMaterial color="#334155" roughness={0.45} metalness={0.55} />
      </mesh>
      {[-1.55, 1.55].map((wx, i) => (
        <mesh key={`wb-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[wx, 0.008, 0]}>
          <planeGeometry args={[0.14, 7.6]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      ))}
      {/* Bảng LED hiển thị trọng lượng xe bên mép đường */}
      <group position={[-2.4, 0, 0]}>
        <mesh position={[0, 1.1, 0]}>
          <cylinderGeometry args={[0.07, 0.09, 2.2, 6]} />
          <meshStandardMaterial color="#334155" metalness={0.5} />
        </mesh>
        <mesh position={[0, 2.2, 0]}>
          <boxGeometry args={[1.4, 0.65, 0.16]} />
          <meshStandardMaterial color="#0f172a" roughness={0.4} />
        </mesh>
        <Text
          font="/fonts/ibm-plex-sans.ttf"
          position={[0, 2.32, 0.1]}
          fontSize={0.13}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
        >
          TRẠM CÂN 60T
        </Text>
        <Text
          font="/fonts/ibm-plex-sans.ttf"
          position={[0, 2.08, 0.1]}
          fontSize={0.19}
          color="#22c55e"
          anchorX="center"
          anchorY="middle"
        >
          READY · 00.0T
        </Text>
      </group>
    </group>
  );
}

/** Cột cờ khu kho với lá cờ bay nhẹ */
function EntranceFlagpoles({ paused }: { paused: boolean }) {
  const flagRefs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    if (paused) return;
    const t = clock.elapsedTime;
    flagRefs.current.forEach((f, idx) => {
      if (f) f.rotation.y = Math.sin(t * 2.4 + idx * 0.9) * 0.14;
    });
  });

  const colors = ['#0d9488', '#e11d48', '#2563eb'];
  return (
    <group position={[-7.5, -0.05, 31.2]}>
      {[-1.6, 0, 1.6].map((fx, idx) => (
        <group key={`flag-${idx}`} position={[fx, 0, 0]}>
          <mesh position={[0, 3.0, 0]}>
            <cylinderGeometry args={[0.04, 0.06, 6.0, 6]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.75} roughness={0.25} />
          </mesh>
          <mesh
            ref={el => {
              flagRefs.current[idx] = el;
            }}
            position={[0.55, 5.45, 0]}
          >
            <boxGeometry args={[1.1, 0.68, 0.03]} />
            <meshStandardMaterial color={colors[idx]!} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function BoulevardLamp({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 2.9, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 5.8, 6]} />
        <meshStandardMaterial color="#1e293b" metalness={0.65} roughness={0.35} />
      </mesh>
      <mesh position={[0.65, 5.75, 0]}>
        <boxGeometry args={[1.4, 0.08, 0.09]} />
        <meshStandardMaterial color="#1e293b" metalness={0.65} />
      </mesh>
      <mesh position={[1.22, 5.68, 0]}>
        <boxGeometry args={[0.65, 0.1, 0.28]} />
        <meshStandardMaterial color="#fef3c7" emissive="#fde68a" emissiveIntensity={0.65} />
      </mesh>
    </group>
  );
}

function TrafficSignal({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 2.4, 0]}>
        <cylinderGeometry args={[0.08, 0.11, 4.8, 6]} />
        <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[1.1, 4.6, 0]}>
        <boxGeometry args={[2.3, 0.1, 0.1]} />
        <meshStandardMaterial color="#1e293b" metalness={0.6} />
      </mesh>
      <mesh position={[1.8, 4.35, 0]}>
        <boxGeometry args={[0.32, 0.86, 0.26]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} />
      </mesh>
      <mesh position={[1.8, 4.62, 0.14]}>
        <circleGeometry args={[0.09, 8]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <mesh position={[1.8, 4.35, 0.14]}>
        <circleGeometry args={[0.09, 8]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
      <mesh position={[1.8, 4.08, 0.14]}>
        <circleGeometry args={[0.09, 8]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>
    </group>
  );
}

function DriftingClouds({ paused }: { paused: boolean }) {
  const cloudsRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (paused || !cloudsRef.current) return;
    cloudsRef.current.position.x = ((clock.elapsedTime * 0.9) % 240) - 120;
  });

  const clouds = useMemo(
    () => [
      { pos: [-55, 50, -68] as [number, number, number], scale: 1.4 },
      { pos: [10, 52, -88] as [number, number, number], scale: 1.6 },
      { pos: [55, 48, -32] as [number, number, number], scale: 1.3 },
    ],
    []
  );

  return (
    <group ref={cloudsRef}>
      {clouds.map((c, idx) => (
        <group key={idx} position={c.pos} scale={c.scale}>
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[4.2, 8, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.72} />
          </mesh>
          <mesh position={[3.6, -0.6, 0.8]}>
            <sphereGeometry args={[3.1, 8, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.68} />
          </mesh>
          <mesh position={[-3.4, -0.7, -0.6]}>
            <sphereGeometry args={[3.3, 8, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.68} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function BoulevardTraffic({ paused }: { paused: boolean }) {
  const car1 = useRef<THREE.Group>(null);
  const car2 = useRef<THREE.Group>(null);
  const van1 = useRef<THREE.Group>(null);
  const car3 = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (paused) return;
    const t = clock.elapsedTime;
    if (car1.current) {
      car1.current.position.set(((t * 7.8 + 40) % 200) - 100, -0.04, BOULEVARD_Z + 2.1);
    }
    if (van1.current) {
      van1.current.position.set(((t * 6.0 + 140) % 200) - 100, -0.04, BOULEVARD_Z + 2.1);
    }
    if (car2.current) {
      car2.current.position.set(100 - ((t * 7.0 + 20) % 200), -0.04, BOULEVARD_Z - 2.1);
    }
    if (car3.current) {
      car3.current.position.set(100 - ((t * 8.4 + 115) % 200), -0.04, BOULEVARD_Z - 2.1);
    }
  });

  return (
    <group>
      <group ref={car1} position={[-40, -0.04, BOULEVARD_Z + 2.1]} rotation={[0, Math.PI / 2, 0]}>
        <ParkedCar position={[0, 0, 0]} color="#0284c7" />
      </group>
      <group ref={van1} position={[20, -0.04, BOULEVARD_Z + 2.1]} rotation={[0, Math.PI / 2, 0]}>
        <DeliveryVan color="#ffffff" stripe="#0d9488" />
      </group>
      <group ref={car2} position={[35, -0.04, BOULEVARD_Z - 2.1]} rotation={[0, -Math.PI / 2, 0]}>
        <ParkedCar position={[0, 0, 0]} color="#e11d48" />
      </group>
      <group ref={car3} position={[-35, -0.04, BOULEVARD_Z - 2.1]} rotation={[0, -Math.PI / 2, 0]}>
        <ParkedCar position={[0, 0, 0]} color="#f59e0b" />
      </group>
    </group>
  );
}

function InstancedBoulevardDashes() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 34; i++) {
      dummy.position.set(-100 + i * 6, -0.025, BOULEVARD_Z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 34]}>
      <planeGeometry args={[2.6, 0.16]} />
      <meshBasicMaterial color="#fbbf24" />
    </instancedMesh>
  );
}

export function SurroundingWorld({ paused }: { paused: boolean }) {
  const grassTex = useMemo(() => getGrassTexture(42, 42), []);
  const asphaltTex = useMemo(() => getAsphaltTexture(3, 28), []);
  const boulevardTex = useMemo(() => getAsphaltTexture(40, 3), []);
  const concreteTex = useMemo(() => getConcreteYardTexture(14, 26), []);
  const facadeTex = useMemo(() => getFacadeWindowTexture(3, 3), []);
  const corrugatedTex = useMemo(() => getCorrugatedMetalTexture(10, 2), []);

  return (
    <group>
      <DriftingClouds paused={paused} />

      {/* Nền cỏ xanh bao quanh toàn khu công nghiệp logistics */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.078, -15]} receiveShadow>
        <planeGeometry args={[460, 460]} />
        <meshStandardMaterial color="#b7ccb2" map={grassTex ?? undefined} roughness={0.96} />
      </mesh>

      {/* Sân bê tông mở rộng cho khu kho phụ trợ Đông & Tây */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[50, -0.064, -14]} receiveShadow>
        <planeGeometry args={[52, 136]} />
        <meshStandardMaterial color="#cfd8dc" map={concreteTex ?? undefined} roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-48, -0.064, -14]} receiveShadow>
        <planeGeometry args={[48, 136]} />
        <meshStandardMaterial color="#cfd8dc" map={concreteTex ?? undefined} roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.064, -84]} receiveShadow>
        <planeGeometry args={[146, 36]} />
        <meshStandardMaterial color="#cfd8dc" map={concreteTex ?? undefined} roughness={0.92} />
      </mesh>

      {/* Đường trục chính kéo dài & đại lộ phía Nam */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROAD_CENTER_X, -0.048, -110]}>
        <planeGeometry args={[ROAD_WIDTH, 92]} />
        <meshStandardMaterial color="#4b5560" map={asphaltTex ?? undefined} roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROAD_CENTER_X, -0.048, 65]}>
        <planeGeometry args={[ROAD_WIDTH, 62]} />
        <meshStandardMaterial color="#4b5560" map={asphaltTex ?? undefined} roughness={0.9} />
      </mesh>

      {/* Vỉa hè dọc đường trục */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROAD_CENTER_X + ROAD_WIDTH / 2 + 1.1, -0.04, -15]}>
        <planeGeometry args={[2.2, 190]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROAD_CENTER_X - ROAD_WIDTH / 2 - 0.6, -0.04, 29]}>
        <planeGeometry args={[1.2, 10]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.86} />
      </mesh>

      {/* Đại lộ ngoài cổng khu kho */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.042, BOULEVARD_Z]}>
        <planeGeometry args={[320, BOULEVARD_WIDTH]} />
        <meshStandardMaterial color="#444e59" map={boulevardTex ?? undefined} roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.036, BOULEVARD_Z - BOULEVARD_WIDTH / 2 - 1.1]}>
        <planeGeometry args={[320, 2.2]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.036, BOULEVARD_Z + BOULEVARD_WIDTH / 2 + 1.1]}>
        <planeGeometry args={[320, 2.2]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.86} />
      </mesh>
      <InstancedBoulevardDashes />
      {[-3.2, -2.1, -1, 0.1, 1.2, 2.3, 3.4].map((offset, idx) => (
        <mesh
          key={`zebra-${idx}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[ROAD_CENTER_X + offset, -0.024, BOULEVARD_Z - BOULEVARD_WIDTH / 2 - 0.2]}
        >
          <planeGeometry args={[0.55, 2.4]} />
          <meshBasicMaterial color="#f8fafc" transparent opacity={0.85} />
        </mesh>
      ))}

      <TrafficSignal position={[13.2, -0.04, 33.4]} />
      {[-54, -30, -6, 30, 54, 78].map(lx => (
        <BoulevardLamp key={`blamp-${lx}`} position={[lx, -0.04, BOULEVARD_Z - BOULEVARD_WIDTH / 2 - 1.5]} rotationY={-Math.PI / 2} />
      ))}
      <BoulevardTraffic paused={paused} />

      {/* Cổng chào Khu Kho FreshMart & Trạm cân xe tải điện tử */}
      <LogisticsParkGateArch />
      <TruckWeighbridge />
      <EntranceFlagpoles paused={paused} />

      {/* Bãi đỗ xe nhân viên có mái che pin mặt trời */}
      <group position={[-15.2, 0, 26.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.042, 0]} receiveShadow>
          <planeGeometry args={[12.5, 11.5]} />
          <meshStandardMaterial color="#444e59" map={asphaltTex ?? undefined} roughness={0.9} />
        </mesh>
        {[-4.4, -1.6, 1.2, 4.0].map((px, i) => (
          <mesh key={`stall-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[px, -0.032, -2.5]}>
            <planeGeometry args={[0.1, 4.8]} />
            <meshBasicMaterial color="#f8fafc" transparent opacity={0.85} />
          </mesh>
        ))}
        {[-4.2, 0, 4.2].map((cx, i) => (
          <mesh key={`carport-col-${i}`} position={[cx, 1.35, -3.9]}>
            <cylinderGeometry args={[0.09, 0.11, 2.7, 6]} />
            <meshStandardMaterial color="#334155" metalness={0.65} roughness={0.35} />
          </mesh>
        ))}
        <mesh position={[0, 2.72, -2.8]} rotation={[0.14, 0, 0]}>
          <boxGeometry args={[10.4, 0.08, 4.4]} />
          <meshStandardMaterial color="#172554" roughness={0.14} metalness={0.85} />
        </mesh>
        <ParkedCar position={[-3.0, -0.04, -2.6]} color="#f8fafc" />
        <ParkedCar position={[-0.2, -0.04, -2.6]} color="#0d9488" />
        <ParkedCar position={[2.6, -0.04, -2.6]} color="#64748b" />
        <ParkedCar position={[-3.0, -0.04, 3.0]} rotationY={Math.PI} color="#2563eb" />
      </group>

      {/* Hàng rào / tường bao khuôn viên 3 kho trung tâm */}
      <mesh position={[0, 0.25, -62.5]}>
        <boxGeometry args={[48, 0.5, 0.35]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.82} />
      </mesh>
      <mesh position={[-12, 0.2, 33.2]}>
        <boxGeometry args={[22, 0.4, 0.35]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.82} />
      </mesh>

      {/* === PHÍA ĐÔNG ĐƯỜNG CHÍNH: TÒA NHÀ ĐIỀU HÀNH + KHO LẠNH & CROSS-DOCK === */}
      <LogisticsControlOffice position={[40, -0.05, 18]} facadeTex={facadeTex} />
      <IndustrialWarehouseBlock
        position={[44, 0, -8]}
        size={[18, 6.2, 24]}
        wallColor="#e6edf0"
        accentColor="#0d7a73"
        corrugatedTex={corrugatedTex}
        dockFace="west"
        dockCount={4}
        solar
      />
      <IndustrialUtilityZone position={[42, -0.05, -34]} />
      <IndustrialWarehouseBlock
        position={[46, 0, -56]}
        size={[22, 6.8, 18]}
        wallColor="#dde6ea"
        accentColor="#1e40af"
        corrugatedTex={corrugatedTex}
        dockFace="west"
        dockCount={3}
        solar
      />

      {/* === PHÍA TÂY KHUÔN VIÊN: BÃI CONTAINER & KHO PHÂN LOẠI PHỤ TRỢ === */}
      <ContainerYardStack position={[-33, -0.05, -6]} corrugatedTex={corrugatedTex} />
      <IndustrialWarehouseBlock
        position={[-46, 0, -34]}
        size={[20, 6.5, 28]}
        wallColor="#e2e8f0"
        accentColor="#0f766e"
        corrugatedTex={corrugatedTex}
        dockFace="east"
        dockCount={4}
        solar
      />
      <IndustrialWarehouseBlock
        position={[-46, 0, 10]}
        size={[20, 5.8, 22]}
        wallColor="#eaeff2"
        accentColor="#334155"
        corrugatedTex={corrugatedTex}
        dockFace="east"
        dockCount={3}
        solar
      />

      {/* === PHÍA BẮC KHU KHO: TRUNG TÂM LOGISTICS ĐÔNG LẠNH & KHO DỰ TRỮ === */}
      <IndustrialWarehouseBlock
        position={[-24, 0, -84]}
        size={[32, 7.2, 20]}
        wallColor="#e6edf0"
        accentColor="#0d7a73"
        corrugatedTex={corrugatedTex}
        dockFace="south"
        dockCount={5}
        solar
      />
      <IndustrialWarehouseBlock
        position={[24, 0, -84]}
        size={[34, 7.5, 20]}
        wallColor="#dce4e8"
        accentColor="#1e3a8a"
        corrugatedTex={corrugatedTex}
        dockFace="south"
        dockCount={5}
        solar
      />

      {/* Hệ thống cây xanh công viên công nghiệp bao quanh */}
      {[
        [-27, -58],
        [-27, -34],
        [-27, -14],
        [-27, 14],
        [-27, 29],
        [27.5, -56],
        [27.5, -36],
        [27.5, -15],
        [27.5, 11],
        [27.5, 29],
        [-36, 33],
        [-22, 33],
        [34, 33],
        [52, 33],
        [-45, 48],
        [-18, 48],
        [6, 48],
        [34, 48],
        [58, 48],
        [-18, -69],
        [-2, -69],
        [10, -69],
      ].map(([tx, tz], idx) => (
        <LushTree
          key={`ltree-${idx}`}
          position={[tx, -0.06, tz]}
          scale={0.95 + (idx % 3) * 0.16}
          variant={idx}
        />
      ))}
    </group>
  );
}
