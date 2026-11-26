import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatOneDReader,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';

export type NativeBarcodeResult = { rawValue: string; format?: string };
export type NativeBarcodeDetector = {
  detect: (source: ImageBitmapSource) => Promise<NativeBarcodeResult[]>;
};

export type PosScanCandidate = {
  code: string;
  format: string;
  kind: '1D' | 'QR';
};

export type PosVideoScanOutcome = {
  oneD: PosScanCandidate | null;
  qrList: PosScanCandidate[];
};

const ONE_D_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
];

export class PosScannerEngine {
  private readonly oneDHints: Map<DecodeHintType, unknown>;
  private readonly qrHints: Map<DecodeHintType, unknown>;
  private readonly oneDReader: MultiFormatOneDReader;
  private readonly qrReader: QRCodeReader;
  private cropCanvas: HTMLCanvasElement | null = null;
  private rotCanvas: HTMLCanvasElement | null = null;

  constructor() {
    this.oneDHints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, ONE_D_FORMATS],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    this.qrHints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    this.oneDReader = new MultiFormatOneDReader(this.oneDHints);
    this.qrReader = new QRCodeReader();
  }

  private getCropCanvas(): HTMLCanvasElement {
    if (!this.cropCanvas) this.cropCanvas = document.createElement('canvas');
    return this.cropCanvas;
  }

  private getRotCanvas(): HTMLCanvasElement {
    if (!this.rotCanvas) this.rotCanvas = document.createElement('canvas');
    return this.rotCanvas;
  }

  decodeGray1D(gray: Uint8ClampedArray, width: number, height: number): PosScanCandidate | null {
    if (width < 32 || height < 16) return null;
    const source = new RGBLuminanceSource(gray, width, height);
    for (const binarizer of [new GlobalHistogramBinarizer(source), new HybridBinarizer(source)]) {
      try {
        const result = this.oneDReader.decode(new BinaryBitmap(binarizer), this.oneDHints);
        const text = result.getText().trim();
        if (text.length >= 3) {
          return {
            code: text,
            format: BarcodeFormat[result.getBarcodeFormat()] ?? 'BARCODE_1D',
            kind: '1D',
          };
        }
      } catch {
        // Ignore NotFound/Checksum errors and continue trying next binarizer
      } finally {
        this.oneDReader.reset();
      }
    }
    return null;
  }

  decodeGrayQR(gray: Uint8ClampedArray, width: number, height: number): PosScanCandidate | null {
    if (width < 32 || height < 32) return null;
    const source = new RGBLuminanceSource(gray, width, height);
    for (const binarizer of [new HybridBinarizer(source), new GlobalHistogramBinarizer(source)]) {
      try {
        const result = this.qrReader.decode(new BinaryBitmap(binarizer), this.qrHints);
        const text = result.getText().trim();
        if (text.length >= 2) {
          return { code: text, format: 'QR_CODE', kind: 'QR' };
        }
      } catch {
        // Ignore NotFound errors
      } finally {
        this.qrReader.reset();
      }
    }
    return null;
  }

  decodeCanvas1DWithRotations(
    sourceCanvas: HTMLCanvasElement,
    tryAngles: number[],
    includeZeroDeg = true,
  ): PosScanCandidate | null {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    if (includeZeroDeg) {
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const gray = rgbaToGray(rgba, w * h);
      const rawHit = this.decodeGray1D(gray, w, h);
      if (rawHit) return rawHit;

      const stretched = stretchGrayContrast(gray);
      if (stretched !== gray) {
        const stretchHit = this.decodeGray1D(stretched, w, h);
        if (stretchHit) return stretchHit;
      }
    }

    const rotCanvas = this.getRotCanvas();
    const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: true });
    if (!rotCtx) return null;

    for (const deg of tryAngles) {
      const rad = (deg * Math.PI) / 180;
      const newW = Math.max(1, Math.ceil(Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h));
      const newH = Math.max(1, Math.ceil(Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h));
      rotCanvas.width = newW;
      rotCanvas.height = newH;
      rotCtx.fillStyle = '#ffffff';
      rotCtx.fillRect(0, 0, newW, newH);
      rotCtx.save();
      rotCtx.translate(newW / 2, newH / 2);
      rotCtx.rotate(rad);
      rotCtx.imageSmoothingEnabled = false;
      rotCtx.drawImage(sourceCanvas, -w / 2, -h / 2);
      rotCtx.restore();

      const rotRgba = rotCtx.getImageData(0, 0, newW, newH).data;
      const rotGray = rgbaToGray(rotRgba, newW * newH);
      const rotRawHit = this.decodeGray1D(rotGray, newW, newH);
      if (rotRawHit) return rotRawHit;
      const rotStretched = stretchGrayContrast(rotGray);
      if (rotStretched !== rotGray) {
        const rotStretchHit = this.decodeGray1D(rotStretched, newW, newH);
        if (rotStretchHit) return rotStretchHit;
      }
    }

    return null;
  }

  async scanVideoFrame(
    video: HTMLVideoElement,
    nativeDetector: NativeBarcodeDetector | null,
    tickIndex: number,
  ): Promise<{ outcome: PosVideoScanOutcome; reticleJpegDataUrl?: string }> {
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    if (!vW || !vH) return { outcome: { oneD: null, qrList: [] } };

    const qrList: PosScanCandidate[] = [];

    // 1. Native BarcodeDetector pass: inspect ALL detections, prioritizing 1D barcodes over QR codes
    if (nativeDetector) {
      try {
        const detected = await nativeDetector.detect(video);
        for (const item of detected) {
          const val = item.rawValue?.trim();
          if (!val) continue;
          const fmt = (item.format ?? '').toLowerCase();
          if (fmt && fmt !== 'qr_code') {
            return {
              outcome: {
                oneD: { code: val, format: item.format ?? 'NATIVE_1D', kind: '1D' },
                qrList,
              },
            };
          }
          qrList.push({ code: val, format: 'QR_CODE', kind: 'QR' });
        }
      } catch {
        // Proceed with client-side ZXing
      }
    }

    // 2. Compute exact visible ROI accounting for CSS object-fit: cover
    const rect = video.getBoundingClientRect();
    const boxW = rect.width > 20 ? rect.width : 280;
    const boxH = rect.height > 20 ? rect.height : 210;
    const roi = computeCoverVisibleCrop(vW, vH, boxW, boxH, 0.86, 0.68);

    const cropCanvas = this.getCropCanvas();
    const maxCropDim = 900;
    const cropScale = Math.min(1, maxCropDim / Math.max(roi.width, roi.height));
    cropCanvas.width = Math.max(64, Math.round(roi.width * cropScale));
    cropCanvas.height = Math.max(64, Math.round(roi.height * cropScale));
    const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    if (!cropCtx) return { outcome: { oneD: null, qrList } };

    cropCtx.imageSmoothingEnabled = false;
    cropCtx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, cropCanvas.width, cropCanvas.height);

    // 3. Dedicated 0-degree 1D pass FIRST (immune to QR code shadowing!)
    const zeroOneD = this.decodeCanvas1DWithRotations(cropCanvas, []);
    if (zeroOneD) {
      return { outcome: { oneD: zeroOneD, qrList } };
    }

    // 4. Fast QR check inside reticle ONLY if native detector didn't already capture one;
    // if it's a valid non-URL FreshMart QR tag, return immediately instead of spending CPU on tilt passes.
    if (qrList.length === 0) {
      const rgba = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height).data;
      const gray = rgbaToGray(rgba, cropCanvas.width * cropCanvas.height);
      const stretchedQr = stretchGrayContrast(gray);
      const qrHit =
        this.decodeGrayQR(gray, cropCanvas.width, cropCanvas.height) ??
        (stretchedQr !== gray ? this.decodeGrayQR(stretchedQr, cropCanvas.width, cropCanvas.height) : null);
      if (qrHit) {
        qrList.push(qrHit);
        if (!isExternalHttpUrl(qrHit.code)) {
          return { outcome: { oneD: null, qrList } };
        }
      }
    }

    // 5. Tilt & vertical 90-degree 1D recovery (covers -6, +6, 90 without repeating 0-deg pass)
    const angleSchedule = tickIndex % 2 === 0 ? [-6, 6] : [90, -10, 10];
    const tiltedOneD = this.decodeCanvas1DWithRotations(cropCanvas, angleSchedule, false);
    if (tiltedOneD) {
      return { outcome: { oneD: tiltedOneD, qrList } };
    }

    // Prepare compact cropped JPEG for periodic backend fallback BEFORE overwriting cropCanvas
    let reticleJpegDataUrl: string | undefined;
    if (tickIndex % 6 === 0) {
      reticleJpegDataUrl = cropCanvas.toDataURL('image/jpeg', 0.8);
    }

    // 5. Alternate tick full-frame 1D pass (handles barcode held near frame edge)
    if (tickIndex % 2 === 1) {
      const fullScale = Math.min(1, 880 / Math.max(vW, vH));
      cropCanvas.width = Math.max(64, Math.round(vW * fullScale));
      cropCanvas.height = Math.max(64, Math.round(vH * fullScale));
      cropCtx.imageSmoothingEnabled = false;
      cropCtx.drawImage(video, 0, 0, cropCanvas.width, cropCanvas.height);
      const fullOneD = this.decodeCanvas1DWithRotations(cropCanvas, []);
      if (fullOneD) {
        return { outcome: { oneD: fullOneD, qrList } };
      }
    }

    return { outcome: { oneD: null, qrList }, reticleJpegDataUrl };
  }
}

