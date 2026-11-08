import sharp from 'sharp';
import { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import { AppError } from '../../common/app-error.js';
import { getCameraDemo } from './camera-demo-session.service.js';
import { ingestEvent } from './iot.service.js';
import type { z } from 'zod';
import type { iotEventInput } from './iot.schemas.js';

const freshmartQr = /^QR-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
let inFlight = 0;
const recentlyRead = new Map<string, { at: number; event: Awaited<ReturnType<typeof ingestEvent>>['event'] }>();

export async function decodeCameraJpeg(jpeg: Buffer) {
  if (jpeg.length < 4 || jpeg.length > 512 * 1024 || jpeg[0] !== 255 || jpeg[1] !== 216) throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Ảnh camera không phải JPEG hợp lệ.');
  let image;
  try {
    image = await sharp(jpeg, { limitInputPixels: 1280 * 960, failOn: 'warning' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  } catch { throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Không đọc được ảnh JPEG từ camera.'); }
  const { width, height, channels } = image.info;
  if (channels !== 1 || width < 32 || height < 32) return null;
  const source = new RGBLuminanceSource(new Uint8ClampedArray(image.data), width, height);
  const side = Math.min(384, width, height);
  const candidates = [source.crop(Math.floor((width-side)/2), Math.floor((height-side)/2), side, side), source, source.invert()];
  const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
  for (const candidate of candidates) {
    try {
      const code = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(candidate)), hints).getText().trim().toUpperCase();
      if (freshmartQr.test(code)) return code;
    } catch { /* Try the full frame or inverted image after the center. */ }
  }
  return null;
}

export async function ingestCameraFrame(input: Omit<z.infer<typeof iotEventInput>, 'eventType' | 'tagId' | 'payload'>, jpeg: Buffer) {
  if (inFlight >= 2) throw new AppError(429, 'CAMERA_BUSY', 'Đang xử lý ảnh camera, thử khung tiếp theo.');
  inFlight++;
  try {
    const started = performance.now();
    const code = await decodeCameraJpeg(jpeg);
    const decodeMs = Math.round(performance.now() - started);
    if (!code) return { decoded: false, decodeMs, event: null };
    // Bind only a real decoded QR to an authenticated user's active demo.
    const context = await getCameraDemo(input.deviceId, code);
    const warehouseId = context?.warehouseId ?? input.warehouseId;
    const key = `${input.deviceId}:${code}:${warehouseId}:${context?.sessionId ?? ''}`;
    const cached = recentlyRead.get(key);
    if (cached && Date.now() - cached.at < 1500) return { decoded: true, code, decodeMs, event: cached.event };
    const result = await ingestEvent({ ...input, warehouseId, eventType: 'CAMERA_CODE_DETECTED', tagId: code, payload: { reader: 'ESP32-CAM', capture: 'CAMERA', decoder: 'BACKEND_ZXING', decodeMs, reportedWarehouseId: input.warehouseId, ...(context ? { demoSessionId: context.sessionId } : {}) } }, 'DEVICE', null);
    for (const [entry, value] of recentlyRead) if (Date.now() - value.at > 1500) recentlyRead.delete(entry);
    if (recentlyRead.size >= 128) recentlyRead.delete(recentlyRead.keys().next().value!);
    recentlyRead.set(key, { at: Date.now(), event: result.event });
    return { decoded: true, code, decodeMs, event: result.event };
  } finally { inFlight--; }
}
