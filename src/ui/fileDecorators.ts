import type { Plugin } from "obsidian";
import type { GitAdapter } from "../adapters/GitAdapter";
import type { FileSyncStatus, RepoConfig } from "../types";

const STATUS_CLASSES = [
	"obsave-status-new",
	"obsave-status-modified",
	"obsave-status-synced",
] as const;

const DECORATOR_STYLE_ID = "obsave-file-decorators-style";

/**
 * Indicadores de color en el Explorador de Archivos según estado Git local/remoto.
 */
export class ObSaveFileDecorators {
	private styleEl: HTMLStyleElement | null = null;
	private refreshTimer: number | null = null;

	constructor(
		private plugin: Plugin,
		private getMasterRepo: () => RepoConfig | null,
		private gitAdapter: GitAdapter,
	) {}

	install(): void {
		this.injectStyles();
		this.registerEvents();
		void this.refresh();
	}

	uninstall(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.styleEl?.remove();
		this.styleEl = null;
		this.clearDecorations();
	}

	async refresh(): Promise<void> {
		const statuses = await this.gitAdapter.getMarkdownFileStatuses(
			this.getMasterRepo(),
		);
		this.applyDecorations(statuses);
	}

	private injectStyles(): void {
		if (document.getElementById(DECORATOR_STYLE_ID)) {
			return;
		}

		this.styleEl = document.createElement("style");
		this.styleEl.id = DECORATOR_STYLE_ID;
		this.styleEl.textContent = `
.nav-file-title.obsave-status-new::before,
.nav-file-title.obsave-status-modified::before,
.nav-file-title.obsave-status-synced::before {
	content: "";
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	margin-right: 6px;
	vertical-align: middle;
	position: relative;
	top: -1px;
}
.nav-file-title.obsave-status-new::before {
	background-color: #e74c3c;
}
.nav-file-title.obsave-status-modified::before {
	background-color: #f1c40f;
}
.nav-file-title.obsave-status-synced::before {
	background-color: #2ecc71;
}
`;
		document.head.appendChild(this.styleEl);
	}

	private registerEvents(): void {
		const scheduleRefresh = () => this.scheduleRefresh();

		this.plugin.registerEvent(
			this.plugin.app.workspace.on("layout-change", scheduleRefresh),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on("create", scheduleRefresh),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on("delete", scheduleRefresh),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on("rename", scheduleRefresh),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on("modify", scheduleRefresh),
		);
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, 400);
	}

	private applyDecorations(statuses: Map<string, FileSyncStatus>): void {
		this.clearDecorations();

		const explorerLeaves = this.plugin.app.workspace.getLeavesOfType(
			"file-explorer",
		);
		if (explorerLeaves.length === 0) {
			return;
		}

		for (const leaf of explorerLeaves) {
			const container = leaf.view.containerEl;
			const fileEls = container.querySelectorAll<HTMLElement>(
				'.nav-file[data-path$=".md"]',
			);

			for (const fileEl of fileEls) {
				const filePath = fileEl.getAttribute("data-path");
				if (!filePath) continue;

				const status = statuses.get(filePath);
				if (!status) continue;

				const titleEl = fileEl.querySelector<HTMLElement>(".nav-file-title");
				if (!titleEl) continue;

				titleEl.classList.add(`obsave-status-${status}`);
			}
		}
	}

	private clearDecorations(): void {
		for (const cls of STATUS_CLASSES) {
			document.querySelectorAll(`.nav-file-title.${cls}`).forEach((el) => {
				el.classList.remove(cls);
			});
		}
	}
}
