const ERROR_MAP: Record<string, string> = {
  E_INSUFFICIENT_BALANCE: 'Insufficient balance in pool',
  E_ZERO_AMOUNT: 'Amount must be greater than zero',
  E_SELF_TRANSFER: 'Cannot transfer to yourself',
  E_POOL_PAUSED: 'Pool is temporarily paused',
  E_INVALID_COMMITMENT: 'Invalid commitment hash',
  E_DUPLICATE_COMMITMENT: 'This transfer has already been processed',
  INSUFFICIENT_BALANCE: 'Not enough APT in your wallet',
  'User rejected': 'Transaction cancelled',
  'rejected the request': 'Transaction cancelled',
};

export function parseErrorMessage(raw: string): string {
  for (const [key, msg] of Object.entries(ERROR_MAP)) {
    if (raw.includes(key)) return msg;
  }
  if (raw.length > 120) return raw.slice(0, 120) + '...';
  return raw;
}
