import { formatAmount, truncateAddress, type Transaction } from '../types';

interface Props {
  transactions: Transaction[];
  limit?: number;
}

const TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  deposit: {
    label: 'Deposit',
    icon: 'M12 4v16m0-16l-4 4m4-4l4 4',
    color: 'text-emerald-400',
  },
  withdraw: {
    label: 'Withdraw',
    icon: 'M12 20V4m0 16l-4-4m4 4l4-4',
    color: 'text-amber-400',
  },
  send: {
    label: 'Sent',
    icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
    color: 'text-red-400',
  },
  receive: {
    label: 'Received',
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
    color: 'text-violet-400',
  },
};

export default function TransactionList({ transactions, limit }: Props) {
  const items = limit ? transactions.slice(0, limit) : transactions;

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/20 text-sm font-medium">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((tx) => {
        const config = TYPE_CONFIG[tx.type] || TYPE_CONFIG.send;
        const isCredit = tx.type === 'deposit' || tx.type === 'receive';
        const timeStr = new Date(tx.timestamp).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={tx.id}
            className="flex items-center gap-3 px-4 py-3 glass rounded-2xl"
          >
            <div className={`p-2 rounded-xl bg-white/5 ${config.color}`}>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={config.icon}
                />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">{config.label}</p>
              <p className="text-[10px] text-white/30 font-mono">
                {tx.counterparty
                  ? truncateAddress(tx.counterparty)
                  : timeStr}
              </p>
            </div>

            <div className="text-right">
              <p
                className={`text-sm font-black ${
                  isCredit ? 'text-emerald-400' : 'text-white'
                }`}
              >
                {isCredit ? '+' : '-'}
                {formatAmount(tx.amount, 2)} {tx.token}
              </p>
              <p className="text-[10px] text-white/20 font-medium">
                {tx.status === 'completed' ? timeStr : tx.status}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
