import type { ObSaveSettings, SyncEngineEvent, SyncStatus } from "../types";

type SyncEngineListener = (event: SyncEngineEvent) => void;

/**
 * Motor de sincronización Master-Réplicas.
 * Fase 1: stub con API estable para UI y adapters futuros.
 */
export class SyncEngine {
	private status: SyncStatus = "idle";
	private listeners: SyncEngineListener[] = [];

	constructor(private settings: ObSaveSettings) {}

	/** Registra un listener para eventos de sync (UI) */
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

	/**
	 * Ejecuta un ciclo de sincronización.
	 * Fase 1: simula el flujo sin tocar backends reales.
	 */
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
			// Fase 1: placeholder — Fase 3 implementará pull/push real
			await this.simulateSyncCycle();

			this.setStatus("idle");
			this.emit({
				type: "sync-complete",
				status: "idle",
				message: "Sincronización completada (stub).",
				timestamp: new Date().toISOString(),
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

	private async simulateSyncCycle(): Promise<void> {
		const replicaCount = this.settings.replicaRepos.filter((r) => r.enabled).length;
		// Simula latencia de red mínima
		await new Promise((resolve) => setTimeout(resolve, 300));
		console.log(
			`[ObSave SyncEngine] Master: ${this.settings.masterRepo?.label} → ${replicaCount} réplica(s)`,
		);
	}
}
