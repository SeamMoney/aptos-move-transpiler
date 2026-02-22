import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { AptosWalletAdapterProvider, useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { NETWORK } from '../config/aptos';

// ═══════════════════════════════════════════════════════
//  Context types
// ═══════════════════════════════════════════════════════

interface WalletContextType {
  address: string | undefined;
  connected: boolean;
  connecting: boolean;
  walletName: string | undefined;
  connect: (walletName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSubmitTransaction: (payload: any) => Promise<any>;
}

const WalletContext = createContext<WalletContextType>({
  address: undefined,
  connected: false,
  connecting: false,
  walletName: undefined,
  connect: async () => {},
  disconnect: async () => {},
  signAndSubmitTransaction: async () => ({}),
});

// ═══════════════════════════════════════════════════════
//  Inner provider (consumes adapter)
// ═══════════════════════════════════════════════════════

function WalletContextProvider({ children }: { children: ReactNode }) {
  const {
    account,
    connected,
    wallet,
    connect: adapterConnect,
    disconnect: adapterDisconnect,
    signAndSubmitTransaction: adapterSignAndSubmit,
  } = useAptosWallet();

  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async (walletName: string) => {
    setConnecting(true);
    try {
      await adapterConnect(walletName);
    } finally {
      setConnecting(false);
    }
  }, [adapterConnect]);

  const disconnect = useCallback(async () => {
    await adapterDisconnect();
  }, [adapterDisconnect]);

  const signAndSubmitTransaction = useCallback(async (payload: any) => {
    return adapterSignAndSubmit(payload);
  }, [adapterSignAndSubmit]);

  return (
    <WalletContext.Provider
      value={{
        address: account?.address,
        connected,
        connecting,
        walletName: wallet?.name,
        connect,
        disconnect,
        signAndSubmitTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════
//  Outer provider (sets up adapter)
// ═══════════════════════════════════════════════════════

export function AptosWalletProvider({ children }: { children: ReactNode }) {
  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={{
        network: NETWORK,
        aptosApiKey: import.meta.env.VITE_APTOS_API_KEY,
      }}
    >
      <WalletContextProvider>{children}</WalletContextProvider>
    </AptosWalletAdapterProvider>
  );
}

// ═══════════════════════════════════════════════════════
//  Hook
// ═══════════════════════════════════════════════════════

export function useWallet() {
  return useContext(WalletContext);
}
