'use client';

import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function makeTexture(
  key: string,
  size: number,
  repeatX: number,
  repeatY: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const existing = cache.get(key);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  draw(ctx, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export function getAsphaltTexture(repeatX = 4, repeatY = 24) {
  return makeTexture(`asphalt-${repeatX}-${repeatY}`, 256, repeatX, repeatY, (ctx, s) => {
    ctx.fillStyle = '#3f4952';
    ctx.fillRect(0, 0, s, s);
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 4500; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const v = Math.floor(48 + rand() * 36);
      ctx.fillStyle = `rgb(${v},${v + 4},${v + 8})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  });
}

export function getConcreteYardTexture(repeatX = 16, repeatY = 24) {
  return makeTexture(`concrete-${repeatX}-${repeatY}`, 256, repeatX, repeatY, (ctx, s) => {
    ctx.fillStyle = '#d3dce0';
    ctx.fillRect(0, 0, s, s);
    let seed = 4242;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 2400; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const v = Math.floor(196 + rand() * 28);
      ctx.fillStyle = `rgb(${v},${v + 4},${v + 6})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.strokeStyle = 'rgba(120, 138, 148, 0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });
}

export function getGrassTexture(repeatX = 36, repeatY = 36) {
  return makeTexture(`grass-${repeatX}-${repeatY}`, 256, repeatX, repeatY, (ctx, s) => {
    ctx.fillStyle = '#9ec096';
    ctx.fillRect(0, 0, s, s);
    let seed = 9001;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 4000; i++) {
      const x = rand() * s;
      const y = rand() * s;
      const g = Math.floor(155 + rand() * 45);
      ctx.fillStyle = `rgb(${Math.floor(g * 0.78)},${g},${Math.floor(g * 0.72)})`;
      ctx.fillRect(x, y, 2.2, 2.2);
    }
  });
}

export function getFacadeWindowTexture(repeatX = 3, repeatY = 3) {
  return makeTexture(`facade-${repeatX}-${repeatY}`, 256, repeatX, repeatY, (ctx, s) => {
    ctx.fillStyle = '#dce4ec';
    ctx.fillRect(0, 0, s, s);
    const cols = 4;
    const rows = 4;
    const cellW = s / cols;
    const cellH = s / rows;
    let seed = 777;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cellW + 7;
        const y = r * cellH + 9;
        const w = cellW - 14;
        const h = cellH - 18;
        const warm = rand() > 0.68;
        const grad = ctx.createLinearGradient(x, y, x, y + h);
        if (warm) {
          grad.addColorStop(0, '#5a8ab0');
          grad.addColorStop(1, '#f3d49b');
        } else {
          grad.addColorStop(0, '#365878');
          grad.addColorStop(1, '#7fb3d5');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
    }
  });
}

export function getCorrugatedMetalTexture(repeatX = 8, repeatY = 2) {
  return makeTexture(`corrugated-${repeatX}-${repeatY}`, 128, repeatX, repeatY, (ctx, s) => {
    ctx.fillStyle = '#e6edf0';
    ctx.fillRect(0, 0, s, s);
    const ribs = 16;
    const step = s / ribs;
    for (let i = 0; i < ribs; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(148,163,184,0.16)' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(i * step, 0, step * 0.5, s);
    }
  });
}

export function getSkyDomeTexture() {
  return makeTexture('skydome-gradient', 128, 1, 1, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0.0, '#60a5fa');
    grad.addColorStop(0.28, '#93c5fd');
    grad.addColorStop(0.47, '#dbeafe');
    grad.addColorStop(0.52, '#eaf3f8');
    grad.addColorStop(1.0, '#d5e4ed');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}
