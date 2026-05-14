import { useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { Dashboard } from "./components/Dashboard";
import { Wizard } from "./components/Wizard";

const queryClient = new QueryClient();

const logo = <img src="/logo.png" alt="Stupeflix" className="h-24 mb-2 logo-spin" />;

function AppContent() {
  const [forceWizard, setForceWizard] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["app-status"],
    queryFn: api.getAppStatus,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  const setupCompleted = data?.setup_completed && !forceWizard;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center mb-8">{logo}</div>
        <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
          {setupCompleted ? (
            <Dashboard onReconfigure={() => setForceWizard(true)} />
          ) : (
            <Wizard onComplete={() => {
              setForceWizard(false);
              queryClient.invalidateQueries({ queryKey: ["app-status"] });
            }} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
