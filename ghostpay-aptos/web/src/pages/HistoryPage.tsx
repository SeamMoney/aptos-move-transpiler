import { useNavigate } from 'react-router-dom';
import { getTransactions, clearTransactions } from '../services/transactionStore';
import TransactionList from '../components/TransactionList';

export default function HistoryPage() {
  const navigate = useNavigate();
  const txs = getTransactions();

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
          Transaction History
        </h2>
        {txs.length > 0 && (
          <button
            onClick={() => {
              clearTransactions();
              navigate('/');
            }}
            className="text-[10px] font-bold text-red-400/60 uppercase tracking-wider"
          >
            Clear
          </button>
        )}
      </div>

      <TransactionList transactions={txs} />
    </div>
  );
}
