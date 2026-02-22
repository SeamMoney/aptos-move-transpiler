import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface Props {
  onScan: (data: string) => void;
  onError?: (err: string) => void;
}

export default function QRScanner({ onScan, onError }: Props) {
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  onScanRef.current = onScan;
  onErrorRef.current = onError;
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const id = 'qr-reader-' + Date.now();
    const container = document.createElement('div');
    container.id = id;
    hostRef.current?.appendChild(container);

    const scanner = new Html5Qrcode(id);

    const startPromise = scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        if (!cancelled) {
          cancelled = true;
          scanner.stop().catch(() => {});
          onScanRef.current(decodedText);
        }
      },
      () => {},
    );

    startPromise
      .then(() => {
        if (cancelled) scanner.stop().catch(() => {});
      })
      .catch((err) => {
        if (!cancelled) onErrorRef.current?.(String(err));
      });

    return () => {
      cancelled = true;
      startPromise.then(() => scanner.stop()).catch(() => {});
      container.remove();
    };
  }, []);

  return <div ref={hostRef} className="w-full rounded-2xl overflow-hidden" />;
}
