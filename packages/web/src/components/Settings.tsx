import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { ConfigurationPage } from "./settings/ConfigurationPage";
import { TemplatesPage } from "./settings/TemplatesPage";
import { TokenPage } from "./settings/TokenPage";
import { NavLayout, navItemClass } from "./ui/NavLayout";
import { BackLink, Shell } from "./ui/Shell";

type Page = "templates" | "config" | "token";

const PAGES: { id: Page; label: string }[] = [
	{ id: "templates", label: "Templates" },
	{ id: "config", label: "Configuration" },
	{ id: "token", label: "Access token" },
];

/**
 * What you set once and rarely revisit, out of the dashboard's way. The light
 * utility mode: the dashboard is for looking at the stack, this is for
 * changing it.
 */
export function Settings({
	onBack,
	onReconfigure,
	onLock,
}: {
	onBack: () => void;
	onReconfigure: () => void;
	onLock: () => void;
}) {
	const [page, setPage] = useState<Page>("templates");
	// Only for the count beside "Templates"; the page shares this query.
	const { data: templates } = useQuery({
		queryKey: ["templates"],
		queryFn: api.getTemplates,
	});

	return (
		<Shell
			mode="light"
			actions={<BackLink label="Dashboard" onClick={onBack} />}
		>
			<NavLayout
				title="Settings"
				label="Settings"
				nav={PAGES.map((p) => (
					<button
						key={p.id}
						type="button"
						aria-current={p.id === page ? "page" : undefined}
						onClick={() => setPage(p.id)}
						className={`${navItemClass(p.id === page)} justify-between`}
					>
						{p.label}
						{p.id === "templates" && templates ? (
							<span className="text-[13px] font-medium text-muted">
								{templates.length}
							</span>
						) : null}
					</button>
				))}
			>
				{page === "templates" ? <TemplatesPage /> : null}
				{page === "config" ? (
					<ConfigurationPage onReconfigure={onReconfigure} />
				) : null}
				{page === "token" ? <TokenPage onLock={onLock} /> : null}
			</NavLayout>
		</Shell>
	);
}
