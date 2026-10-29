import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useCopyCredentials } from "../hooks/useCopyCredentials";
import { useServiceActions } from "../hooks/useServiceActions";
import { useTileOrder } from "../hooks/useTileOrder";
import { Billboard } from "./dashboard/Billboard";
import { LibraryTiles } from "./dashboard/LibraryTiles";
import { ServiceSetupScreen } from "./dashboard/ServiceSetupScreen";
import { ServicesSection } from "./dashboard/ServicesSection";
import { applyOrder } from "./dashboard/tileOrder";
import { ActionIcon } from "./ui/ActionIcon";
import { Button, buttonClass } from "./ui/Button";
import { Shell, Spinner } from "./ui/Shell";

interface DashboardProps {
	onInstall: (serviceId: string, serviceName: string) => void;
	onSettings: () => void;
}

/**
 * Owns what the dashboard knows and which of its three screens you are on: the
 * stack itself, or the form that installs or reconfigures one service. The
 * queries stay here rather than in the sections, because switching screens is a
 * `return` — the sections unmount, this component does not.
 */
export function Dashboard({ onInstall, onSettings }: DashboardProps) {
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

	const { data: credentials } = useQuery({
		queryKey: ["credentials"],
		queryFn: api.getCredentials,
	});
	const [adding, setAdding] = useState(false);
	const [reconfiguring, setReconfiguring] = useState<string | null>(null);
	// Which row is on the billboard. A name, not an index, and resolved against
	// the live list on every render: a removed service falls back to the first
	// row instead of leaving the billboard pointing at nothing.
	const [selected, setSelected] = useState<string | null>(null);
	const [order, setOrder] = useTileOrder();

	const actions = useServiceActions();
	const copy = useCopyCredentials(credentials);

	if (isLoading || !services) {
		return (
			<Shell mode="dark">
				<Spinner />
			</Shell>
		);
	}

	// In the order the cards were dragged into, so the first card is also the
	// one the billboard falls back to.
	const enabled = new Map(
		services.filter((s) => s.enabled).map((s) => [s.name, s]),
	);
	const enabledServices = applyOrder([...enabled.keys()], order).flatMap(
		(name) => enabled.get(name) ?? [],
	);
	const enabledIds = new Set(enabledServices.map((s) => s.name));
	const current =
		enabledServices.find((s) => s.name === selected) ?? enabledServices[0];
	const uninstalled = (registry ?? []).filter((svc) => !enabledIds.has(svc.id));
	// Removing a service keeps its own settings on disk. The install screen asks
	// what to do with them, and only for the services that have any.
	const withLeftovers = new Set(
		services.filter((s) => s.leftovers).map((s) => s.name),
	);
	// What the stack already covers, so the install screen can say what is
	// missing instead of letting the API refuse after the form is filled in
	const installedCategories = (registry ?? [])
		.filter((svc) => enabledIds.has(svc.id))
		.map((svc) => svc.category);

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
				installedCategories={installedCategories}
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
				installedCategories={installedCategories}
				withLeftovers={withLeftovers}
				submitVerb="Install"
				submit={(id, creds, reset) => api.installService(id, creds, reset)}
				onBack={() => setAdding(false)}
				onDone={(id, name) => {
					setAdding(false);
					onInstall(id, name);
				}}
			/>
		);
	}

	return (
		<Shell
			mode="dark"
			overlay={Boolean(current)}
			actions={
				<>
					{/* Hidden rather than disabled when every template is installed:
					    there is nothing it could lead to. */}
					{uninstalled.length > 0 ? (
						<Button size="sm" onClick={() => setAdding(true)}>
							Add service
						</Button>
					) : null}
					<button
						type="button"
						onClick={onSettings}
						className={`${buttonClass("ghost", "sm")} pl-2.5`}
					>
						<ActionIcon name="cog" className="h-5 w-5" />
						Settings
					</button>
				</>
			}
		>
			{current ? (
				<Billboard
					service={current}
					credentials={credentials}
					actions={actions}
					copy={copy}
					notes={
						(registry ?? []).find((svc) => svc.id === current.name)?.notes ?? []
					}
					onReconfigure={() => setReconfiguring(current.name)}
				/>
			) : null}

			<div
				className={`flex flex-wrap items-start gap-10 px-[4%] pt-10 ${current ? "relative isolate flex-1 lg:-mt-10" : ""}`}
			>
				{/* The page is a sheet of grey glass laid on a black ground, to the
				    bottom of the screen (past the Shell's padding). From `lg` up it
				    rides over the billboard's last 2.5rem with the glyph showing
				    through; a grey ground behind it showed as a band through the
				    glass. */}
				{current ? (
					<div
						aria-hidden="true"
						className="glass-sheet absolute inset-x-0 -bottom-[72px] top-0 -z-10"
					/>
				) : null}
				<ServicesSection
					services={enabledServices}
					registry={registry ?? []}
					selected={current?.name}
					onSelect={setSelected}
					onReorder={setOrder}
				/>
				<LibraryTiles library={library} />
			</div>
		</Shell>
	);
}
