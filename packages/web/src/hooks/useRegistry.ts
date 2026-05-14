import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useRegistry() {
	return useQuery({
		queryKey: ["registry"],
		queryFn: api.getRegistry,
		staleTime: 5 * 60 * 1000,
	});
}
