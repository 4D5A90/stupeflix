import { useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { Dashboard } from "./components/Dashboard";
import { InstallProgress } from "./components/InstallProgress";
import { Wizard } from "./components/Wizard";

const queryClient = new QueryClient();

const logo = <img src="/logo.png" alt="Stupeflix" className="h-24 mb-2 logo-spin" />;

interface InstallState {
  serviceId: string;
  serviceName: string;
}

function AppContent() {
  const [forceWizard, setForceWizard] = useState(false);
  const [installing, setInstalling] = useState<InstallState | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["app-status"],
    queryFn: api.getAppStatus,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  const setupCompleted = data?.setup_completed && !forceWizard;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* The dashboard lays out tiles and two card columns; the wizard is a form
          and reads better narrow, so the shell widens only for the dashboard. */}
      <div className={`w-full ${setupCompleted && !installing ? "max-w-4xl" : "max-w-2xl"}`}>
        <div className="flex flex-col items-center mb-8">{logo}</div>
        <div className="bg-ink-900 rounded-xl p-6 shadow-xl ring-1 ring-white/5">
          {installing ? (
            <InstallProgress
              serviceId={installing.serviceId}
              serviceName={installing.serviceName}
              onDone={() => {
                setInstalling(null);
                queryClient.invalidateQueries({ queryKey: ["services"] });
                queryClient.invalidateQueries({ queryKey: ["credentials"] });
              }}
            />
          ) : setupCompleted ? (
            <Dashboard
              onReconfigure={() => setForceWizard(true)}
              onInstall={(serviceId, serviceName) => setInstalling({ serviceId, serviceName })}
            />
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
