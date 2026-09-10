import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { Unauthorized, api, hasToken } from "./api/client";
import { Dashboard } from "./components/Dashboard";
import { InstallProgress } from "./components/InstallProgress";
import { Unlock } from "./components/Unlock";
import { Wizard } from "./components/Wizard";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// A refused token is an answer, not a hiccup: retrying it three times
			// only delays the one screen that can do something about it.
			retry: (count, error) => !(error instanceof Unauthorized) && count < 3,
		},
	},
});

const logo = (
	<img src="/logo.png" alt="Stupeflix" className="h-24 mb-2 logo-spin" />
);

interface InstallState {
	serviceId: string;
	serviceName: string;
}

function AppContent() {
	const [forceWizard, setForceWizard] = useState(false);
	const [installing, setInstalling] = useState<InstallState | null>(null);
	const [unlocked, setUnlocked] = useState(hasToken());
	const { data, isLoading, error } = useQuery({
		queryKey: ["app-status"],
		queryFn: api.getAppStatus,
		enabled: unlocked,
	});

	// Its own shell, narrower than the app's: one field does not want 896px.
	if (!unlocked || error instanceof Unauthorized) {
		return (
			<div className="min-h-screen flex items-start justify-center p-4 pt-8">
				<div className="w-full max-w-md">
					<div className="flex flex-col items-center mb-8">{logo}</div>
					<div className="bg-ink-900 rounded-xl p-6 shadow-xl ring-1 ring-white/5">
						<Unlock
							onUnlocked={() => {
								setUnlocked(true);
								queryClient.invalidateQueries();
							}}
						/>
					</div>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
			</div>
		);
	}

	const setupCompleted = data?.setup_completed && !forceWizard;

	// Anchored near the top rather than vertically centred: the panel grows with
	// the number of services, and centring pushed the logo down the taller it got.
	return (
		<div className="min-h-screen flex items-start justify-center p-4 pt-8">
			{/* One width throughout. The wizard used to be narrower on the grounds
          that a form reads better that way, but its Services step is a table
          now, and 672px squeezed the description column to nothing. */}
			<div className="w-full max-w-4xl">
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
							onInstall={(serviceId, serviceName) =>
								setInstalling({ serviceId, serviceName })
							}
						/>
					) : (
						<Wizard
							onComplete={() => {
								setForceWizard(false);
								queryClient.invalidateQueries({ queryKey: ["app-status"] });
							}}
						/>
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
