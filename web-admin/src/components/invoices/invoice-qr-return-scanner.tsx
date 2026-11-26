'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '../../lib/auth-api';
import { getInvoices } from '../../lib/invoices-api';
import { extractInvoiceReturnTarget } from '../../lib/invoice-receipt';
import { PosScannerEngine, type NativeBarcodeDetector } from '../../lib/pos-camera-scanner';
import { CameraPreview } from '../../app/kho/mo-hinh-3d/camera-preview';
import { useToast } from '../ui/toast-provider';
import { ActionButton } from '../ui/action-button';
import '../../app/kho/mo-hinh-3d/live-inbound.css';

type PosScanResult = {
  decoded: boolean;
  code: string | null;
  format: string | null;
};

function uint8ToBase64DataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function playBeep(ok: boolean) {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = ok ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(ok ? 1850 : 380, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.2));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    window.setTimeout(() => { void ctx.close().catch(() => {}); }, 350);
  } catch {
    // Ignore audio block
  }
}

export function InvoiceQrReturnScanner({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [cameraMode, setCameraMode] = useState<'webcam' | 'esp32'>('webcam');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [statusTone, setStatusTone] = useState<'idle' | 'ok' | 'warn'>('idle');
  const [statusText, setStatusText] = useState('Đưa mã QR trên hóa đơn in vào khung camera để mở ngay phiếu đổi trả');
  const [resolving, setResolving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerEngineRef = useRef<PosScannerEngine | null>(null);
  const barcodeDetectorRef = useRef<NativeBarcodeDetector | null>(null);
  const latestEspBytesRef = useRef<{ bytes: Uint8Array; at: number } | null>(null);
  const scanInFlightRef = useRef(false);
  const scanCounterRef = useRef(0);
  const handledRef = useRef(false);
  const lastInvalidRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  useEffect(() => {
    try {
      scannerEngineRef.current = new PosScannerEngine();
    } catch {
      scannerEngineRef.current = null;
    }

    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      void (async () => {
        try {
          const BD = (window as unknown as {
            BarcodeDetector: {
              new (opts?: { formats: string[] }): NativeBarcodeDetector;
              getSupportedFormats?: () => Promise<string[]>;
            };
          }).BarcodeDetector;
          let formats = ['qr_code', 'code_128', 'code_39'];
          if (typeof BD.getSupportedFormats === 'function') {
            const supported = await BD.getSupportedFormats();
            formats = formats.filter(f => supported.includes(f));
          }
          if (formats.length > 0) barcodeDetectorRef.current = new BD({ formats });
        } catch {
          barcodeDetectorRef.current = null;
        }
      })();
    }
  }, []);

  const resolveAndNavigate = async (raw: string) => {
    if (handledRef.current || resolving) return;
    const trimmed = raw.trim();
    if (!trimmed) return;

    const target = extractInvoiceReturnTarget(trimmed);
    if (!target) {
      const now = Date.now();
      if (lastInvalidRef.current.code !== trimmed || now - lastInvalidRef.current.at > 2000) {
        lastInvalidRef.current = { code: trimmed, at: now };
        playBeep(false);
        setStatusTone('warn');
        setStatusText(`Mã "${trimmed.slice(0, 40)}" không phải mã QR hóa đơn FreshMart.`);
      }
      return;
    }

    if (target.kind === 'id') {
      handledRef.current = true;
      playBeep(true);
      setStatusTone('ok');
      setStatusText('✅ Đã nhận diện hóa đơn — Đang mở màn hình đổi trả hàng…');
      showToast('Đã quét mã QR hóa đơn · Mở phiếu đổi trả hàng.');
      onClose();
      router.push(`/hoa-don/${target.invoiceId}?return=1`);
      return;
    }

    setResolving(true);
    try {
      const list = await getInvoices({ q: target.invoiceCode, status: 'all', page: 1 });
      const exact = list.items.find(item => item.code.toUpperCase() === target.invoiceCode) ?? list.items[0];
      if (!exact) {
        playBeep(false);
        setStatusTone('warn');
        setStatusText(`Không tìm thấy hóa đơn ${target.invoiceCode}.`);
        return;
      }
      handledRef.current = true;
      playBeep(true);
      setStatusTone('ok');
      setStatusText(`✅ Tìm thấy hóa đơn ${exact.code} — Đang mở phiếu đổi trả…`);
      showToast(`Đã nhận diện hóa đơn ${exact.code} · Mở phiếu đổi trả hàng.`);
      onClose();
      router.push(`/hoa-don/${exact.id}?return=1`);
    } catch (reason) {
      playBeep(false);
      setStatusTone('warn');
      setStatusText(errorMessage(reason));
    } finally {
      setResolving(false);
    }
  };

  const resolveRef = useRef(resolveAndNavigate);
  resolveRef.current = resolveAndNavigate;

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;

    if (cameraMode === 'webcam' && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      };
      navigator.mediaDevices.getUserMedia(constraints)
        .then(mediaStream => {
          if (!active) { mediaStream.getTracks().forEach(t => t.stop()); return; }
          stream = mediaStream;
          const track = mediaStream.getVideoTracks()[0];
          if (track && typeof track.applyConstraints === 'function') {
            void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
          }
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            void videoRef.current.play().catch(() => {});
          }
          if (navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices().then(devices => {
              const inputs = devices.filter(d => d.kind === 'videoinput');
              if (active && inputs.length > 0) setVideoDevices(inputs);
            }).catch(() => {});
          }
        })
        .catch(() => {
          if (active) {
            setStatusTone('warn');
            setStatusText('Không mở được Camera trình duyệt — hãy chuyển sang ESP32-CAM hoặc nhập mã hóa đơn bên dưới.');
          }
        });
    }

    const timer = window.setInterval(async () => {
      if (!active || handledRef.current || scanInFlightRef.current) return;
      scanInFlightRef.current = true;
      try {
        if (cameraMode === 'esp32') {
          const recent = latestEspBytesRef.current;
          const payload = recent && Date.now() - recent.at < 2500
            ? { source: 'image' as const, imageDataUrl: uint8ToBase64DataUrl(recent.bytes) }
            : { source: 'esp32' as const };
          const res = await api<PosScanResult>('iot/camera/pos-scan', 'POST', payload, 3500);
          if (active && res.decoded && res.code) {
            await resolveRef.current(res.code);
          }
        } else if (cameraMode === 'webcam' && videoRef.current && videoRef.current.readyState >= 2) {
          const engine = scannerEngineRef.current;
          if (engine) {
            scanCounterRef.current = (scanCounterRef.current + 1) % 1000;
            const { outcome, reticleJpegDataUrl } = await engine.scanVideoFrame(
              videoRef.current,
              barcodeDetectorRef.current,
              scanCounterRef.current,
            );
            if (!active) return;

            const qrHit = outcome.qrList.find(q => Boolean(extractInvoiceReturnTarget(q.code))) ?? outcome.qrList[0];
            if (qrHit) {
              await resolveRef.current(qrHit.code);
              return;
            }
            if (outcome.oneD && extractInvoiceReturnTarget(outcome.oneD.code)) {
              await resolveRef.current(outcome.oneD.code);
              return;
            }
            if (reticleJpegDataUrl) {
              try {
                const res = await api<PosScanResult>(
                  'iot/camera/pos-scan',
                  'POST',
                  { source: 'image', imageDataUrl: reticleJpegDataUrl },
                  2500,
                );
                if (active && res.decoded && res.code) {
                  await resolveRef.current(res.code);
                }
              } catch {
                // Ignore transient fallback timeout
              }
            }
          }
        }
      } catch {
        // Ignore transient frame poll error
      } finally {
        scanInFlightRef.current = false;
      }
    }, 240);

    return () => {
      active = false;
      scanInFlightRef.current = false;
      window.clearInterval(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [cameraMode, selectedDeviceId]);

  return (
    <div
      className="ui-modal"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="ui-modal-card invoice-return-qr-modal">
        <header>
          <div>
            <h2>Quét mã QR hóa đơn đổi trả</h2>
            <p>Quét QR in dưới chân hóa đơn K80 để mở thẳng phiếu trả hàng của đúng hóa đơn đó.</p>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </header>

        <div className="invoice-return-scanner-body">
          <div className="pos-inline-scanner-head">
            <div className="pos-inline-scanner-tabs">
              <button
                type="button"
                className={`ui-action-button ${cameraMode === 'webcam' ? 'action-approve' : 'action-more'}`}
                onClick={() => setCameraMode('webcam')}
              >
                Webcam / iPhone
              </button>
              <button
                type="button"
                className={`ui-action-button ${cameraMode === 'esp32' ? 'action-approve' : 'action-more'}`}
                onClick={() => setCameraMode('esp32')}
              >
                ESP32-CAM
              </button>
            </div>
          </div>

          {cameraMode === 'webcam' && videoDevices.length > 1 && (
            <select
              aria-label="Chọn camera"
              value={selectedDeviceId}
              onChange={event => setSelectedDeviceId(event.target.value)}
              style={{ width: '100%', maxWidth: 320, minHeight: 32, height: 32, fontSize: 12, padding: '4px 8px' }}
            >
              <option value="">Tự động (Ưu tiên camera sau / iPhone)</option>
              {videoDevices.map((d, idx) => (
                <option key={d.deviceId || idx} value={d.deviceId}>
                  {d.label || `Camera ${idx + 1}`}
                </option>
              ))}
            </select>
          )}

          {cameraMode === 'esp32' ? (
            <CameraPreview compact onFrameBytes={bytes => { latestEspBytesRef.current = { bytes, at: Date.now() }; }} />
          ) : (
            <div className="pos-inline-scanner-video invoice-qr-square">
              <video ref={videoRef} autoPlay muted playsInline />
              <div className="pos-inline-scanner-guide" />
            </div>
          )}

          <div className={`pos-inline-scanner-status${statusTone === 'warn' ? ' is-warn' : ''}`} role="status">
            <span>{statusText}</span>
          </div>

          <form
            className="invoice-return-manual-form"
            onSubmit={event => {
              event.preventDefault();
              void resolveAndNavigate(manualInput);
            }}
          >
            <input
              value={manualInput}
              onChange={event => setManualInput(event.target.value)}
              placeholder="Hoặc quét đầu đọc USB / dán mã HD-2026... rồi nhấn Enter"
            />
            <ActionButton tone="approve" type="submit" disabled={resolving || !manualInput.trim()}>
              {resolving ? 'Đang mở…' : 'Mở trả hàng'}
            </ActionButton>
          </form>
        </div>

        <footer>
          <ActionButton tone="more" onClick={onClose}>Đóng</ActionButton>
        </footer>
      </section>
    </div>
  );
}
