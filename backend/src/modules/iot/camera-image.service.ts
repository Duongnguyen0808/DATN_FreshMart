import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  type LuminanceSource,
  MultiFormatReader,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { AppError } from '../../common/app-error.js';
import { getCameraDemo } from './camera-demo-session.service.js';
import { ingestEvent } from './iot.service.js';
import type { z } from 'zod';
import type { iotEventInput } from './iot.schemas.js';

const freshmartQr = /^QR-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
let inFlight = 0;
const recentlyRead = new Map<string, { at: number; event: Awaited<ReturnType<typeof ingestEvent>>['event'] }>();

type LatestFrame = {
  jpeg: Buffer;
  deviceId: string;
  updatedAt: number;
  seq: number;
};

let latestFrame: LatestFrame | null = null;
let frameSequence = 0;
export const cameraFrameBus = new EventEmitter();
cameraFrameBus.setMaxListeners(50);

export function getLatestCameraFrame(): LatestFrame | null {
  if (!latestFrame || Date.now() - latestFrame.updatedAt > 15_000) return null;
  return latestFrame;
}

function tryDecodeSource(source: LuminanceSource, tryHarder: boolean): string | null {
  const reader = new QRCodeReader();
  const hints = tryHarder ? new Map([[DecodeHintType.TRY_HARDER, true]]) : undefined;
  const binarizers = [new HybridBinarizer(source), new GlobalHistogramBinarizer(source)];
  for (const binarizer of binarizers) {
    try {
      const code = reader.decode(new BinaryBitmap(binarizer), hints).getText().trim().toUpperCase();
      if (freshmartQr.test(code)) return code;
    } catch {
      // Continue to next binarizer
    }
  }
  return null;
}

export async function decodeCameraJpeg(jpeg: Buffer) {
  if (jpeg.length < 4 || jpeg.length > 512 * 1024 || jpeg[0] !== 255 || jpeg[1] !== 216) {
    throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Ảnh camera không phải JPEG hợp lệ.');
  }

  let rawImage;
  try {
    rawImage = await sharp(jpeg, { limitInputPixels: 1280 * 960, failOn: 'none' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Không đọc được ảnh JPEG từ camera.');
  }

  const { width, height, channels } = rawImage.info;
  if (channels !== 1 || width < 32 || height < 32) return null;

  const fullSource = new RGBLuminanceSource(new Uint8ClampedArray(rawImage.data), width, height);
  const side = Math.min(420, width, height);
  const cropLeft = Math.floor((width - side) / 2);
  const cropTop = Math.floor((height - side) / 2);
  const centerSource = fullSource.crop(cropLeft, cropTop, side, side);

  // Stage 1: Ultra-fast pass on center & full frame (~2-4ms)
  const fastHit =
    tryDecodeSource(centerSource, false) ??
    tryDecodeSource(fullSource, false) ??
    tryDecodeSource(centerSource, true);
  if (fastHit) return fastHit;

  // Stage 2: Contrast-normalized + Unsharp-Mask sharpened center & full frame (~6-9ms)
  // Restores slightly soft/out-of-focus edges from fixed-focus ESP32-CAM lens & indoor glare
  try {
    const enhanced = await sharp(rawImage.data, { raw: { width, height, channels: 1 } })
      .normalise()
      .sharpen({ sigma: 1.2, m1: 1.6, m2: 3.2 })
      .raw()
      .toBuffer();

    const enhancedFull = new RGBLuminanceSource(new Uint8ClampedArray(enhanced), width, height);
    const enhancedCenter = enhancedFull.crop(cropLeft, cropTop, side, side);

    const enhancedHit =
      tryDecodeSource(enhancedCenter, true) ??
      tryDecodeSource(enhancedFull, true) ??
      tryDecodeSource(enhancedCenter.invert(), true);
    if (enhancedHit) return enhancedHit;
  } catch {
    // Ignore enhancement errors
  }

  return null;
}

const posBarcodeFormats = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
];

function tryDecodePosSource(source: LuminanceSource, tryHarder: boolean): { code: string; format: string } | null {
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, posBarcodeFormats]]);
  if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  const binarizers = [new HybridBinarizer(source), new GlobalHistogramBinarizer(source)];
  for (const binarizer of binarizers) {
    try {
      const result = reader.decodeWithState(new BinaryBitmap(binarizer));
      const code = result.getText().trim();
      if (code.length >= 3) {
        return { code, format: BarcodeFormat[result.getBarcodeFormat()] ?? 'BARCODE' };
      }
    } catch {
      // Continue to next binarizer
    }
  }
  return null;
}

