import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import { useBalance } from '../hooks/useBalance';
import {
  buildPrivateTransferPayload,
  generateCommitment,
} from '../services/poolService';
import { saveTransaction } from '../services/transactionStore';
import { GHOSTPAY_MODULE_ADDRESS } from '../config/aptos';
import { formatAmount, truncateAddress } from '../types';
import QRScanner from '../components/QRScanner';
import { parseErrorMessage } from '../utils/parseError';

interface ParsedQR {
  recipient: string;
  amount: number;
}

function parseAptosPayURI(uri: string): ParsedQR | null {
  try {
    // aptos:{address}?amount=...&token=...
    const match = uri.match(/^aptos:([^?]+)/);
    if (!match) return null;
    const recipient = match[1];
    const params = new URLSearchParams(uri.split('?')[1] || '');
    const amount = parseFloat(params.get('amount') || '0');
    if (!recipient || amount <= 0) return null;
    return { recipient, amount };
  } catch {
    return null;
  }
}

export default function SendPage() {
  const { address, signAndSubmitTransaction } = useWallet();
  const { poolBalance, refresh } = useBalance(address);
  const navigate = useNavigate();
  const [parsed, setParsed] = useState<ParsedQR | null>(null);
  const [status, setStatus] = useState<
    'scan' | 'confirm' | 'loading' | 'success' | 'error'
  >('scan');
  const [error, setError] = useState('');

  const handleScan = useCallback((data: string) => {
    const result = parseAptosPayURI(data);
    if (result) {
      setParsed(result);
      setStatus('confirm');
    }
  }, []);

  const handlePay = async () => {
    if (!address || !parsed) return;
    if (poolBalance < parsed.amount) {
      setError('Insufficient pool balance');
      setStatus('error');
      return;
    }
    setStatus('loading');
    try {
      const commitment = await generateCommitment(
        address,
        parsed.recipient,
        parsed.amount,
      );
      const payload = buildPrivateTransferPayload(
        GHOSTPAY_MODULE_ADDRESS,
        parsed.recipient,
        parsed.amount,
        commitment,
      );
      await signAndSubmitTransaction(payload);
      refresh();
      saveTransaction({
        id: crypto.randomUUID(),
        type: 'send',
        amount: parsed.amount,
        token: 'APT',
        status: 'completed',
        timestamp: new Date().toISOString(),
        counterparty: parsed.recipient,
      });
      setStatus('success');
      setTimeout(() => navigate('/'), 2500);
    } catch (e) {
      setError(
        parseErrorMessage(e instanceof Error ? e.message : 'Payment failed'),
      );
      setStatus('error');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <div className="w-12 h-12 border-3 border-violet-400 border-t-transparent rounded-full animate-spin" />
        <div className="text-center">
          <p className="text-sm font-bold text-white/60">Sending privately...</p>
          <p className="text-[10px] text-white/30 mt-1 font-mono">
            Only a commitment hash will appear on-chain
          </p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center ghost-glow">
          <svg
            className="w-10 h-10 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-white/60">
            Payment Sent
          </p>
          <p className="text-2xl font-black text-white mt-2">
            {formatAmount(parsed!.amount, 2)} APT
          </p>
          <p className="text-[10px] text-white/30 font-mono mt-1">
            Ghost transfer complete
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 px-8">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
          <svg
            className="w-7 h-7 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mb-2">
            Payment Failed
          </p>
          <p className="text-sm font-medium text-white/60 max-w-[260px]">
            {error}
          </p>
        </div>
        <button
          onClick={() => setStatus('scan')}
          className="text-xs font-bold text-violet-400 uppercase tracking-widest"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (status === 'confirm' && parsed) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 px-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </div>

        <div className="text-center">
          <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em] mb-3">
            Confirm Payment
          </p>
          <p className="text-4xl font-black tracking-tighter text-white">
            {formatAmount(parsed.amount, 2)} APT
          </p>
          <div className="mt-3 glass rounded-xl px-4 py-2">
            <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider">
              To
            </p>
            <p className="text-xs font-mono text-white/60 mt-0.5">
              {truncateAddress(parsed.recipient, 8)}
            </p>
          </div>
        </div>

        <div className="w-full space-y-3 mt-2">
          <button
            onClick={handlePay}
            className="w-full py-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-black rounded-2xl active:scale-[0.98] transition-all uppercase tracking-widest"
          >
            Send Privately
          </button>
          <button
            onClick={() => {
              setParsed(null);
              setStatus('scan');
            }}
            className="w-full py-3 text-white/40 text-xs font-bold uppercase tracking-widest"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Scan mode
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
      <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em]">
        Scan Payment QR
      </p>

      <div className="w-full max-w-[300px]">
        <QRScanner onScan={handleScan} />
      </div>

      <div className="glass rounded-xl px-4 py-2">
        <p className="text-xs text-white/40 font-medium">
          Pool: {formatAmount(poolBalance)} APT
        </p>
      </div>

      <button
        onClick={() => navigate('/')}
        className="text-xs font-bold text-white/30 uppercase tracking-widest"
      >
        Cancel
      </button>
    </div>
  );
}
