import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { isLoggedIn } from "./services/platform-api";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import AvatarEditPage from "./pages/AvatarEditPage";
import App from "./App"; // 原有的对话页面

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/avatar/create" element={<ProtectedRoute><AvatarEditPage /></ProtectedRoute>} />
        <Route path="/avatar/:id" element={<ProtectedRoute><AvatarEditPage /></ProtectedRoute>} />
        <Route path="/avatar/:id/chat" element={<ProtectedRoute><App /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to={isLoggedIn() ? "/dashboard" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