export async function decodePosCodeFromImage(imageBuffer: Buffer): Promise<{ code: string; format: string } | null> {
  if (imageBuffer.length < 4 || imageBuffer.length > 2 * 1024 * 1024) {
    throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Ảnh camera không hợp lệ.');
  }

  let rawImage;
  try {
    rawImage = await sharp(imageBuffer, { limitInputPixels: 1920 * 1080, failOn: 'none' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Không đọc được ảnh từ camera.');
  }

  const { width, height, channels } = rawImage.info;
  if (channels !== 1 || width < 32 || height < 32) return null;

  const fullSource = new RGBLuminanceSource(new Uint8ClampedArray(rawImage.data), width, height);
  const side = Math.min(480, width, height);
  const cropLeft = Math.floor((width - side) / 2);
  const cropTop = Math.floor((height - side) / 2);
  const centerSource = fullSource.crop(cropLeft, cropTop, side, side);
  const bandHeight = Math.max(64, Math.floor(height * 0.45));
  const bandTop = Math.floor((height - bandHeight) / 2);
  const horizontalBand = fullSource.crop(0, bandTop, width, bandHeight);

  const fastHit =
    tryDecodePosSource(horizontalBand, false) ??
    tryDecodePosSource(centerSource, false) ??
    tryDecodePosSource(fullSource, false) ??
    tryDecodePosSource(horizontalBand, true) ??
    tryDecodePosSource(centerSource, true);
  if (fastHit) return fastHit;

  try {
    const enhanced = await sharp(rawImage.data, { raw: { width, height, channels: 1 } })
      .normalise()
      .sharpen({ sigma: 1.2, m1: 1.6, m2: 3.2 })
      .raw()
      .toBuffer();

    const enhancedFull = new RGBLuminanceSource(new Uint8ClampedArray(enhanced), width, height);
    const enhancedBand = enhancedFull.crop(0, bandTop, width, bandHeight);
    const enhancedCenter = enhancedFull.crop(cropLeft, cropTop, side, side);

    const enhancedHit =
      tryDecodePosSource(enhancedBand, true) ??
      tryDecodePosSource(enhancedCenter, true) ??
      tryDecodePosSource(enhancedFull, true) ??
      tryDecodePosSource(enhancedBand.invert(), true);
    if (enhancedHit) return enhancedHit;
  } catch {
    // Ignore enhancement errors
  }

  return null;
}

export async function ingestCameraFrame(
  input: Omit<z.infer<typeof iotEventInput>, 'eventType' | 'tagId' | 'payload'>,
  jpeg: Buffer,
) {
  if (jpeg.length >= 4 && jpeg[0] === 255 && jpeg[1] === 216) {
    latestFrame = {
      jpeg,
      deviceId: input.deviceId,
      updatedAt: Date.now(),
      seq: ++frameSequence,
    };
    cameraFrameBus.emit('frame', latestFrame);
  }

  if (inFlight >= 4) {
    return { decoded: false, decodeMs: 0, event: null };
  }
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
    if (cached && Date.now() - cached.at < 1500) {
      return { decoded: true, code, decodeMs, event: cached.event };
    }
    const result = await ingestEvent(
      {
        ...input,
        warehouseId,
        eventType: 'CAMERA_CODE_DETECTED',
        tagId: code,
        payload: {
          reader: 'ESP32-CAM',
          capture: 'CAMERA',
          decoder: 'BACKEND_ZXING',
          decodeMs,
          reportedWarehouseId: input.warehouseId,
          ...(context ? { demoSessionId: context.sessionId } : {}),
        },
      },
      'DEVICE',
      null,
    );
    for (const [entry, value] of recentlyRead) {
      if (Date.now() - value.at > 1500) recentlyRead.delete(entry);
    }
    if (recentlyRead.size >= 128) recentlyRead.delete(recentlyRead.keys().next().value!);
    recentlyRead.set(key, { at: Date.now(), event: result.event });
    return { decoded: true, code, decodeMs, event: result.event };
  } finally {
    inFlight--;
  }
}
