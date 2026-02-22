import { useState } from 'react';
import { useWallet } from '../contexts/WalletContext';

const WALLETS = [
  { name: 'Petra', icon: 'https://petra.app/favicon.ico' },
  { name: 'Pontem Wallet', icon: 'https://pontem.network/favicon.ico' },
  { name: 'Martian', icon: 'https://martianwallet.xyz/favicon.ico' },
];

export default function ConnectWallet() {
  const { connect, connecting } = useWallet();
  const [error, setError] = useState('');

  const handleConnect = async (walletName: string) => {
    setError('');
    try {
      await connect(walletName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect wallet');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-6">
      {/* Logo & branding */}
      <div className="text-center">
        <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center ghost-glow">
          <svg className="w-14 h-14 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>
        <h1 className="text-4xl font-black tracking-tighter gradient-text">
          GhostPay
        </h1>
        <p className="text-white/40 text-sm mt-3 font-medium leading-relaxed max-w-[260px] mx-auto">
          Private payments on Aptos.<br />
          Deposit, transfer, and withdraw — invisibly.
        </p>
      </div>

      {/* Wallet buttons */}
      <div className="w-full space-y-3">
        {WALLETS.map((w) => (
          <button
            key={w.name}
            onClick={() => handleConnect(w.name)}
            disabled={connecting}
            className="w-full py-4 px-6 glass rounded-2xl flex items-center gap-4 hover:bg-white/10 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <img src={w.icon} alt={w.name} className="w-8 h-8 rounded-lg" />
            <span className="text-sm font-bold text-white">{w.name}</span>
            <svg className="w-4 h-4 text-white/30 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>

      {connecting && (
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-white/50">Connecting...</span>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 text-center max-w-[280px]">{error}</p>
      )}

      {/* Footer */}
      <p className="text-[10px] text-white/20 font-mono tracking-wider">
        POWERED BY APTOS
      </p>
    </div>
  );
}
