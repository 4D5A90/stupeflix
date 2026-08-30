import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useSetupStatus(enabled: boolean) {
	return useQuery({
		queryKey: ["setup-status"],
		queryFn: api.getStatus,
		enabled,
		refetchInterval: (query) => {
			const data = query.state.data;
			if (!data) return 1000;
			if (data.global === "completed" || data.global === "failed") return false;
			return 1000;
		},
	});
}
