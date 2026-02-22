import { useState, useEffect, useCallback, useRef } from 'react';
import { getPoolBalance, getOnchainBalance } from '../services/poolService';
import { POLL_INTERVAL, FAST_POLL_INTERVAL, FAST_POLL_DURATION } from '../config/aptos';

export function useBalance(address: string | undefined) {
  const [poolBalance, setPoolBalance] = useState(0);
  const [onchainBalance, setOnchainBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const fastPollUntil = useRef(0);

  const refreshPool = useCallback(async () => {
    if (!address) return;
    try {
      setPoolBalance(await getPoolBalance(address));
    } catch {
      // keep last known
    } finally {
      setLoading(false);
    }
  }, [address]);

  const refreshOnchain = useCallback(async () => {
    if (!address) return;
    try {
      setOnchainBalance(await getOnchainBalance(address));
    } catch {
      // keep last known
    }
  }, [address]);

  const refresh = useCallback(async () => {
    fastPollUntil.current = Date.now() + FAST_POLL_DURATION;
    await Promise.all([refreshPool(), refreshOnchain()]);
  }, [refreshPool, refreshOnchain]);

  // Pool balance polling
  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    refreshPool();
    const fastId = setInterval(() => {
      if (Date.now() < fastPollUntil.current) refreshPool();
    }, FAST_POLL_INTERVAL);
    const normalId = setInterval(refreshPool, POLL_INTERVAL);
    return () => {
      clearInterval(fastId);
      clearInterval(normalId);
    };
  }, [address, refreshPool]);

  // On-chain balance polling (less frequent)
  useEffect(() => {
    if (!address) return;
    refreshOnchain();
    const fastId = setInterval(() => {
      if (Date.now() < fastPollUntil.current) refreshOnchain();
    }, FAST_POLL_INTERVAL);
    const normalId = setInterval(refreshOnchain, 30_000);
    return () => {
      clearInterval(fastId);
      clearInterval(normalId);
    };
  }, [address, refreshOnchain]);

  return { poolBalance, onchainBalance, loading, refresh };
}
