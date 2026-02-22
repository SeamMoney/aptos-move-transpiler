// ═══════════════════════════════════════════════════════
//  Token configuration
// ═══════════════════════════════════════════════════════

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  coinType: string;        // Aptos coin type (e.g. "0x1::aptos_coin::AptosCoin")
  logoUrl: string;
  color: string;           // Brand color for UI
}

export const TOKENS: Record<string, TokenInfo> = {
  APT: {
    symbol: 'APT',
    name: 'Aptos',
    decimals: 8,
    coinType: '0x1::aptos_coin::AptosCoin',
    logoUrl: 'https://raw.githubusercontent.com/hippospace/aptos-coin-list/main/icons/APT.webp',
    color: '#2DD8A3',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    coinType: '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC',
    logoUrl: 'https://raw.githubusercontent.com/hippospace/aptos-coin-list/main/icons/USDC.svg',
    color: '#2775CA',
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    coinType: '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDT',
    logoUrl: 'https://raw.githubusercontent.com/hippospace/aptos-coin-list/main/icons/USDT.svg',
    color: '#26A17B',
  },
};

export const DEFAULT_TOKEN = 'APT';

// ═══════════════════════════════════════════════════════
//  Transaction types
// ═══════════════════════════════════════════════════════

export type TransactionType = 'deposit' | 'withdraw' | 'send' | 'receive';
export type TransactionStatus = 'pending' | 'completed' | 'failed';
export type PaymentStatus = 'idle' | 'waiting' | 'verifying' | 'completed' | 'expired' | 'error';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  token: string;
  status: TransactionStatus;
  timestamp: string;
  counterparty?: string;
  txHash?: string;
}

// ═══════════════════════════════════════════════════════
//  Pool types
// ═══════════════════════════════════════════════════════

export interface PoolStats {
  totalDeposits: number;
  totalWithdrawals: number;
  totalTransfers: number;
  feeBps: number;
  paused: boolean;
}

// ═══════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════

export function formatAmount(amount: number, decimals: number = 4): string {
  return (Math.floor(amount * 10 ** decimals) / 10 ** decimals).toFixed(decimals);
}

export function truncateAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
