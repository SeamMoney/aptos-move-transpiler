import { formatAmount, TOKENS } from '../types';

interface Props {
  poolBalance: number;
  onchainBalance: number;
  loading: boolean;
}

export default function BalanceCard({ poolBalance, onchainBalance, loading }: Props) {
  return (
    <div className="text-center py-8">
      {/* Main pool balance */}
      <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.2em] mb-2">
        Pool Balance
      </p>
      <h1 className="text-5xl font-black tracking-tighter text-white">
        {loading ? (
          <span className="inline-block w-40 h-14 bg-white/5 rounded-2xl animate-pulse" />
        ) : (
          formatAmount(poolBalance)
        )}
      </h1>
      <div className="flex items-center justify-center gap-2 mt-2">
        <img
          src={TOKENS.APT.logoUrl}
          alt="APT"
          className="w-5 h-5 rounded-full"
        />
        <span className="text-sm text-white/40 font-medium">APT</span>
      </div>

      {/* On-chain balance pill */}
      {!loading && (
        <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 glass rounded-full">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              onchainBalance > 0 ? 'bg-emerald-400' : 'bg-white/20'
            }`}
          />
          <span className="text-xs font-medium text-white/40">
            {formatAmount(onchainBalance)} APT on-chain
          </span>
        </div>
      )}
    </div>
  );
}
