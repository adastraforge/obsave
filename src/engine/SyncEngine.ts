import type { GitAdapter } from "../adapters/GitAdapter";
import type { ObSaveSettings, SyncEngineEvent, SyncStatus } from "../types";

type SyncEngineListener = (event: SyncEngineEvent) => void;

/**
 * Motor de sincronización Master-Réplicas.
 * Delega el ciclo Git real a GitAdapter.performSync().
 */
export class SyncEngine {
	private status: SyncStatus = "idle";
	private listeners: SyncEngineListener[] = [];

	constructor(
		private settings: ObSaveSettings,
		private gitAdapter: GitAdapter,
	) {}

	on(listener: SyncEngineListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	getStatus(): SyncStatus {
		return this.status;
	}

	updateSettings(settings: ObSaveSettings): void {
		this.settings = settings;
	}

	async sync(): Promise<void> {
		if (this.status === "syncing") {
			return;
		}

		if (!this.settings.masterRepo) {
			this.emit({
				type: "sync-error",
				status: "error",
				message: "No hay repositorio Master configurado.",
				timestamp: new Date().toISOString(),
			});
			return;
		}

		this.setStatus("syncing");

		try {
			const result = await this.gitAdapter.performSync(this.settings.masterRepo);

			this.setStatus("idle");
			this.emit({
				type: "sync-complete",
				status: "idle",
				message: result.message,
				timestamp: new Date().toISOString(),
				downloadedCount: result.downloadedCount,
				uploadedCount: result.uploadedCount,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Error desconocido de sync";
			this.setStatus("error");
			this.emit({
				type: "sync-error",
				status: "error",
				message,
				timestamp: new Date().toISOString(),
			});
		}
	}

	private setStatus(status: SyncStatus): void {
		this.status = status;
		this.emit({
			type: "status-changed",
			status,
			timestamp: new Date().toISOString(),
		});
	}

	private emit(event: SyncEngineEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
