import type { App } from "obsidian";
import {
	isProviderConfigured,
	type CloudProviderId,
	type ObSaveSettings,
} from "../settings";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";
import type { IStorageProvider, SyncResult } from "../providers/IStorageProvider";
import type { SyncEngineEvent, SyncStatus, SyncTrigger } from "../types";

type SyncEngineListener = (event: SyncEngineEvent) => void;

/**
 * Motor de sincronización — delega al proveedor de nube activo (único).
 * Google Drive: preserva jerarquía de subcarpetas al subir notas `.md`.
 */
export class SyncEngine {
	private status: SyncStatus = "idle";
	private listeners: SyncEngineListener[] = [];
	private autoSyncIntervalId: number | null = null;

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

	isConnected(): boolean {
		return isProviderConfigured(this.settings);
	}

	canAutoSync(): boolean {
		if (!this.settings.autoSyncEnabled) {
			return false;
		}
		if (!this.isConnected()) {
			return false;
		}
		if (this.settings.activeProvider === "gdrive") {
			return this.settings.providerConfig.gdrive?.folderSelected === true;
		}
		return true;
	}

	startAutoSync(): void {
		this.stopAutoSync();
		if (!this.canAutoSync()) {
			return;
		}

		const intervalMs = this.settings.syncIntervalMinutes * 60 * 1000;
		this.autoSyncIntervalId = window.setInterval(() => {
			void this.sync("automatic");
		}, intervalMs);
	}

	stopAutoSync(): void {
		if (this.autoSyncIntervalId !== null) {
			window.clearInterval(this.autoSyncIntervalId);
			this.autoSyncIntervalId = null;
		}
	}

	restartAutoSync(): void {
		this.stopAutoSync();
		this.startAutoSync();
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
				this.notifyVisualRefresh();
			}
			return;
		}

		if (providerId === "gdrive") {
			const gdrive = this.settings.providerConfig.gdrive;
			if (gdrive?.folderSelected !== true) {
				if (trigger === "manual") {
					this.emit({
						type: "sync-error",
						status: "error",
						message:
							"Selecciona una carpeta de Google Drive antes de sincronizar.",
						timestamp: new Date().toISOString(),
						trigger,
					});
					this.notifyVisualRefresh();
				}
				return;
			}
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
			this.notifyVisualRefresh();
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
			this.notifyVisualRefresh();
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
			this.notifyVisualRefresh();
		}
	}

	private async syncGoogleDrive(
		provider: GoogleDriveLazyProvider,
	): Promise<SyncResult> {
		const folder = await provider.getOrCreateTargetFolder();
		const remoteFilesByFolder = new Map<string, Map<string, string>>();
		const mdFiles = this.app.vault.getMarkdownFiles();
		let uploadedCount = 0;
		const syncedFileMtimes: Record<string, number> = {};
		const syncedContentHashes: Record<string, string> = {};

		for (const file of mdFiles) {
			const pathParts = file.path.split("/");
			const fileName = pathParts.pop() ?? file.path;
			const relativeDir = pathParts.join("/");

			const parentFolderId = relativeDir
				? await provider.resolveOrCreateFolderPath(
						folder.folderId,
						relativeDir,
					)
				: folder.folderId;

			let remoteInFolder = remoteFilesByFolder.get(parentFolderId);
			if (!remoteInFolder) {
				const remoteFiles = await provider.listFiles(parentFolderId);
				remoteInFolder = new Map(remoteFiles.map((f) => [f.name, f.id]));
				remoteFilesByFolder.set(parentFolderId, remoteInFolder);
			}

			const content = await this.app.vault.read(file);
			const existingFileId = remoteInFolder.get(fileName);

			await provider.uploadFile(
				fileName,
				content,
				parentFolderId,
				existingFileId,
			);

			if (!existingFileId) {
				remoteInFolder.set(fileName, "pending");
			}

			syncedFileMtimes[file.path] = file.stat.mtime;
			syncedContentHashes[file.path] = this.hashContent(content);
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
				syncedContentHashes,
			};
		}

		return {
			message: "¡Sincronización completada exitosamente!",
			downloadedCount: 0,
			uploadedCount,
			noChanges: uploadedCount === 0,
		};
	}

	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = (hash * 33) ^ content.charCodeAt(i);
		}
		return (hash >>> 0).toString(16);
	}

	private notifyVisualRefresh(): void {
		this.app.workspace.trigger("layout-change");
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
