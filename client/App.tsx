import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import QuickDx from "./pages/QuickDx";
import Incident from "./pages/Incident";
import Runbooks from "./pages/Runbooks";
import Settings from "./pages/Settings";
import Terminal from "./pages/Terminal";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * Main App component with routing and global providers
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/quick-dx" element={<QuickDx />} />
            <Route path="/incident" element={<Incident />} />
            <Route path="/runbooks" element={<Runbooks />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/terminal" element={<Terminal />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
