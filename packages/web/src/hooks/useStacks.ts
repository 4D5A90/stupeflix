import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Shipping stacks is optional, so an empty list is an ordinary answer and not
 * an error: the Services step simply offers no fork.
 */
export function useStacks() {
	return useQuery({
		queryKey: ["stacks"],
		queryFn: api.getStacks,
		staleTime: 5 * 60 * 1000,
	});
}
