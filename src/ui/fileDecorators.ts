import type { Plugin } from "obsidian";
import type { GitHubProvider } from "../providers/GitHubProvider";
import type { FileSyncStatus } from "../types";

const DOT_CLASS = "obsave-dot";

interface FileExplorerEntry {
	path: string;
	anchor: HTMLElement;
}

/**
 * Indicadores de color en el Explorador de Archivos según estado Git local/remoto.
 * Usa spans `.obsave-dot` definidos en `styles.css` (cargado automáticamente por Obsidian).
 */
export class ObSaveFileDecorators {
	private refreshTimer: number | null = null;

	constructor(
		private plugin: Plugin,
		private githubProvider: GitHubProvider,
	) {}

	install(): void {
		void this.refresh();
	}

	uninstall(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.clearDecorations();
	}

	/** Refresco inmediato (p. ej. tras performSync). */
	async refresh(): Promise<void> {
		const statuses = await this.githubProvider.getMarkdownFileStatuses();
		this.applyDecorations(statuses);
	}

	/** Refresco diferido ante eventos frecuentes (layout, modify). */
	requestRefresh(): void {
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
			const entries = this.collectFileEntries(leaf.view.containerEl);

			for (const { path, anchor } of entries) {
				const status = statuses.get(path);
				if (!status) continue;
				this.attachDot(anchor, status);
			}
		}
	}

	private collectFileEntries(container: HTMLElement): FileExplorerEntry[] {
		const entries = new Map<string, HTMLElement>();

		container
			.querySelectorAll<HTMLElement>(".nav-file-title[data-path]")
			.forEach((titleEl) => {
				const path = titleEl.getAttribute("data-path");
				if (path?.endsWith(".md")) {
					entries.set(path, titleEl);
				}
			});

		container.querySelectorAll<HTMLElement>(".nav-file[data-path]").forEach(
			(fileEl) => {
				const path = fileEl.getAttribute("data-path");
				if (!path?.endsWith(".md") || entries.has(path)) {
					return;
				}

				const titleEl =
					fileEl.querySelector<HTMLElement>(".nav-file-title") ?? fileEl;
				entries.set(path, titleEl);
			},
		);

		return [...entries.entries()].map(([path, anchor]) => ({ path, anchor }));
	}

	private attachDot(anchor: HTMLElement, status: FileSyncStatus): void {
		anchor.querySelector(`.${DOT_CLASS}`)?.remove();

		const dot = document.createElement("span");
		dot.className = `${DOT_CLASS} ${DOT_CLASS}-${status}`;
		dot.setAttribute("aria-hidden", "true");
		anchor.appendChild(dot);
	}

	private clearDecorations(): void {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType(
			"file-explorer",
		)) {
			leaf.view.containerEl
				.querySelectorAll(`.${DOT_CLASS}`)
				.forEach((el) => el.remove());
		}
	}
}
