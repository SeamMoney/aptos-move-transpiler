import { useState, useEffect, useCallback, useRef } from 'react';
import { getPoolBalance, calculateFee } from '../services/poolService';
import { POLL_INTERVAL, SESSION_TIMEOUT } from '../config/aptos';
import type { PaymentStatus } from '../types';

interface PaymentSession {
  recipient: string;
  amount: number;
  token: string;
  status: PaymentStatus;
  initialBalance: number;
  fee: number;
  received: number;
}

export function usePayment(address: string | undefined) {
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(SESSION_TIMEOUT);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const createdAtRef = useRef(0);

  const cancel = useCallback(() => {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
    clearTimeout(timeoutRef.current);
    setSession(null);
    setTimeRemaining(SESSION_TIMEOUT);
  }, []);

  const startReceive = useCallback(async (amount: number, feeBps: number = 30) => {
    if (!address) return;
    cancel();

    const initialBalance = await getPoolBalance(address);
    const fee = calculateFee(amount, feeBps);
    const expectedAmount = amount - fee;
    createdAtRef.current = Date.now();

    setSession({
      recipient: address,
      amount,
      token: 'APT',
      status: 'waiting',
      initialBalance,
      fee,
      received: 0,
    });
    setTimeRemaining(SESSION_TIMEOUT);

    // Poll for balance changes
    pollRef.current = setInterval(async () => {
      try {
        const current = await getPoolBalance(address);
        const received = current - initialBalance;
        if (received >= expectedAmount * 0.99) { // 1% tolerance for rounding
          clearInterval(pollRef.current);
          clearInterval(timerRef.current);
          clearTimeout(timeoutRef.current);
          setSession(s => s ? { ...s, status: 'verifying', received } : null);
          setTimeout(() => {
            setSession(s => s ? { ...s, status: 'completed' } : null);
          }, 1500);
        }
      } catch {
        // keep polling
      }
    }, POLL_INTERVAL);

    // Countdown timer
    timerRef.current = setInterval(() => {
      setTimeRemaining(Math.max(0, SESSION_TIMEOUT - (Date.now() - createdAtRef.current)));
    }, 1000);

    // Session timeout
    timeoutRef.current = setTimeout(() => {
      setSession(s => s && s.status === 'waiting' ? { ...s, status: 'expired' } : s);
      clearInterval(pollRef.current);
      clearInterval(timerRef.current);
    }, SESSION_TIMEOUT);
  }, [address, cancel]);

  useEffect(() => cancel, [cancel]);

  return { session, timeRemaining, startReceive, cancel };
}
