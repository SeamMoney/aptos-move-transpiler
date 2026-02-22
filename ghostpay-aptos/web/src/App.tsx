import { Routes, Route } from 'react-router-dom';
import { useWallet } from './contexts/WalletContext';
import Layout from './components/Layout';
import ConnectWallet from './components/ConnectWallet';
import HomePage from './pages/HomePage';
import DepositPage from './pages/DepositPage';
import WithdrawPage from './pages/WithdrawPage';
import SendPage from './pages/SendPage';
import ReceivePage from './pages/ReceivePage';
import HistoryPage from './pages/HistoryPage';

export default function App() {
  const { connected } = useWallet();

  if (!connected) {
    return (
      <div className="h-[100dvh] max-w-md mx-auto">
        <ConnectWallet />
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/deposit" element={<DepositPage />} />
        <Route path="/withdraw" element={<WithdrawPage />} />
        <Route path="/send" element={<SendPage />} />
        <Route path="/receive" element={<ReceivePage />} />
        <Route path="/history" element={<HistoryPage />} />
      </Routes>
    </Layout>
  );
}
