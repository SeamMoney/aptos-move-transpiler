import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import { useBalance } from '../hooks/useBalance';
import { buildWithdrawPayload } from '../services/poolService';
import { saveTransaction } from '../services/transactionStore';
import { GHOSTPAY_MODULE_ADDRESS } from '../config/aptos';
import { formatAmount } from '../types';
import AmountInput from '../components/AmountInput';
import { parseErrorMessage } from '../utils/parseError';

export default function WithdrawPage() {
  const { address, signAndSubmitTransaction } = useWallet();
  const { poolBalance, refresh } = useBalance(address);
  const navigate = useNavigate();
  const [status, setStatus] = useState<'input' | 'loading' | 'success' | 'error'>('input');
  const [error, setError] = useState('');

  const handleConfirm = async (amount: number) => {
    if (!address) return;
    setStatus('loading');
    try {
      const payload = buildWithdrawPayload(GHOSTPAY_MODULE_ADDRESS, amount);
      await signAndSubmitTransaction(payload);
      refresh();
      saveTransaction({
        id: crypto.randomUUID(),
        type: 'withdraw',
        amount,
        token: 'APT',
        status: 'completed',
        timestamp: new Date().toISOString(),
      });
      setStatus('success');
      setTimeout(() => navigate('/'), 2000);
    } catch (e) {
      setError(parseErrorMessage(e instanceof Error ? e.message : 'Withdrawal failed'));
      setStatus('error');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <div className="w-12 h-12 border-3 border-violet-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-bold text-white/60">Processing withdrawal...</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-sm font-black uppercase tracking-[0.2em] text-white/60">Withdrawal Complete</p>
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
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mb-2">Withdrawal Failed</p>
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
      <div className="text-center pt-4">
        <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.15em]">
          Available: {formatAmount(poolBalance)} APT
        </p>
      </div>
      <AmountInput
        onConfirm={handleConfirm}
        onCancel={() => navigate('/')}
        confirmLabel="Withdraw"
        maxAmount={poolBalance}
      />
    </div>
  );
}
