import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { ServiceInfo } from "../../api/client";

/**
 * What a service says about itself, beyond whether its container runs — a VPN's
 * exit IP, a server's version. Polled per card so a slow or stopped service
 * never holds up the list, and a value it cannot report shows as a dash.
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
		<div
			// Same strip as the action footer: same border, same 32px content box,
			// same text size. Only the content differs, so nothing else should.
			className="flex min-h-[33px] flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-white/[0.07] px-3.5 text-xs"
		>
			{fields.map((field) => (
				<span key={field.name} className="flex items-baseline gap-1.5">
					<span className="text-gray-500">{field.label}</span>
					{/* A monospace face reads larger than a sans at the same nominal
					    size, so the value is stepped down to match the label optically */}
					<span className="font-mono text-[11px] tabular-nums text-gray-300">
						{data?.[field.name] ?? "—"}
					</span>
				</span>
			))}
		</div>
	);
}
