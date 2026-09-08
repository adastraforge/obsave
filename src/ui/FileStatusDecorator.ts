import type ObSavePlugin from "../main";
import { isProviderConfigured } from "../types";
import type { FileSyncStatus } from "../types";
import { hashContent } from "../utils/contentHash";

const DOT_CLASS = "obsave-dot";

interface FileExplorerEntry {
	path: string;
	anchor: HTMLElement;
	kind: "file" | "folder";
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
		const fileStatuses = await this.getMarkdownFileStatuses();
		const folderStatuses = this.computeFolderStatuses(fileStatuses);
		this.applyDecorations(fileStatuses, folderStatuses);
	}

	/** Marca todas las notas y carpetas como rojas (desconexión / sin proveedor). */
	async refreshDisconnected(): Promise<void> {
		const fileStatuses = new Map<string, FileSyncStatus>();
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			fileStatuses.set(file.path, "new");
		}
		const folderStatuses = new Map<string, FileSyncStatus>();
		for (const folder of this.plugin.app.vault.getAllFolders()) {
			folderStatuses.set(folder.path, "new");
		}
		this.applyDecorations(fileStatuses, folderStatuses);
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

		if (active === "github" || active === "gdrive") {
			return this.computeLedgerStatuses();
		}

		return new Map();
	}

	private hasValidRemoteId(entry: { driveFileId?: string } | undefined): boolean {
		return !!entry?.driveFileId && entry.driveFileId.trim().length > 0;
	}

	private async computeLedgerStatuses(): Promise<Map<string, FileSyncStatus>> {
		const statuses = new Map<string, FileSyncStatus>();
		const isSyncing = this.plugin.syncEngine.getStatus() === "syncing";
		const ledger = this.plugin.settings.syncedLedger ?? {};

		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const entry = ledger[file.path];

			if (!entry || !this.hasValidRemoteId(entry)) {
				statuses.set(file.path, "new");
				continue;
			}

			if (isSyncing) {
				statuses.set(file.path, "modified");
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

	private computeFolderStatuses(
		fileStatuses: Map<string, FileSyncStatus>,
	): Map<string, FileSyncStatus> {
		const folderStatuses = new Map<string, FileSyncStatus>();

		if (!isProviderConfigured(this.plugin.settings)) {
			for (const folder of this.plugin.app.vault.getAllFolders()) {
				folderStatuses.set(folder.path, "new");
			}
			return folderStatuses;
		}

		for (const folder of this.plugin.app.vault.getAllFolders()) {
			folderStatuses.set(folder.path, this.aggregateFolderStatus(folder.path, fileStatuses));
		}

		return folderStatuses;
	}

	private aggregateFolderStatus(
		folderPath: string,
		fileStatuses: Map<string, FileSyncStatus>,
	): FileSyncStatus {
		const prefix = folderPath ? `${folderPath}/` : "";
		const descendants = [...fileStatuses.entries()].filter(
			([filePath]) => filePath.startsWith(prefix) && filePath.length > prefix.length,
		);

		if (descendants.length === 0) {
			return "synced";
		}

		let hasNew = false;
		let hasModified = false;

		for (const [, status] of descendants) {
			if (status === "new") {
				hasNew = true;
			} else if (status === "modified") {
				hasModified = true;
			}
		}

		if (hasNew) {
			return "new";
		}
		if (hasModified) {
			return "modified";
		}
		return "synced";
	}

	private applyDecorations(
		fileStatuses: Map<string, FileSyncStatus>,
		folderStatuses: Map<string, FileSyncStatus>,
	): void {
		this.clearDecorations();

		const explorerLeaves = this.plugin.app.workspace.getLeavesOfType(
			"file-explorer",
		);
		if (explorerLeaves.length === 0) {
			return;
		}

		for (const leaf of explorerLeaves) {
			const entries = this.collectExplorerEntries(leaf.view.containerEl);

			for (const { path, anchor, kind } of entries) {
				const status =
					kind === "folder"
						? folderStatuses.get(path)
						: fileStatuses.get(path);
				if (!status) continue;
				this.attachDot(anchor, status, kind);
			}
		}
	}

	private collectExplorerEntries(container: HTMLElement): FileExplorerEntry[] {
		const entries = new Map<string, FileExplorerEntry>();

		container
			.querySelectorAll<HTMLElement>(".nav-file-title[data-path]")
			.forEach((titleEl) => {
				const path = titleEl.getAttribute("data-path");
				if (path?.endsWith(".md")) {
					entries.set(path, { path, anchor: titleEl, kind: "file" });
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
				entries.set(path, { path, anchor: titleEl, kind: "file" });
			},
		);

		container
			.querySelectorAll<HTMLElement>(".nav-folder-title[data-path]")
			.forEach((titleEl) => {
				const path = titleEl.getAttribute("data-path");
				if (path) {
					entries.set(`folder:${path}`, {
						path,
						anchor: titleEl,
						kind: "folder",
					});
				}
			});

		container.querySelectorAll<HTMLElement>(".nav-folder[data-path]").forEach(
			(folderEl) => {
				const path = folderEl.getAttribute("data-path");
				if (!path || entries.has(`folder:${path}`)) {
					return;
				}
				const titleEl =
					folderEl.querySelector<HTMLElement>(".nav-folder-title") ?? folderEl;
				entries.set(`folder:${path}`, { path, anchor: titleEl, kind: "folder" });
			},
		);

		return [...entries.values()];
	}

	private attachDot(
		anchor: HTMLElement,
		status: FileSyncStatus,
		kind: "file" | "folder",
	): void {
		anchor.querySelector(`.${DOT_CLASS}`)?.remove();

		const dot = document.createElement("span");
		dot.className = `${DOT_CLASS} ${DOT_CLASS}-${status}`;
		dot.setAttribute("aria-hidden", "true");
		const labels =
			kind === "folder"
				? {
						new: "Carpeta — pendiente de sync",
						modified: "Carpeta — cambios pendientes",
						synced: "Carpeta — sincronizada",
					}
				: {
						new: "Nuevo — pendiente de subir",
						modified: "Modificado — pendiente de sync",
						synced: "Sincronizado",
					};
		dot.setAttribute("title", labels[status]);
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