export function computeCoverVisibleCrop(
  videoW: number,
  videoH: number,
  boxW: number,
  boxH: number,
  rx = 0.86,
  ry = 0.68,
): { x: number; y: number; width: number; height: number } {
  const videoRatio = videoW / Math.max(1, videoH);
  const boxRatio = boxW / Math.max(1, boxH);
  let visW = videoW;
  let visH = videoH;
  let visX = 0;
  let visY = 0;
  if (videoRatio > boxRatio) {
    visW = videoH * boxRatio;
    visX = (videoW - visW) / 2;
  } else {
    visH = videoW / boxRatio;
    visY = (videoH - visH) / 2;
  }
  const width = Math.max(32, Math.min(videoW, Math.round(visW * rx)));
  const height = Math.max(32, Math.min(videoH, Math.round(visH * ry)));
  const x = Math.max(0, Math.min(videoW - width, Math.round(visX + (visW - width) / 2)));
  const y = Math.max(0, Math.min(videoH - height, Math.round(visY + (visH - height) / 2)));
  return { x, y, width, height };
}

export function rgbaToGray(rgba: Uint8ClampedArray, pixelCount: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(pixelCount);
  for (let i = 0, p = 0; p < pixelCount; i += 4, p += 1) {
    gray[p] = (306 * rgba[i]! + 601 * rgba[i + 1]! + 117 * rgba[i + 2]! + 512) >> 10;
  }
  return gray;
}

