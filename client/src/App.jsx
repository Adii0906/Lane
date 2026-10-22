import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
import Landing from './pages/Landing.jsx';
import RoomPage from './pages/RoomPage.jsx';
import { RoomProvider } from './state/RoomContext.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <RoomProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/r/:roomId" element={<RoomPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </RoomProvider>
    </BrowserRouter>
  );
}
