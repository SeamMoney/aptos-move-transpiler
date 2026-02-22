import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import { usePayment } from '../hooks/usePayment';
import { saveTransaction } from '../services/transactionStore';
import { formatAmount } from '../types';
import QRDisplay from '../components/QRDisplay';

export default function ReceivePage() {
  const { address } = useWallet();
  const navigate = useNavigate();
  const { session, timeRemaining, startReceive, cancel } = usePayment(address);
  const [amount, setAmount] = useState('');
  const [showQR, setShowQR] = useState(false);
  const savedRef = useRef(false);

  useEffect(() => {
    if (session?.status === 'completed' && !savedRef.current) {
      savedRef.current = true;
      saveTransaction({
        id: crypto.randomUUID(),
        type: 'receive',
        amount: session.amount,
        token: 'APT',
        status: 'completed',
        timestamp: new Date().toISOString(),
      });
      setTimeout(() => navigate('/'), 2500);
    }
  }, [session?.status, session?.amount, navigate]);

  const handleGenerate = () => {
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return;
    setShowQR(true);
    startReceive(amt);
  };

  if (session?.status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center ghost-glow">
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-white/60">Payment Received</p>
          <p className="text-3xl font-black tracking-tighter text-white mt-2">
            {formatAmount(session.received, 4)} APT
          </p>
          {session.fee > 0 && (
            <p className="text-[10px] text-white/30 mt-1">
              Fee: {formatAmount(session.fee, 4)} APT
            </p>
          )}
        </div>
      </div>
    );
  }

  if (showQR && address) {
    const amt = parseFloat(amount) || 0;
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);

    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 px-4">
        <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em]">
          Requesting {formatAmount(amt)} APT
        </p>

        <QRDisplay address={address} amount={amt} />

        {session?.status === 'waiting' && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-violet-400 rounded-full animate-ghost-pulse" />
              <p className="text-xs font-bold text-white/60">Waiting for payment...</p>
            </div>
            <p className="text-xs text-white/30 font-mono tabular-nums">
              {minutes}:{String(seconds).padStart(2, '0')}
            </p>
          </>
        )}

        {session?.status === 'verifying' && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-ping" />
            <p className="text-xs font-bold text-emerald-400">Verifying payment...</p>
          </div>
        )}

        {session?.status === 'expired' && (
          <p className="text-xs font-bold text-red-400">Session expired</p>
        )}

        <button
          onClick={() => {
            cancel();
            setShowQR(false);
          }}
          className="text-xs font-bold text-white/30 uppercase tracking-widest"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-6">
      <div className="text-center">
        <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em] mb-6">
          Receive Payment
        </p>
        <input
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full text-center text-4xl font-black tracking-tighter text-white bg-transparent border-b-2 border-white/10 focus:border-violet-400 outline-none pb-3 transition-colors placeholder:text-white/10"
        />
        <p className="text-xs text-white/30 mt-3">Enter the amount to receive (APT)</p>
      </div>

      <button
        onClick={handleGenerate}
        disabled={!amount || parseFloat(amount) <= 0}
        className="w-full py-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-black rounded-2xl active:scale-[0.98] transition-all uppercase tracking-widest disabled:opacity-20"
      >
        Generate QR Code
      </button>

      <button
        onClick={() => navigate('/')}
        className="text-xs font-bold text-white/30 uppercase tracking-widest"
      >
        Cancel
      </button>
    </div>
  );
}