export function stretchGrayContrast(gray: Uint8ClampedArray): Uint8ClampedArray {
  const len = gray.length;
  const hist = new Uint32Array(256);
  const step = len > 120000 ? 4 : 1;
  let total = 0;
  for (let i = 0; i < len; i += step) {
    hist[gray[i]!] += 1;
    total += 1;
  }
  const lowCut = Math.floor(total * 0.02);
  const highCut = Math.ceil(total * 0.98);
  let acc = 0;
  let minVal = 0;
  let maxVal = 255;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v]!;
    if (acc >= lowCut) {
      minVal = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) {
    acc += hist[v]!;
    if (acc >= total - highCut) {
      maxVal = v;
      break;
    }
  }
  const span = maxVal - minVal;
  if (span < 24 || (minVal <= 8 && maxVal >= 247)) return gray;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    const mapped = Math.round(((v - minVal) * 255) / span);
    lut[v] = mapped < 0 ? 0 : mapped > 255 ? 255 : mapped;
  }
  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = lut[gray[i]!]!;
  }
  return out;
}

export function extractBarcodeQueryFromText(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      const u = new URL(trimmed);
      const lastSeg = u.pathname.split('/').filter(Boolean).pop();
      if (lastSeg && (/^\d{8,14}$/.test(lastSeg) || /^(sku|sp|prd|qr)-/i.test(lastSeg))) {
        return lastSeg.toLowerCase();
      }
      for (const key of ['barcode', 'code', 'sku', 'id', 'product']) {
        const val = u.searchParams.get(key);
        if (val) return val.toLowerCase();
      }
    } catch {
      // Fall through to raw string
    }
  }
  return lower;
}

export function isExternalHttpUrl(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false;
  const extracted = extractBarcodeQueryFromText(raw);
  return extracted === lower;
}
