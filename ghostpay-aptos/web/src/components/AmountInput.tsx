import { useState } from 'react';

interface Props {
  onConfirm: (amount: number) => void;
  onCancel: () => void;
  confirmLabel?: string;
  maxAmount?: number;
}

export default function AmountInput({
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  maxAmount,
}: Props) {
  const [value, setValue] = useState('0');

  const press = (key: string) => {
    if (key === 'del') {
      setValue((v) => (v.length > 1 ? v.slice(0, -1) : '0'));
      return;
    }
    setValue((v) => {
      if (v === '0' && key !== '.') return key;
      if (key === '.' && v.includes('.')) return v;
      if (v.includes('.') && v.split('.')[1].length >= 4) return v;
      return v + key;
    });
  };

  const amount = parseFloat(value);
  const overMax = maxAmount !== undefined && amount > maxAmount;

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

  return (
    <div className="flex flex-col h-full">
      {/* Display */}
      <div className="text-center pt-8 pb-4">
        <p className="text-white/30 text-[10px] font-bold tracking-[0.2em] uppercase mb-2">
          Enter Amount
        </p>
        <div className="text-5xl font-black tracking-tighter text-white flex items-center justify-center">
          <span className="text-xl mt-2 mr-1 text-white/20 font-bold">APT</span>
          <span>{value}</span>
        </div>
        {overMax && (
          <p className="text-red-400 text-xs mt-2 font-medium">
            Exceeds available balance
          </p>
        )}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2 px-6 flex-1 items-center">
        {keys.map((key) => (
          <button
            key={key}
            onClick={() => press(key)}
            className="w-16 h-16 mx-auto glass rounded-2xl text-lg font-semibold text-white active:bg-white/15 transition-all flex items-center justify-center active:scale-90"
          >
            {key === 'del' ? (
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
            ) : (
              key
            )}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3 px-4 pb-6">
        <button
          onClick={onCancel}
          className="flex-1 py-4 text-white/50 text-xs font-bold rounded-2xl glass active:bg-white/10 uppercase tracking-widest"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(amount)}
          disabled={amount <= 0 || overMax}
          className="flex-[2] py-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-xs font-black rounded-2xl active:scale-[0.98] transition-all disabled:opacity-20 uppercase tracking-widest"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
