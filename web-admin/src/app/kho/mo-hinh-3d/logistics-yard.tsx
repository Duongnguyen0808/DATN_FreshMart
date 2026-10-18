'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createTree, createContainer, createGuardBooth, createCharger, createParkingBay, createFence } from '../../../vendor/waretrack/models/props.js';
import { createPallet } from '../../../vendor/waretrack/models/pallet.js';

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
    // Keep service equipment on the apron, clear of both marked truck lanes.
    [-10, -28, -46].forEach((z) => {
      place(createCharger(), 12.5, z + 7, 0.8, -Math.PI / 2);
    });
    [[26.5, -25], [26.5, -7], [-26.5, -43], [-26.5, -7]].forEach(([x, z], i) => {
      place(createContainer({ color: i % 2 ? 0x208a79 : 0x147bb7, label: 'FRESHMART', length: 6.1 }), x, z, 0.95, Math.PI / 2);
    });
    place(createGuardBooth({ barrier: false }), -13.7, 15, 0.75);
    // Secured perimeter and marked staging bays make the open apron read as a working depot.
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
    // Factory geometry/textures are shared caches. Only charger LEDs are instance-owned.
    assets.forEach(object => {
      const led = object.userData.led as THREE.Mesh | undefined;
      if (led && led.material instanceof THREE.Material) led.material.dispose();
    });
  }, [assets]);
  return <group>{assets.map((object, index) => <primitive key={index} object={object} dispose={null} />)}</group>;
}
