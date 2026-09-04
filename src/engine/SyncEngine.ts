import { TFile, type App } from "obsidian";
import {
	isProviderConfigured,
	type CloudProviderId,
	type ObSaveSettings,
	type SyncLedgerEntry,
} from "../settings";
import type { GoogleDriveRemoteMarkdown } from "../providers/GoogleDriveProvider";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";
import type { IStorageProvider, SyncResult } from "../providers/IStorageProvider";
import type { SyncEngineEvent, SyncStatus, SyncTrigger } from "../types";
import { hashContent } from "../utils/contentHash";

type SyncEngineListener = (event: SyncEngineEvent) => void;

/**
 * Motor de sincronización — delega al proveedor de nube activo (único).
 * Google Drive: sync bidireccional con Sync Ledger y eliminación en ambos lados.
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
			const result = await this.runProviderSync(providerId, provider);

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

	/** Dispara sincronización manual inmediata (ribbon, comandos). */
	async executeSync(): Promise<void> {
		await this.sync("manual");
	}

	private async runProviderSync(
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

		const ledger: Record<string, SyncLedgerEntry> = {
			...this.settings.syncedLedger,
		};

		const allPaths = new Set<string>([
			...localByPath.keys(),
			...remoteByPath.keys(),
			...Object.keys(ledger),
		]);

		let downloadedCount = 0;
		let uploadedCount = 0;
		let deletedCount = 0;

		for (const path of allPaths) {
			const inLocal = localByPath.has(path);
			const inRemote = remoteByPath.has(path);
			const ledgerEntry = ledger[path];
			const inLedger = ledgerEntry != null;

			if (!inLocal && inRemote && inLedger) {
				const remote = remoteByPath.get(path)!;
				const fileId = ledgerEntry.driveFileId ?? remote.id;
				await provider.deleteFile(fileId);
				delete ledger[path];
				deletedCount++;
				continue;
			}

			if (!inLocal && inRemote && !inLedger) {
				await this.pullRemoteFile(provider, remoteByPath.get(path)!);
				const pulled = this.app.vault.getAbstractFileByPath(path);
				if (pulled instanceof TFile) {
					const content = await this.app.vault.read(pulled);
					ledger[path] = this.buildLedgerEntry(
						content,
						pulled.stat.mtime,
						remoteByPath.get(path)!.id,
					);
				}
				downloadedCount++;
				continue;
			}

			if (inLocal && !inRemote && inLedger) {
				const localFile = localByPath.get(path)!;
				await this.app.vault.trash(localFile, true);
				delete ledger[path];
				deletedCount++;
				continue;
			}

			if (inLocal && !inRemote && !inLedger) {
				const localFile = localByPath.get(path)!;
				const driveFileId = await this.pushLocalFile(
					provider,
					folder.folderId,
					path,
					localFile,
				);
				const content = await this.app.vault.read(localFile);
				ledger[path] = this.buildLedgerEntry(
					content,
					localFile.stat.mtime,
					driveFileId,
				);
				uploadedCount++;
				continue;
			}

			if (inLocal && inRemote) {
				const changed = await this.syncBothPresent(
					provider,
					folder.folderId,
					path,
					localByPath.get(path)!,
					remoteByPath.get(path)!,
					ledgerEntry,
				);

				if (changed.action === "pull") {
					downloadedCount++;
				} else if (changed.action === "push") {
					uploadedCount++;
				}

				ledger[path] = changed.entry;
			}
		}

		this.settings.syncedLedger = ledger;

		const gdrive = this.settings.providerConfig.gdrive;
		if (gdrive) {
			this.settings.providerConfig.gdrive = {
				...gdrive,
				folderId: folder.folderId,
				folderPath: folder.folderPath,
				folderName: folder.folderName,
				folderSelected: true,
			};
		}

		const noChanges =
			downloadedCount === 0 && uploadedCount === 0 && deletedCount === 0;
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

	private async syncBothPresent(
		provider: GoogleDriveLazyProvider,
		rootFolderId: string,
		path: string,
		localFile: TFile,
		remote: GoogleDriveRemoteMarkdown,
		ledgerEntry: SyncLedgerEntry | undefined,
	): Promise<{ action: "none" | "pull" | "push"; entry: SyncLedgerEntry }> {
		const localContent = await this.app.vault.read(localFile);
		const localHash = hashContent(localContent);
		const localMtime = localFile.stat.mtime;
		const remoteMtime = remote.modifiedTimeMs;

		if (ledgerEntry) {
			const localMatchesLedger =
				localHash === ledgerEntry.hash && localMtime === ledgerEntry.mtime;
			const remoteMatchesLedger =
				remote.id === ledgerEntry.driveFileId &&
				remoteMtime <= ledgerEntry.mtime;

			if (localMatchesLedger && remoteMatchesLedger) {
				return {
					action: "none",
					entry: {
						hash: localHash,
						mtime: localMtime,
						driveFileId: remote.id,
					},
				};
			}
		}

		const pushLocal =
			!ledgerEntry ||
			localMtime > remoteMtime ||
			(localHash !== ledgerEntry.hash && localMtime >= remoteMtime);

		if (pushLocal) {
			await this.pushLocalFile(
				provider,
				rootFolderId,
				path,
				localFile,
				remote.id,
			);
			const refreshed = this.app.vault.getAbstractFileByPath(path);
			const mtime =
				refreshed instanceof TFile ? refreshed.stat.mtime : localMtime;
			return {
				action: "push",
				entry: { hash: localHash, mtime, driveFileId: remote.id },
			};
		}

		await this.pullRemoteFile(provider, remote);
		const pulled = this.app.vault.getAbstractFileByPath(path);
		if (pulled instanceof TFile) {
			const content = await this.app.vault.read(pulled);
			return {
				action: "pull",
				entry: this.buildLedgerEntry(
					content,
					pulled.stat.mtime,
					remote.id,
				),
			};
		}

		return {
			action: "pull",
			entry: this.buildLedgerEntry(localContent, localMtime, remote.id),
		};
	}

	private async pullRemoteFile(
		provider: GoogleDriveLazyProvider,
		remote: GoogleDriveRemoteMarkdown,
	): Promise<void> {
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
	}

	private async pushLocalFile(
		provider: GoogleDriveLazyProvider,
		rootFolderId: string,
		vaultPath: string,
		localFile: TFile,
		existingFileId?: string,
	): Promise<string> {
		const pathParts = vaultPath.split("/");
		const fileName = pathParts.pop() ?? vaultPath;
		const relativeDir = pathParts.join("/");

		const parentFolderId = relativeDir
			? await provider.resolveOrCreateFolderPath(rootFolderId, relativeDir)
			: rootFolderId;

		const content = await this.app.vault.read(localFile);
		await provider.uploadFile(
			fileName,
			content,
			parentFolderId,
			existingFileId,
		);

		if (existingFileId) {
			return existingFileId;
		}

		const remoteFiles = await provider.listFiles(parentFolderId);
		const created = remoteFiles.find((file) => file.name === fileName);
		return created?.id ?? existingFileId ?? "";
	}

	private buildLedgerEntry(
		content: string,
		mtime: number,
		driveFileId?: string,
	): SyncLedgerEntry {
		return {
			hash: hashContent(content),
			mtime,
			driveFileId: driveFileId || undefined,
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
