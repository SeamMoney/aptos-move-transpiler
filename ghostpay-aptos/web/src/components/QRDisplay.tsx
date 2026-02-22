import QRCode from 'react-qr-code';

interface Props {
  address: string;
  amount?: number;
  token?: string;
}

/**
 * Generates an Aptos-compatible payment QR code.
 * Format: aptos:{address}?amount={amount}&token={token}&label=GhostPay
 */
export default function QRDisplay({ address, amount, token = 'APT' }: Props) {
  const params = new URLSearchParams();
  if (amount && amount > 0) {
    params.set('amount', amount.toString());
  }
  params.set('token', token);
  params.set('label', 'GhostPay');

  const uri = `aptos:${address}?${params.toString()}`;

  return (
    <div className="p-6 glass rounded-3xl">
      <div className="bg-white p-4 rounded-2xl">
        <QRCode
          value={uri}
          size={200}
          bgColor="#FFFFFF"
          fgColor="#000000"
          level="M"
        />
      </div>
    </div>
  );
}
