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
 * Badges en el Explorador — evaluación O(1) por ruta visible desde el ledger en memoria.
 */
export class ObSaveFileStatusDecorator {
	private refreshTimer: number | null = null;
	private forceDisconnected = false;

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
		this.applyDecorationsToVisibleEntries();
	}

	async refreshDisconnected(): Promise<void> {
		this.forceDisconnected = true;
		try {
			this.applyDecorationsToVisibleEntries();
		} finally {
			this.forceDisconnected = false;
		}
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

	/** Índice: carpeta → tiene descendiente en ledger con C o U (un solo pase sobre entries). */
	private buildFolderPendingIndex(): Map<string, boolean> {
		const pendingUnder = new Map<string, boolean>();
		const entries = this.plugin.ledgerManager.getEntries();

		for (const [key, entry] of Object.entries(entries)) {
			if (entry.status !== "C" && entry.status !== "U") {
				continue;
			}
			const segments = key.split("/");
			for (let depth = 1; depth < segments.length; depth++) {
				const ancestor = segments.slice(0, depth).join("/");
				pendingUnder.set(ancestor, true);
			}
		}

		return pendingUnder;
	}

	private isDisconnected(): boolean {
		return (
			this.forceDisconnected || !isProviderConfigured(this.plugin.settings)
		);
	}

	/** Máquina de estados estricta para archivos `.md` — solo lectura O(1) del ledger. */
	resolveFileStatus(path: string): FileSyncStatus {
		if (this.isDisconnected()) {
			return "new";
		}

		const entry = this.plugin.ledgerManager.getEntry(path);
		return this.mapFileLedgerStatus(entry);
	}

	private mapFileLedgerStatus(entry: LedgerEntry | undefined): FileSyncStatus {
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

	/** Máquina de estados para carpetas — O(1) por ruta + índice de pendientes. */
	resolveFolderStatus(
		folderPath: string,
		pendingUnder: Map<string, boolean>,
	): FileSyncStatus {
		if (this.isDisconnected()) {
			return "new";
		}

		const entry = this.plugin.ledgerManager.getEntry(folderPath);
		const hasPendingChildren = pendingUnder.get(folderPath) === true;

		if (entry?.status === "C") {
			return "new";
		}
		if (entry?.status === "U") {
			return "modified";
		}
		if (entry?.status === "S") {
			if (hasPendingChildren) {
				return "modified";
			}
			if (entry.remoteId) {
				return "synced";
			}
			return "new";
		}

		if (hasPendingChildren) {
			return "modified";
		}

		return "synced";
	}

	private applyDecorationsToVisibleEntries(): void {
		this.clearDecorations();

		const explorerLeaves = this.plugin.app.workspace.getLeavesOfType(
			"file-explorer",
		);
		if (explorerLeaves.length === 0) {
			return;
		}

		const pendingUnder = this.isDisconnected()
			? new Map<string, boolean>()
			: this.buildFolderPendingIndex();

		for (const leaf of explorerLeaves) {
			const visible = this.collectExplorerEntries(leaf.view.containerEl);

			for (const { path, anchor, kind } of visible) {
				const status =
					kind === "folder"
						? this.resolveFolderStatus(path, pendingUnder)
						: this.resolveFileStatus(path);
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
