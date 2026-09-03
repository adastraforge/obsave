import type { App } from "obsidian";
import type { CloudProviderId, ObSaveSettings } from "../settings";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";
import type { IStorageProvider, SyncResult } from "../providers/IStorageProvider";
import type { SyncEngineEvent, SyncStatus, SyncTrigger } from "../types";

type SyncEngineListener = (event: SyncEngineEvent) => void;

/**
 * Motor de sincronización — delega al proveedor de nube activo (único).
 * Google Drive: lee notas `.md` locales y las sube vía GoogleDriveProvider.
 */
export class SyncEngine {
	private status: SyncStatus = "idle";
	private listeners: SyncEngineListener[] = [];

	constructor(
		private app: App,
		private settings: ObSaveSettings,
		private providers: Map<CloudProviderId, IStorageProvider>,
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

	async sync(trigger: SyncTrigger = "automatic"): Promise<void> {
		if (this.status === "syncing") {
			return;
		}

		const providerId = this.settings.activeProvider;
		if (!providerId) {
			if (trigger === "manual") {
				this.emit({
					type: "sync-error",
					status: "error",
					message: "No hay proveedor de nube configurado.",
					timestamp: new Date().toISOString(),
					trigger,
				});
			}
			return;
		}

		const provider = this.providers.get(providerId);
		if (!provider) {
			this.emit({
				type: "sync-error",
				status: "error",
				message: `Proveedor "${providerId}" no registrado.`,
				timestamp: new Date().toISOString(),
				trigger,
			});
			return;
		}

		this.setStatus("syncing");

		try {
			const result =
				providerId === "gdrive"
					? await this.syncGoogleDrive(provider as GoogleDriveLazyProvider)
					: await provider.sync();

			this.setStatus("idle");
			this.emit({
				type: "sync-complete",
				status: "idle",
				message: result.message,
				timestamp: new Date().toISOString(),
				trigger,
				noChanges: result.noChanges,
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
				trigger,
			});
		}
	}

	private async syncGoogleDrive(
		provider: GoogleDriveLazyProvider,
	): Promise<SyncResult> {
		const folder = await provider.getOrCreateTargetFolder();
		const remoteFiles = await provider.listFiles(folder.folderId);
		const remoteByName = new Map(remoteFiles.map((f) => [f.name, f.id]));

		const mdFiles = this.app.vault.getMarkdownFiles();
		let uploadedCount = 0;
		const syncedFileMtimes: Record<string, number> = {};

		for (const file of mdFiles) {
			const driveName = this.toDriveFileName(file.path);
			const content = await this.app.vault.read(file);
			await provider.uploadFile(
				driveName,
				content,
				folder.folderId,
				remoteByName.get(driveName),
			);
			syncedFileMtimes[file.path] = file.stat.mtime;
			uploadedCount++;
		}

		const gdrive = this.settings.providerConfig.gdrive;
		if (gdrive) {
			this.settings.providerConfig.gdrive = {
				...gdrive,
				folderId: folder.folderId,
				folderPath: folder.folderPath,
				folderName: folder.folderName,
				folderSelected: true,
				syncedFileMtimes,
			};
		}

		return {
			message: "¡Sincronización completada exitosamente!",
			downloadedCount: 0,
			uploadedCount,
			noChanges: uploadedCount === 0,
		};
	}

	/** Convierte rutas de bóveda a nombres válidos en Drive (sin `/`). */
	private toDriveFileName(vaultPath: string): string {
		return vaultPath.replace(/\//g, "_");
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
