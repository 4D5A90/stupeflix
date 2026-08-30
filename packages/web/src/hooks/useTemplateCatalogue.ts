import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

/**
 * The templates section's own state, held here rather than in the section
 * itself: switching to the install or reconfigure screen unmounts everything the
 * dashboard renders, and an accordion that refolds behind your back — or a
 * confirmation that vanishes — would be a screen change you did not ask for.
 */
export function useTemplateCatalogue() {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [reloaded, setReloaded] = useState<number | null>(null);

	const invalidateTemplates = () => {
		queryClient.invalidateQueries({ queryKey: ["templates"] });
		queryClient.invalidateQueries({ queryKey: ["registry"] });
	};

	const reload = useMutation({
		// Reloading seven files takes about 20ms, so the spinner would flash and
		// the click would feel like it did nothing. Same minimum the card actions use.
		mutationFn: () =>
			Promise.all([
				api.reloadTemplates(),
				new Promise((r) => setTimeout(r, 600)),
			]).then(([result]) => result),
		// The confirmation is local state rather than `reload.isSuccess`, so how long
		// it shows is decided here instead of by the mutation's lifecycle.
		onSuccess: ({ count }) => {
			invalidateTemplates();
			setReloaded(count);
			setTimeout(() => setReloaded(null), 2000);
		},
	});

	const upload = useMutation({
		mutationFn: api.uploadTemplate,
		onSuccess: invalidateTemplates,
	});

	return { open, setOpen, reloaded, reload, upload };
}

export type TemplateCatalogue = ReturnType<typeof useTemplateCatalogue>;
