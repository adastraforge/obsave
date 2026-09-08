import type ObSavePlugin from "../main";
import { isProviderConfigured } from "../types";
import type { FileSyncStatus } from "../types";
import type { LedgerEntry } from "../ledger/types";

const DOT_CLASS = "obsave-dot";

interface FileExplorerEntry {
	path: string;
	anchor: HTMLElement;
	kind: "file" | "folder";
}

/**
 * Badges de color en el Explorador — leen exclusivamente el ledger local en memoria.
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
		const fileStatuses = this.computeFileStatuses();
		const folderStatuses = this.computeFolderStatuses(fileStatuses);
		this.applyDecorations(fileStatuses, folderStatuses);
	}

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
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, 400);
	}

	private computeFileStatuses(): Map<string, FileSyncStatus> {
		const statuses = new Map<string, FileSyncStatus>();

		if (!isProviderConfigured(this.plugin.settings)) {
			for (const file of this.plugin.app.vault.getMarkdownFiles()) {
				statuses.set(file.path, "new");
			}
			return statuses;
		}

		const isSyncing = this.plugin.syncEngine.getStatus() === "syncing";
		const entries = this.plugin.ledgerManager.getEntries();

		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			statuses.set(
				file.path,
				this.mapLedgerStatus(entries[file.path], isSyncing),
			);
		}

		return statuses;
	}

	private mapLedgerStatus(
		entry: LedgerEntry | undefined,
		isSyncing: boolean,
	): FileSyncStatus {
		if (isSyncing) {
			return "modified";
		}
		if (!entry) {
			return "new";
		}
		if (entry.status === "C") {
			return "new";
		}
		if (entry.status === "U" || entry.status === "D") {
			return "modified";
		}
		if (entry.status === "S" && entry.remoteId) {
			return "synced";
		}
		return "new";
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

		const isSyncing = this.plugin.syncEngine.getStatus() === "syncing";
		const entries = this.plugin.ledgerManager.getEntries();

		for (const folder of this.plugin.app.vault.getAllFolders()) {
			folderStatuses.set(
				folder.path,
				this.aggregateFolderStatus(
					folder.path,
					entries[folder.path],
					fileStatuses,
					isSyncing,
				),
			);
		}

		return folderStatuses;
	}

	private aggregateFolderStatus(
		folderPath: string,
		folderEntry: LedgerEntry | undefined,
		fileStatuses: Map<string, FileSyncStatus>,
		isSyncing: boolean,
	): FileSyncStatus {
		if (isSyncing) {
			return "modified";
		}

		const prefix = folderPath ? `${folderPath}/` : "";
		const childFileStatuses = [...fileStatuses.entries()].filter(
			([filePath]) =>
				filePath.startsWith(prefix) && filePath.length > prefix.length,
		);

		let hasNew = false;
		let hasModified = false;

		for (const [, status] of childFileStatuses) {
			if (status === "new") {
				hasNew = true;
			} else if (status === "modified") {
				hasModified = true;
			}
		}

		const childFolders = this.plugin.app.vault
			.getAllFolders()
			.filter(
				(f) =>
					f.path.startsWith(prefix) &&
					f.path.length > prefix.length &&
					f.path !== folderPath,
			);

		for (const child of childFolders) {
			const childStatus = this.aggregateFolderStatus(
				child.path,
				this.plugin.ledgerManager.getEntry(child.path),
				fileStatuses,
				isSyncing,
			);
			if (childStatus === "new") {
				hasNew = true;
			} else if (childStatus === "modified") {
				hasModified = true;
			}
		}

		if (folderEntry?.status === "C" || hasNew) {
			return "new";
		}
		if (folderEntry?.status === "U" || hasModified) {
			return "modified";
		}
		if (folderEntry?.status === "S" && folderEntry.remoteId) {
			return "synced";
		}
		if (!folderEntry && !hasNew && !hasModified && childFileStatuses.length === 0) {
			return "synced";
		}
		return hasModified ? "modified" : hasNew ? "new" : "synced";
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
