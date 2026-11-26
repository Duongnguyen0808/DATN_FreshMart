import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import zxingPkg, {
  type BarcodeFormat as BarcodeFormatType,
  type DecodeHintType as DecodeHintTypeType,
  type LuminanceSource,
} from '@zxing/library';
type BarcodeFormat = BarcodeFormatType;
type DecodeHintType = DecodeHintTypeType;
const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatReader,
  QRCodeReader,
  RGBLuminanceSource,
} = zxingPkg;
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

const posOneDFormats = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
];
const posQrFormats = [BarcodeFormat.QR_CODE];

function isExternalUrlCode(code: string): boolean {
  const trimmed = code.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  // FreshMart internal invoice return QR URLs (/hoa-don/<uuid>?return=1) are actionable internal codes
  if (/\/hoa-don\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(trimmed)) return false;
  return true;
}

function tryDecodePosFormats(
  source: LuminanceSource,
  formats: BarcodeFormat[],
  tryHarder: boolean,
): { code: string; format: string } | null {
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, formats]]);
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
  if (imageBuffer.length < 4 || imageBuffer.length > 10 * 1024 * 1024) {
    throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Ảnh camera không phải định dạng hợp lệ.');
  }

  let rawImage;
  try {
    rawImage = await sharp(imageBuffer, { failOn: 'none' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError(400, 'CAMERA_IMAGE_INVALID', 'Không đọc được ảnh từ camera.');
  }

  const { width, height, channels } = rawImage.info;
  if (channels !== 1 || width < 32 || height < 32) return null;

  let fallbackUrlQr: { code: string; format: string } | null = null;
  const checkSources = (sources: LuminanceSource[], tryHarder: boolean) => {
    for (const src of sources) {
      const oneD = tryDecodePosFormats(src, posOneDFormats, tryHarder);
      if (oneD) return oneD;
    }
    for (const src of sources) {
      const qr = tryDecodePosFormats(src, posQrFormats, tryHarder);
      if (qr) {
        if (!isExternalUrlCode(qr.code)) return qr;
        if (!fallbackUrlQr) fallbackUrlQr = qr;
      }
    }
    return null;
  };

  const fullSource = new RGBLuminanceSource(new Uint8ClampedArray(rawImage.data), width, height);
  const side = Math.min(480, width, height);
  const cropLeft = Math.floor((width - side) / 2);
  const cropTop = Math.floor((height - side) / 2);
  const centerSource = fullSource.crop(cropLeft, cropTop, side, side);
  const bandHeight = Math.max(64, Math.floor(height * 0.48));
  const bandTop = Math.floor((height - bandHeight) / 2);
  const horizontalBand = fullSource.crop(0, bandTop, width, bandHeight);

  // Stage 1: Fast native pass (1D barcodes first, then QR codes)
  const fastHit =
    checkSources([horizontalBand, centerSource, fullSource], false) ??
    checkSources([horizontalBand, centerSource], true);
  if (fastHit) return fastHit;

  // Stage 2: Native contrast normalization + edge sharpen (handles low indoor lighting)
  try {
    const enhanced = await sharp(rawImage.data, { raw: { width, height, channels: 1 } })
      .normalise()
      .sharpen({ sigma: 1.2, m1: 1.7, m2: 3.4 })
      .raw()
      .toBuffer();

    const enhancedFull = new RGBLuminanceSource(new Uint8ClampedArray(enhanced), width, height);
    const enhancedBand = enhancedFull.crop(0, bandTop, width, bandHeight);
    const enhancedCenter = enhancedFull.crop(cropLeft, cropTop, side, side);

    const enhancedHit = checkSources([enhancedBand, enhancedCenter, enhancedFull, enhancedBand.invert()], true);
    if (enhancedHit) return enhancedHit;

    // Fast 90-degree vertical rotation on native resolution (~4ms instead of 2x Lanczos 250ms)
    const rotated = await sharp(enhanced, { raw: { width, height, channels: 1 } })
      .rotate(90)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rotFull = new RGBLuminanceSource(
      new Uint8ClampedArray(rotated.data),
      rotated.info.width,
      rotated.info.height,
    );
    const rotBandH = Math.max(64, Math.floor(rotated.info.height * 0.48));
    const rotBand = rotFull.crop(0, Math.floor((rotated.info.height - rotBandH) / 2), rotated.info.width, rotBandH);
    const rotHit = checkSources([rotBand, rotFull], true);
    if (rotHit) return rotHit;
  } catch {
    // Ignore enhancement errors
  }

  // Stage 2b: Threshold binarization for blurry/low-contrast 1D barcode stripes (~4ms)
  try {
    const binarized = await sharp(rawImage.data, { raw: { width, height, channels: 1 } })
      .normalise()
      .sharpen({ sigma: 1.4, m1: 2.0, m2: 4.0 })
      .threshold(128)
      .raw()
      .toBuffer();
    const binFull = new RGBLuminanceSource(new Uint8ClampedArray(binarized), width, height);
    const binBand = binFull.crop(0, bandTop, width, bandHeight);
    const binHit = checkSources([binBand, binFull], true);
    if (binHit) return binHit;
  } catch {
    // Ignore threshold errors
  }

  return fallbackUrlQr;
}

export async function ingestCameraFrame(
  input: Omit<z.infer<typeof iotEventInput>, 'eventType' | 'tagId' | 'payload'>,
  jpeg: Buffer,
  cacheOnly = false,
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
  if (cacheOnly) {
    return { decoded: false, decodeMs: 0, event: null };
  }

  // Non-blocking background QR decode: return HTTP 200 to ESP32-CAM immediately (<1ms)
  // so ESP32-CAM can push 25 FPS continuously without waiting for server image processing!
  if (inFlight < 1) {
    inFlight++;
    setImmediate(async () => {
      try {
        const started = performance.now();
        const code = await decodeCameraJpeg(jpeg);
        const decodeMs = Math.round(performance.now() - started);
        if (!code) return;

        const context = await getCameraDemo(input.deviceId, code);
        const warehouseId = context?.warehouseId ?? input.warehouseId;
        const key = `${input.deviceId}:${code}:${warehouseId}:${context?.sessionId ?? ''}`;
        const cached = recentlyRead.get(key);
        if (cached && Date.now() - cached.at < 1500) return;

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
      } catch {
        // Ignore background decode errors
      } finally {
        inFlight--;
      }
    });
  }
  return { decoded: false, decodeMs: 0, event: null };
}
