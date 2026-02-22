import type { Transaction } from '../types';

const STORAGE_KEY = 'ghostpay_txs';
const MAX_TRANSACTIONS = 100;

export function getTransactions(): Transaction[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveTransaction(tx: Transaction): void {
  const txs = getTransactions();
  txs.unshift(tx);
  if (txs.length > MAX_TRANSACTIONS) txs.length = MAX_TRANSACTIONS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
}

export function clearTransactions(): void {
  localStorage.removeItem(STORAGE_KEY);
}
