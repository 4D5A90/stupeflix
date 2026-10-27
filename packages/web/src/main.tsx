import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted rather than linked from Google Fonts: the API's CSP serves
// nothing from another origin, and the packaged image must look like dev.
// Latin only — the subsets are separate files, and nothing here needs others.
import "@fontsource/inter-tight/latin-400.css";
import "@fontsource/inter-tight/latin-500.css";
import "@fontsource/inter-tight/latin-700.css";
import "@fontsource/inter-tight/latin-800.css";
import "@fontsource/inter-tight/latin-900.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root to mount into");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
