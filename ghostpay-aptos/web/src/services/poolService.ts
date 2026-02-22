import { aptos, GHOSTPAY_MODULE_ADDRESS, GHOSTPAY_POOL_MODULE } from '../config/aptos';
import { TOKENS, type PoolStats } from '../types';
import { InputTransactionData } from '@aptos-labs/wallet-adapter-react';

// ═══════════════════════════════════════════════════════
//  Balance queries
// ═══════════════════════════════════════════════════════

/**
 * Get a user's privacy pool balance (in human-readable units).
 */
export async function getPoolBalance(userAddress: string): Promise<number> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${GHOSTPAY_POOL_MODULE}::get_balance`,
        functionArguments: [userAddress],
      },
    });
    const raw = Number(result[0]);
    return raw / 10 ** 8; // APT has 8 decimals
  } catch {
    return 0;
  }
}

/**
 * Get on-chain APT balance (outside the pool).
 */
export async function getOnchainBalance(userAddress: string): Promise<number> {
  try {
    const resources = await aptos.getAccountResource({
      accountAddress: userAddress,
      resourceType: '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>',
    });
    const raw = Number((resources as any).coin.value);
    return raw / 10 ** 8;
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════
//  Pool operations (return transaction payloads)
// ═══════════════════════════════════════════════════════

/**
 * Build a deposit transaction payload.
 */
export function buildDepositPayload(poolAddress: string, amount: number): InputTransactionData {
  const octas = Math.floor(amount * 10 ** 8);
  return {
    data: {
      function: `${GHOSTPAY_POOL_MODULE}::deposit`,
      functionArguments: [poolAddress, octas.toString()],
    },
  };
}

/**
 * Build a withdrawal transaction payload.
 */
export function buildWithdrawPayload(poolAddress: string, amount: number): InputTransactionData {
  const octas = Math.floor(amount * 10 ** 8);
  return {
    data: {
      function: `${GHOSTPAY_POOL_MODULE}::withdraw`,
      functionArguments: [poolAddress, octas.toString()],
    },
  };
}

/**
 * Build a private transfer transaction payload.
 * The commitment is a 32-byte hash that proves the transfer without
 * revealing sender/recipient/amount on-chain.
 */
export function buildPrivateTransferPayload(
  poolAddress: string,
  recipient: string,
  amount: number,
  commitment: Uint8Array,
): InputTransactionData {
  const octas = Math.floor(amount * 10 ** 8);
  return {
    data: {
      function: `${GHOSTPAY_POOL_MODULE}::private_transfer`,
      functionArguments: [
        poolAddress,
        recipient,
        octas.toString(),
        Array.from(commitment),
      ],
    },
  };
}

// ═══════════════════════════════════════════════════════
//  Pool stats
// ═══════════════════════════════════════════════════════

export async function getPoolStats(poolAddress: string): Promise<PoolStats> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${GHOSTPAY_POOL_MODULE}::get_pool_stats`,
        functionArguments: [poolAddress],
      },
    });
    return {
      totalDeposits: Number(result[0]) / 10 ** 8,
      totalWithdrawals: Number(result[1]) / 10 ** 8,
      totalTransfers: Number(result[2]),
      feeBps: Number(result[3]),
      paused: Boolean(result[4]),
    };
  } catch {
    return {
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalTransfers: 0,
      feeBps: 30,
      paused: false,
    };
  }
}

// ═══════════════════════════════════════════════════════
//  Commitment generation
// ═══════════════════════════════════════════════════════

/**
 * Generate a transfer commitment hash.
 * commitment = SHA-256(sender || recipient || amount || nonce)
 */
export async function generateCommitment(
  sender: string,
  recipient: string,
  amount: number,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const data = new Uint8Array([
    ...encoder.encode(sender),
    ...encoder.encode(recipient),
    ...encoder.encode(amount.toString()),
    ...nonce,
  ]);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

// ═══════════════════════════════════════════════════════
//  Fee calculation
// ═══════════════════════════════════════════════════════

export function calculateFee(amount: number, feeBps: number): number {
  return (amount * feeBps) / 10000;
}
