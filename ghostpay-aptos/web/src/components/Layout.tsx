import type { ReactNode } from 'react';
import { useWallet } from '../contexts/WalletContext';
import { truncateAddress } from '../types';
import BottomNav from './BottomNav';

export default function Layout({ children }: { children: ReactNode }) {
  const { address, disconnect, walletName } = useWallet();

  return (
    <div className="flex flex-col h-[100dvh] max-w-md mx-auto bg-black relative">
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 bg-violet-500/10 rounded-full blur-[120px] pointer-events-none" />

      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          </div>
          <span className="text-lg font-black tracking-tighter gradient-text">GhostPay</span>
        </div>

        <button
          onClick={disconnect}
          className="flex items-center gap-2 px-3 py-1.5 glass rounded-full hover:bg-white/10 transition-colors"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-[11px] font-mono text-white/60">
            {address ? truncateAddress(address) : 'Wallet'}
          </span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto relative z-10">{children}</div>

      <BottomNav />
    </div>
  );
}
