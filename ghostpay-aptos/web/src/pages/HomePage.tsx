import { useNavigate } from 'react-router-dom';
import { useWallet } from '../contexts/WalletContext';
import { useBalance } from '../hooks/useBalance';
import { getTransactions } from '../services/transactionStore';
import BalanceCard from '../components/BalanceCard';
import TransactionList from '../components/TransactionList';

const actions = [
  {
    label: 'Deposit',
    path: '/deposit',
    icon: 'M12 4v16m0-16l-4 4m4-4l4 4',
    gradient: 'from-emerald-500 to-teal-500',
  },
  {
    label: 'Withdraw',
    path: '/withdraw',
    icon: 'M12 20V4m0 16l-4-4m4 4l4-4',
    gradient: 'from-amber-500 to-orange-500',
  },
  {
    label: 'Send',
    path: '/send',
    icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
    gradient: 'from-violet-500 to-fuchsia-500',
  },
  {
    label: 'Receive',
    path: '/receive',
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
    gradient: 'from-blue-500 to-cyan-500',
  },
];

export default function HomePage() {
  const { address } = useWallet();
  const { poolBalance, onchainBalance, loading } = useBalance(address);
  const navigate = useNavigate();
  const txs = getTransactions();

  return (
    <div className="px-4 pb-4">
      <BalanceCard
        poolBalance={poolBalance}
        onchainBalance={onchainBalance}
        loading={loading}
      />

      {/* Action buttons */}
      <div className="grid grid-cols-4 gap-2 mb-8">
        {actions.map((a) => (
          <button
            key={a.path}
            onClick={() => navigate(a.path)}
            className="flex flex-col items-center gap-2 py-4 rounded-2xl glass hover:bg-white/10 active:scale-95 transition-all"
          >
            <div
              className={`w-10 h-10 rounded-xl bg-gradient-to-br ${a.gradient} flex items-center justify-center`}
            >
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={a.icon}
                />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider">
              {a.label}
            </span>
          </button>
        ))}
      </div>

      {/* Recent transactions */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
            Recent
          </h3>
          {txs.length > 0 && (
            <button
              onClick={() => navigate('/history')}
              className="text-[10px] font-bold text-violet-400"
            >
              See all
            </button>
          )}
        </div>
        <TransactionList transactions={txs} limit={5} />
      </div>
    </div>
  );
}
