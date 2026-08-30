import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useCopyCredentials } from "../hooks/useCopyCredentials";
import { useServiceActions } from "../hooks/useServiceActions";
import { useTemplateCatalogue } from "../hooks/useTemplateCatalogue";
import { LibraryTiles } from "./dashboard/LibraryTiles";
import { ServiceSetupScreen } from "./dashboard/ServiceSetupScreen";
import { ServicesSection } from "./dashboard/ServicesSection";
import { TemplatesSection } from "./dashboard/TemplatesSection";

interface DashboardProps {
	onReconfigure: () => void;
	onInstall: (serviceId: string, serviceName: string) => void;
}

/**
 * Owns what the dashboard knows and which of its three screens you are on: the
 * stack itself, or the form that installs or reconfigures one service. The
 * queries stay here rather than in the sections, because switching screens is a
 * `return` — the sections unmount, this component does not.
 */
export function Dashboard({ onReconfigure, onInstall }: DashboardProps) {
	const { data: services, isLoading } = useQuery({
		queryKey: ["services"],
		queryFn: api.getServices,
		refetchInterval: 5000,
	});

	const { data: registry } = useQuery({
		queryKey: ["registry"],
		queryFn: api.getRegistry,
	});

	// Counted off the filesystem, so it survives a stopped media server
	const { data: library } = useQuery({
		queryKey: ["library-stats"],
		queryFn: api.getLibraryStats,
		refetchInterval: 30000,
	});

	const { data: templates } = useQuery({
		queryKey: ["templates"],
		queryFn: api.getTemplates,
	});

	const { data: credentials } = useQuery({
		queryKey: ["credentials"],
		queryFn: api.getCredentials,
	});
	const [adding, setAdding] = useState(false);
	const [reconfiguring, setReconfiguring] = useState<string | null>(null);

	const actions = useServiceActions();
	const copy = useCopyCredentials(credentials);
	const catalogue = useTemplateCatalogue();

	if (isLoading || !services) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
			</div>
		);
	}

	const enabledServices = services.filter((s) => s.enabled);
	const enabledIds = new Set(enabledServices.map((s) => s.name));
	const uninstalled = (registry ?? []).filter((svc) => !enabledIds.has(svc.id));

	// Reconfiguring replays one service's template with new values; picking a new
	// one is the same form arriving empty. Both replace the dashboard.
	const reconfigureMeta = reconfiguring
		? (registry ?? []).find((svc) => svc.id === reconfiguring)
		: undefined;

	if (reconfiguring && reconfigureMeta) {
		return (
			<ServiceSetupScreen
				title={`Reconfigure ${reconfigureMeta.name}`}
				services={[]}
				locked={reconfigureMeta}
				initialCreds={credentials?.[reconfiguring]}
				submitVerb="Reconfigure"
				submit={(id, creds) => api.reconfigureService(id, creds)}
				onBack={() => setReconfiguring(null)}
				onDone={(id, name) => {
					setReconfiguring(null);
					onInstall(id, name);
				}}
			/>
		);
	}

	if (adding) {
		return (
			<ServiceSetupScreen
				title="Add a service"
				services={uninstalled}
				submitVerb="Install"
				submit={(id, creds) => api.installService(id, creds)}
				onBack={() => setAdding(false)}
				onDone={(id, name) => {
					setAdding(false);
					onInstall(id, name);
				}}
			/>
		);
	}

	return (
		<div className="space-y-6">
			<LibraryTiles library={library} />

			<ServicesSection
				services={enabledServices}
				uninstalled={uninstalled.length}
				credentials={credentials}
				actions={actions}
				copy={copy}
				onReconfigureAll={onReconfigure}
				onReconfigureService={setReconfiguring}
				onAdd={() => setAdding(true)}
			/>

			<TemplatesSection templates={templates} catalogue={catalogue} />
		</div>
	);
}
