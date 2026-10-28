import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { Unauthorized, api, clearToken, hasToken } from "./api/client";
import { Dashboard } from "./components/Dashboard";
import { InstallProgress } from "./components/InstallProgress";
import { Settings } from "./components/Settings";
import { Unlock } from "./components/Unlock";
import { Wizard } from "./components/Wizard";
import { Shell, Spinner } from "./components/ui/Shell";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// A refused token is an answer, not a hiccup: retrying it three times
			// only delays the one screen that can do something about it.
			retry: (count, error) => !(error instanceof Unauthorized) && count < 3,
		},
	},
});

interface InstallState {
	serviceId: string;
	serviceName: string;
}

/** The two screens of an installed stack; the wizard and its kin are not views. */
type View = "dashboard" | "settings";

function AppContent() {
	const [forceWizard, setForceWizard] = useState(false);
	const [installing, setInstalling] = useState<InstallState | null>(null);
	const [unlocked, setUnlocked] = useState(hasToken());
	const [view, setView] = useState<View>("dashboard");
	const { data, isLoading, error } = useQuery({
		queryKey: ["app-status"],
		queryFn: api.getAppStatus,
		enabled: unlocked,
	});

	// Forgetting the token is the same state as never having had one, so it
	// lands on the same screen — and drops every cached answer that came with it.
	const lock = () => {
		clearToken();
		setUnlocked(false);
		setView("dashboard");
		queryClient.clear();
	};

	// Its own column, narrower than the app's: one field does not want 1200px.
	if (!unlocked || error instanceof Unauthorized) {
		return (
			<Shell mode="light">
				<div className="mx-auto w-full max-w-md px-4 pt-16">
					<div className="rounded-lg bg-card p-6">
						<Unlock
							onUnlocked={() => {
								setUnlocked(true);
								queryClient.invalidateQueries();
							}}
						/>
					</div>
				</div>
			</Shell>
		);
	}

	if (isLoading) {
		return (
			<Shell mode="dark">
				<Spinner />
			</Shell>
		);
	}

	if (installing) {
		return (
			<InstallProgress
				serviceId={installing.serviceId}
				serviceName={installing.serviceName}
				onDone={() => {
					setInstalling(null);
					queryClient.invalidateQueries({ queryKey: ["services"] });
					queryClient.invalidateQueries({ queryKey: ["credentials"] });
				}}
			/>
		);
	}

	if (!data?.setup_completed || forceWizard) {
		return (
			<Wizard
				onComplete={() => {
					setForceWizard(false);
					setView("dashboard");
					queryClient.invalidateQueries({ queryKey: ["app-status"] });
				}}
			/>
		);
	}

	if (view === "settings") {
		return (
			<Settings
				onBack={() => setView("dashboard")}
				onReconfigure={() => setForceWizard(true)}
				onLock={lock}
			/>
		);
	}

	return (
		<Dashboard
			onInstall={(serviceId, serviceName) =>
				setInstalling({ serviceId, serviceName })
			}
			onSettings={() => setView("settings")}
		/>
	);
}

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<AppContent />
		</QueryClientProvider>
	);
}
