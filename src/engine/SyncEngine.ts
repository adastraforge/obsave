import { TFile, type App } from "obsidian";
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
 * Google Drive: sync bidireccional con jerarquía de subcarpetas preservada.
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

		const intervalMs = this.settings.syncIntervalSeconds * 1000;
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
			const result = await this.executeSync(providerId, provider);

			this.settings.lastSyncAt = new Date().toISOString();
			this.setStatus("idle");
			this.emit({
				type: "sync-complete",
				status: "idle",
				message: result.message,
				timestamp: this.settings.lastSyncAt,
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

	private async executeSync(
		providerId: CloudProviderId,
		provider: IStorageProvider,
	): Promise<SyncResult> {
		if (providerId === "gdrive") {
			return this.executeSyncGoogleDrive(provider as GoogleDriveLazyProvider);
		}
		return provider.sync();
	}

	private async executeSyncGoogleDrive(
		provider: GoogleDriveLazyProvider,
	): Promise<SyncResult> {
		const folder = await provider.getOrCreateTargetFolder();
		const remoteFiles = await provider.listAllMarkdownFiles(folder.folderId);
		const remoteByPath = new Map(
			remoteFiles.map((file) => [file.relativePath, file]),
		);

		const localFiles = this.app.vault.getMarkdownFiles();
		const localByPath = new Map(localFiles.map((file) => [file.path, file]));

		let downloadedCount = 0;
		let uploadedCount = 0;
		const pulledPaths = new Set<string>();

		for (const remote of remoteFiles) {
			const local = localByPath.get(remote.relativePath);
			const shouldPull =
				!local || remote.modifiedTimeMs > local.stat.mtime;

			if (!shouldPull) {
				continue;
			}

			const content = await provider.downloadFile(remote.id);
			const dirPath = remote.relativePath.includes("/")
				? remote.relativePath.slice(0, remote.relativePath.lastIndexOf("/"))
				: "";

			await this.ensureLocalFolderPath(dirPath);

			const existing = this.app.vault.getAbstractFileByPath(remote.relativePath);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				await this.app.vault.create(remote.relativePath, content);
			}

			pulledPaths.add(remote.relativePath);
			downloadedCount++;
		}

		const localAfterPull = this.app.vault.getMarkdownFiles();
		const syncedFileMtimes: Record<string, number> = {};
		const syncedContentHashes: Record<string, string> = {};

		for (const file of localAfterPull) {
			const remote = remoteByPath.get(file.path);

			if (!pulledPaths.has(file.path)) {
				const shouldPush =
					!remote || file.stat.mtime > remote.modifiedTimeMs;

				if (shouldPush) {
					const pathParts = file.path.split("/");
					const fileName = pathParts.pop() ?? file.path;
					const relativeDir = pathParts.join("/");

					const parentFolderId = relativeDir
						? await provider.resolveOrCreateFolderPath(
								folder.folderId,
								relativeDir,
							)
						: folder.folderId;

					const content = await this.app.vault.read(file);
					await provider.uploadFile(
						fileName,
						content,
						parentFolderId,
						remote?.id,
					);
					uploadedCount++;
				}
			}

			const content = await this.app.vault.read(file);
			syncedFileMtimes[file.path] = file.stat.mtime;
			syncedContentHashes[file.path] = this.hashContent(content);
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

		const noChanges = downloadedCount === 0 && uploadedCount === 0;
		const message = noChanges
			? "ObSave: Bóveda al día (sin cambios)"
			: "¡Sincronización completada exitosamente!";

		return {
			message,
			downloadedCount,
			uploadedCount,
			noChanges,
		};
	}

	private async ensureLocalFolderPath(dirPath: string): Promise<void> {
		if (!dirPath) {
			return;
		}

		const segments = dirPath.split("/").filter(Boolean);
		let current = "";

		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
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
