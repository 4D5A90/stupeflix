import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { ServiceInfo } from "../../api/client";

/**
 * What a service says about itself, beyond whether its container runs — a VPN's
 * exit IP, a server's version. Polled for the selected service only, so a slow
 * or stopped one never holds up the page, and a value it cannot report shows
 * as a dash. Rendered as items of the billboard's status line.
 */
export function ServiceInfoRow({ service }: { service: ServiceInfo }) {
	const fields = service.info ?? [];
	// The busiest field sets the pace; a template that says nothing gets a minute
	const refresh = Math.min(...fields.map((f) => f.refresh ?? 60), 60);

	const { data } = useQuery({
		queryKey: ["service-info", service.name],
		queryFn: () => api.getServiceInfo(service.name),
		refetchInterval: refresh * 1000,
		enabled: fields.length > 0,
	});

	if (fields.length === 0) return null;

	return (
		<>
			{fields.map((field) => (
				<span key={field.name}>
					{field.label}{" "}
					<strong className="font-bold text-fg tabular-nums">
						{data?.[field.name] ?? "—"}
					</strong>
				</span>
			))}
		</>
	);
}
