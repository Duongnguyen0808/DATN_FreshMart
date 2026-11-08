import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
const mock = vi.hoisted(() => ({ context: vi.fn(), ingest: vi.fn() }));
vi.mock('./camera-demo-session.service.js', () => ({ getCameraDemo: mock.context }));
vi.mock('./iot.service.js', () => ({ ingestEvent: mock.ingest }));
import { decodeCameraJpeg, ingestCameraFrame } from './camera-image.service.js';

const code = 'QR-11111111-2222-4333-8444-555555555555';
async function photographedQr(value = code) {
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value, size: 240, marginSize: 4 }));
  const tile = await sharp(Buffer.from(svg)).rotate(8, { background: 'white' }).png().toBuffer();
  return sharp({ create: { width: 640, height: 480, channels: 3, background: '#c4c4c4' } }).composite([{ input: tile, gravity: 'centre' }]).jpeg({ quality: 65 }).toBuffer();
}
describe('backend decoding of camera JPEGs', () => {
  beforeEach(() => { vi.resetAllMocks(); mock.context.mockResolvedValue({ sessionId: 'session', warehouseId: 'destination' }); mock.ingest.mockResolvedValue({ event: { id: 'event', automationStatus: 'WAITING_CONFIRMATION' } }); });
  it('reads a rotated compressed QR from the actual JPEG bytes', async () => {
    const started = performance.now();
    await expect(decodeCameraJpeg(await photographedQr())).resolves.toBe(code);
    console.log(`JPEG QR decode check: ${Math.round(performance.now()-started)} ms (synthetic image)`);
  });
  it('does not turn an arbitrary QR or a blank image into a selected parcel', async () => {
    expect(await decodeCameraJpeg(await photographedQr('NOT-A-FRESHMART-PARCEL'))).toBeNull();
    const blank = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#eee' } }).jpeg().toBuffer();
    await expect(ingestCameraFrame({ eventId: 'blank', deviceId: 'CAMERA', warehouseId: 'physical', timestamp: new Date() }, blank)).resolves.toMatchObject({ decoded: false, event: null });
    expect(mock.ingest).not.toHaveBeenCalled();
  });
  it('rejects non-JPEG data', async () => {
    await expect(decodeCameraJpeg(Buffer.from('not an image'))).rejects.toMatchObject({ code: 'CAMERA_IMAGE_INVALID' });
  });
  it('uses the exact decoded code and authorized warehouse, suppressing rapid repeat events', async () => {
    const jpeg = await photographedQr();
    const input = { eventId: 'frame', deviceId: 'CAMERA-IMAGE-TEST', warehouseId: 'physical', timestamp: new Date() };
    await expect(ingestCameraFrame(input, jpeg)).resolves.toMatchObject({ decoded: true, code });
    await ingestCameraFrame({ ...input, eventId: 'next-frame' }, jpeg);
    expect(mock.ingest).toHaveBeenCalledTimes(1);
    expect(mock.ingest.mock.calls[0]).toMatchObject([{ tagId: code, warehouseId: 'destination', payload: { decoder: 'BACKEND_ZXING', reportedWarehouseId: 'physical', demoSessionId: 'session' } }, 'DEVICE', null]);
  });
});
