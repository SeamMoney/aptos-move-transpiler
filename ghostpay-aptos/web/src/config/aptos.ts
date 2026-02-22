import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';

// Network configuration — switch between devnet/testnet/mainnet
export const NETWORK = Network.TESTNET;

export const APTOS_CONFIG = new AptosConfig({ network: NETWORK });
export const aptos = new Aptos(APTOS_CONFIG);

// GhostPay contract address (set after deployment)
export const GHOSTPAY_MODULE_ADDRESS = import.meta.env.VITE_GHOSTPAY_ADDRESS || '0x1';
export const GHOSTPAY_POOL_MODULE = `${GHOSTPAY_MODULE_ADDRESS}::pool`;
export const GHOSTPAY_STEALTH_MODULE = `${GHOSTPAY_MODULE_ADDRESS}::stealth`;

// Polling configuration
export const POLL_INTERVAL = 3_000;         // 3s balance polling
export const FAST_POLL_INTERVAL = 1_500;    // 1.5s after transaction
export const FAST_POLL_DURATION = 30_000;   // 30s fast polling window
export const SESSION_TIMEOUT = 5 * 60_000;  // 5min payment session
