import type ObSavePlugin from "../main";
import { isProviderConfigured } from "../types";
import type { FileSyncStatus } from "../types";
import { hashContent } from "../utils/contentHash";

const DOT_CLASS = "obsave-dot";

interface FileExplorerEntry {
	path: string;
	anchor: HTMLElement;
}

/**
 * Badges de color en el Explorador de Archivos según estado de sync:
 * 🔴 nuevo local · 🟡 modificado pendiente · 🟢 sincronizado
 */
export class ObSaveFileStatusDecorator {
	private refreshTimer: number | null = null;

	constructor(private plugin: ObSavePlugin) {}

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

	async refresh(): Promise<void> {
		const statuses = await this.getMarkdownFileStatuses();
		this.applyDecorations(statuses);
	}

	/** Marca todas las notas como rojas (desconexión / sin proveedor). */
	async refreshDisconnected(): Promise<void> {
		const statuses = new Map<string, FileSyncStatus>();
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			statuses.set(file.path, "new");
		}
		this.applyDecorations(statuses);
	}

	requestRefresh(): void {
		if (this.plugin.syncEngine.getStatus() === "syncing") {
			return;
		}

		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, 400);
	}

	async getMarkdownFileStatuses(): Promise<Map<string, FileSyncStatus>> {
		if (!isProviderConfigured(this.plugin.settings)) {
			const statuses = new Map<string, FileSyncStatus>();
			for (const file of this.plugin.app.vault.getMarkdownFiles()) {
				statuses.set(file.path, "new");
			}
			return statuses;
		}

		const active = this.plugin.settings.activeProvider;

		if (active === "github") {
			return this.plugin.getGitHubProvider().getMarkdownFileStatuses();
		}

		if (active === "gdrive") {
			return this.computeGoogleDriveStatuses();
		}

		return new Map();
	}

	private async computeGoogleDriveStatuses(): Promise<Map<string, FileSyncStatus>> {
		const statuses = new Map<string, FileSyncStatus>();
		const isSyncing = this.plugin.syncEngine.getStatus() === "syncing";
		const ledger = this.plugin.settings.syncedLedger ?? {};

		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const entry = ledger[file.path];

			if (!entry) {
				statuses.set(file.path, "new");
				continue;
			}

			if (isSyncing) {
				statuses.set(file.path, "synced");
				continue;
			}

			const sizeMatches =
				entry.size == null || file.stat.size === entry.size;
			if (file.stat.mtime !== entry.mtime || !sizeMatches) {
				const content = await this.plugin.app.vault.read(file);
				if (hashContent(content) !== entry.hash) {
					statuses.set(file.path, "modified");
					continue;
				}
			}

			statuses.set(file.path, "synced");
		}

		return statuses;
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
		dot.setAttribute(
			"title",
			status === "new"
				? "Nuevo — pendiente de subir"
				: status === "modified"
					? "Modificado — pendiente de sync"
					: "Sincronizado",
		);
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
