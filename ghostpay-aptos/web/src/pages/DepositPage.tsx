import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import { useBalance } from '../hooks/useBalance';
import { buildDepositPayload } from '../services/poolService';
import { saveTransaction } from '../services/transactionStore';
import { GHOSTPAY_MODULE_ADDRESS } from '../config/aptos';
import { formatAmount } from '../types';
import AmountInput from '../components/AmountInput';
import { parseErrorMessage } from '../utils/parseError';

export default function DepositPage() {
  const { address, signAndSubmitTransaction } = useWallet();
  const { poolBalance, onchainBalance, refresh } = useBalance(address);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'input' | 'loading' | 'success' | 'error'>('input');
  const [error, setError] = useState('');

  const handleConfirm = async (amount: number) => {
    if (!address) return;
    setStatus('loading');
    try {
      const payload = buildDepositPayload(GHOSTPAY_MODULE_ADDRESS, amount);
      await signAndSubmitTransaction(payload);
      refresh();
      saveTransaction({
        id: crypto.randomUUID(),
        type: 'deposit',
        amount,
        token: 'APT',
        status: 'completed',
        timestamp: new Date().toISOString(),
      });
      setStatus('success');
      setTimeout(() => navigate('/'), 2000);
    } catch (e) {
      setError(parseErrorMessage(e instanceof Error ? e.message : 'Deposit failed'));
      setStatus('error');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <div className="w-12 h-12 border-3 border-violet-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-bold text-white/60">Processing deposit...</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-sm font-black uppercase tracking-[0.2em] text-white/60">Deposit Complete</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 px-8">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mb-2">Deposit Failed</p>
          <p className="text-sm font-medium text-white/60 max-w-[260px]">{error}</p>
        </div>
        <button
          onClick={() => setStatus('input')}
          className="text-xs font-bold text-violet-400 uppercase tracking-widest"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Balance display */}
      <div className="flex justify-center gap-3 pt-4 px-4">
        <div className="flex-1 glass rounded-2xl py-3 px-4 text-center">
          <p className="text-[9px] text-white/30 font-bold uppercase tracking-[0.15em]">Pool</p>
          <p className="text-sm font-black text-white mt-0.5">{formatAmount(poolBalance)} APT</p>
        </div>
        <div className="flex-1 glass rounded-2xl py-3 px-4 text-center">
          <p className="text-[9px] text-white/30 font-bold uppercase tracking-[0.15em]">On-chain</p>
          <p className="text-sm font-black text-white mt-0.5">{formatAmount(onchainBalance)} APT</p>
        </div>
      </div>
      <AmountInput onConfirm={handleConfirm} onCancel={() => navigate('/')} confirmLabel="Deposit" maxAmount={onchainBalance} />
    </div>
  );
}
