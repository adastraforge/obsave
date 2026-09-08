import { TFile, TFolder, type App } from "obsidian";
import {
	isProviderConfigured,
	type CloudProviderId,
	type ObSaveSettings,
} from "../settings";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";
import type { GitHubProvider } from "../providers/GitHubProvider";
import type { IStorageProvider, SyncResult } from "../providers/IStorageProvider";
import type {
	SyncEngineEvent,
	SyncRunResult,
	SyncStatus,
	SyncTrigger,
} from "../types";
import { hashContent } from "../utils/contentHash";
import { LedgerManager } from "../ledger/LedgerManager";
import { hashManifest } from "../ledger/manifestHash";
import { RemoteManifestStore } from "../ledger/RemoteManifestStore";
import type { LedgerEntry, LedgerManifest } from "../ledger/types";
import {
	syncTemplateFoldersToGitHub,
	syncTemplateFoldersToGoogleDrive,
} from "../productivity/vaultFolderSync";

type SyncEngineListener = (event: SyncEngineEvent) => void;

const GITKEEP = "";

/**
 * Motor de sincronización v1.1 — manifiesto centralizado `.obsave/ledger.json`.
 */
export class SyncEngine {
	private status: SyncStatus = "idle";
	private listeners: SyncEngineListener[] = [];
	private autoSyncIntervalId: number | null = null;
	private syncInFlight: Promise<void> | null = null;
	private syncGeneration = 0;
	private pendingAutoSync = false;
	private remoteStore: RemoteManifestStore;
	private remoteLedgerId: string | undefined;

	constructor(
		private app: App,
		private settings: ObSaveSettings,
		private providers: Map<CloudProviderId, IStorageProvider>,
		private ledgerManager: LedgerManager,
	) {
		this.remoteStore = new RemoteManifestStore(app, settings, providers);
	}

	on(listener: SyncEngineListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	getStatus(): SyncStatus {
		return this.status;
	}

	getLedgerManager(): LedgerManager {
		return this.ledgerManager;
	}

	requestStructureSync(): void {
		this.settings.structureSyncNeeded = true;
	}

	async syncTemplateFoldersToCloud(): Promise<void> {
		const providerId = this.settings.activeProvider;
		if (!providerId) {
			return;
		}

		if (providerId === "gdrive" && this.isGoogleDriveFolderReady()) {
			const provider = this.providers.get("gdrive") as
				| GoogleDriveLazyProvider
				| undefined;
			if (provider) {
				await syncTemplateFoldersToGoogleDrive(provider);
			}
			return;
		}

		if (providerId === "github") {
			const gh = this.settings.providerConfig.github;
			if (!gh?.token || !gh.remoteUrl) {
				return;
			}
			const provider = this.providers.get("github") as GitHubProvider | undefined;
			if (provider) {
				await syncTemplateFoldersToGitHub(this.app, provider);
			}
		}
	}

	updateSettings(settings: ObSaveSettings): void {
		this.settings = settings;
		this.remoteStore.updateSettings(settings);
	}

	isConnected(): boolean {
		return isProviderConfigured(this.settings);
	}

	isGoogleDriveFolderReady(): boolean {
		const gdrive = this.settings.providerConfig.gdrive;
		return gdrive?.folderSelected === true && !!gdrive?.folderId;
	}

	canAutoSync(): boolean {
		if (!this.settings.autoSyncEnabled) {
			return false;
		}
		if (!this.isConnected()) {
			return false;
		}
		if (this.settings.activeProvider === "gdrive") {
			return this.isGoogleDriveFolderReady();
		}
		if (this.settings.activeProvider === "github") {
			const gh = this.settings.providerConfig.github;
			return !!gh?.token && !!gh?.remoteUrl;
		}
		return true;
	}

	cancelActiveSync(): void {
		this.syncGeneration++;
	}

	startAutoSync(): void {
		this.stopAutoSync();
		if (!this.canAutoSync()) {
			return;
		}

		const intervalMs = this.settings.syncIntervalSeconds * 1000;
		this.autoSyncIntervalId = window.setInterval(() => {
			void this.executeUnifiedSync("automatic");
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

	async executeUnifiedSync(trigger: SyncTrigger): Promise<SyncRunResult> {
		if (this.syncInFlight) {
			if (trigger === "automatic") {
				this.pendingAutoSync = true;
				return { ran: false, skippedReason: "already-syncing" };
			}
			this.emit({
				type: "sync-skipped",
				status: this.status,
				message: "ObSave: Sincronización ya en curso.",
				timestamp: new Date().toISOString(),
				trigger,
				skippedReason: "already-syncing",
			});
			return { ran: false, skippedReason: "already-syncing" };
		}

		const preflight = this.validateSyncPreflight(trigger);
		if (preflight) {
			return preflight;
		}

		let lastResult: SyncRunResult = { ran: true };

		do {
			this.pendingAutoSync = false;
			lastResult = await this.runOneSyncCycle(trigger);
			trigger = "automatic";
		} while (this.pendingAutoSync);

		return lastResult;
	}

	/** Escanea bóveda local, limpia remoto y reconstruye desde cero. */
	async repairRemoteVault(): Promise<void> {
		await this.ledgerManager.rebuildFromLocalVault();
		await this.remoteStore.clearRemoteStorage();
		this.remoteLedgerId = undefined;
		await this.executeUnifiedSync("manual");
	}

	private async runOneSyncCycle(trigger: SyncTrigger): Promise<SyncRunResult> {
		const generation = this.syncGeneration;
		this.syncInFlight = this.runSyncCycle(trigger, generation).finally(() => {
			this.syncInFlight = null;
		});

		await this.syncInFlight;
		return { ran: true };
	}

	private validateSyncPreflight(trigger: SyncTrigger): SyncRunResult | null {
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
			return { ran: false, skippedReason: "not-configured" };
		}

		if (providerId === "gdrive" && !this.isGoogleDriveFolderReady()) {
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
			return { ran: false, skippedReason: "gdrive-no-folder" };
		}

		if (providerId === "github" && !this.settings.providerConfig.github?.remoteUrl) {
			if (trigger === "manual") {
				this.emit({
					type: "sync-error",
					status: "error",
					message: "Configura un repositorio de GitHub antes de sincronizar.",
					timestamp: new Date().toISOString(),
					trigger,
				});
				this.notifyVisualRefresh();
			}
			return { ran: false, skippedReason: "not-configured" };
		}

		if (!this.providers.get(providerId)) {
			this.emit({
				type: "sync-error",
				status: "error",
				message: `Proveedor "${providerId}" no registrado.`,
				timestamp: new Date().toISOString(),
				trigger,
			});
			this.notifyVisualRefresh();
			return { ran: false, skippedReason: "not-configured" };
		}

		return null;
	}

	private async runSyncCycle(
		trigger: SyncTrigger,
		generation: number,
	): Promise<void> {
		this.setStatus("syncing");

		try {
			const result = await this.runLedgerSync();

			if (generation !== this.syncGeneration) {
				this.setStatus("idle");
				this.emit({
					type: "sync-skipped",
					status: "idle",
					message: "Sync cancelada por desconexión.",
					timestamp: new Date().toISOString(),
					trigger,
					skippedReason: "cancelled",
				});
				return;
			}

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
			if (generation !== this.syncGeneration) {
				this.setStatus("idle");
				return;
			}

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

	private async runLedgerSync(): Promise<SyncResult> {
		if (this.settings.structureSyncNeeded) {
			await this.syncTemplateFoldersToCloud();
			this.settings.structureSyncNeeded = false;
		}

		if (!this.ledgerManager.isLoaded()) {
			await this.ledgerManager.load();
		}

		const localManifest = this.ledgerManager.getManifest();
		const localHash = hashManifest(localManifest);
		const remoteSnapshot = await this.remoteStore.fetchRemoteLedger();

		if (
			remoteSnapshot.hash === localHash &&
			!this.ledgerManager.hasPendingChanges()
		) {
			return {
				message: "ObSave: Bóveda al día (sin cambios)",
				noChanges: true,
				downloadedCount: 0,
				uploadedCount: 0,
			};
		}

		let downloadedCount = 0;
		let uploadedCount = 0;

		if (remoteSnapshot.manifest) {
			const pulled = await this.applyRemoteManifestChanges(
				remoteSnapshot.manifest,
			);
			downloadedCount += pulled;
		}

		const pushed = await this.pushLocalPendingChanges();
		uploadedCount += pushed;

		await this.ledgerManager.save();

		const finalManifest = this.ledgerManager.getManifest();
		this.remoteLedgerId = await this.remoteStore.uploadRemoteLedger(
			finalManifest,
			this.remoteLedgerId ?? remoteSnapshot.remoteId,
		);

		if (this.settings.activeProvider === "gdrive") {
			await this.persistGoogleDriveFolderInfo();
		}

		const noChanges = downloadedCount === 0 && uploadedCount === 0;
		return {
			message: noChanges
				? "ObSave: Bóveda al día (sin cambios)"
				: "¡Sincronización completada exitosamente!",
			downloadedCount,
			uploadedCount,
			noChanges,
		};
	}

	private async applyRemoteManifestChanges(
		remote: LedgerManifest,
	): Promise<number> {
		let downloaded = 0;

		for (const [path, remoteEntry] of Object.entries(remote.entries)) {
			const localEntry = this.ledgerManager.getEntry(path);
			if (
				localEntry &&
				(localEntry.status === "C" ||
					localEntry.status === "U" ||
					localEntry.status === "D")
			) {
				continue;
			}

			if (remoteEntry.status === "D") {
				await this.deleteLocalPath(path, remoteEntry);
				this.ledgerManager.removeEntry(path);
				this.removeDescendantEntries(path);
				continue;
			}

			if (remoteEntry.status === "C" || remoteEntry.status === "U") {
				if (remoteEntry.type === "folder") {
					await this.ensureLocalFolder(path);
					this.ledgerManager.markSynchronized(path, {
						type: "folder",
						remoteId: remoteEntry.remoteId,
					});
				} else {
					const pulled = await this.pullRemoteFile(path, remoteEntry);
					if (pulled) {
						downloaded++;
					}
				}
				continue;
			}

			if (remoteEntry.status === "S") {
				this.ledgerManager.markSynchronized(path, remoteEntry);
			}
		}

		return downloaded;
	}

	private async pushLocalPendingChanges(): Promise<number> {
		let uploaded = 0;
		const pending = [...this.ledgerManager.pendingPaths()].sort(
			(a, b) => a.length - b.length,
		);

		for (const path of pending) {
			const entry = this.ledgerManager.getEntry(path);
			if (!entry) {
				continue;
			}

			if (entry.status === "D") {
				await this.deleteRemotePath(path, entry);
				this.ledgerManager.removeEntry(path);
				this.removeDescendantEntries(path);
				continue;
			}

			if (entry.type === "folder") {
				const remoteId = await this.pushRemoteFolder(path, entry);
				if (remoteId) {
					this.ledgerManager.markSynchronized(path, {
						type: "folder",
						remoteId,
					});
					uploaded++;
				}
				continue;
			}

			const pushed = await this.pushRemoteFile(path, entry);
			if (pushed) {
				uploaded++;
			}
		}

		return uploaded;
	}

	private async pullRemoteFile(
		path: string,
		entry: LedgerEntry,
	): Promise<boolean> {
		const providerId = this.settings.activeProvider!;

		if (providerId === "gdrive") {
			const provider = this.providers.get("gdrive") as GoogleDriveLazyProvider;
			const remoteId = entry.remoteId;
			if (!remoteId) {
				return false;
			}
			const content = await provider.downloadFile(remoteId);
			await this.ensureLocalFolder(this.parentPath(path));
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				await this.app.vault.create(path, content);
			}
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				this.ledgerManager.markSynchronized(path, {
					type: "file",
					remoteId,
					hash: hashContent(content),
					mtime: file.stat.mtime,
					size: file.stat.size,
				});
			}
			return true;
		}

		if (providerId === "github") {
			const provider = this.providers.get("github") as GitHubProvider;
			const content = await provider.downloadRemoteFile(path);
			await this.ensureLocalFolder(this.parentPath(path));
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
			} else {
				await this.app.vault.create(path, content);
			}
			const meta = await provider.getApiClient().getFileMeta(path);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				this.ledgerManager.markSynchronized(path, {
					type: "file",
					remoteId: meta.sha,
					hash: hashContent(content),
					mtime: file.stat.mtime,
					size: file.stat.size,
				});
			}
			return true;
		}

		return false;
	}

	private async pushRemoteFile(
		path: string,
		entry: LedgerEntry,
	): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			this.ledgerManager.removeEntry(path);
			return false;
		}

		const content = await this.app.vault.read(file);
		const hash = hashContent(content);
		const providerId = this.settings.activeProvider!;

		if (providerId === "gdrive") {
			const provider = this.providers.get("gdrive") as GoogleDriveLazyProvider;
			const root = await provider.getOrCreateTargetFolder();
			const pathParts = path.split("/");
			const fileName = pathParts.pop() ?? path;
			const relativeDir = pathParts.join("/");
			const parentId = relativeDir
				? await provider.resolveOrCreateFolderPath(root.folderId, relativeDir)
				: root.folderId;

			const remoteId = await provider.uploadFile(
				fileName,
				content,
				parentId,
				entry.remoteId,
			);

			this.ledgerManager.markSynchronized(path, {
				type: "file",
				remoteId,
				hash,
				mtime: file.stat.mtime,
				size: file.stat.size,
			});
			return true;
		}

		if (providerId === "github") {
			const provider = this.providers.get("github") as GitHubProvider;
			const sha = await provider.uploadRemoteFile(
				path,
				content,
				entry.remoteId,
			);
			this.ledgerManager.markSynchronized(path, {
				type: "file",
				remoteId: sha,
				hash,
				mtime: file.stat.mtime,
				size: file.stat.size,
			});
			return true;
		}

		return false;
	}

	private async pushRemoteFolder(
		path: string,
		entry: LedgerEntry,
	): Promise<string | undefined> {
		const providerId = this.settings.activeProvider!;

		if (providerId === "gdrive") {
			const provider = this.providers.get("gdrive") as GoogleDriveLazyProvider;
			const root = await provider.getOrCreateTargetFolder();
			const folderId = await provider.resolveOrCreateFolderPath(
				root.folderId,
				path,
			);
			return folderId;
		}

		if (providerId === "github") {
			const folder = this.app.vault.getAbstractFileByPath(path);
			if (folder instanceof TFolder && folder.children.length === 0) {
				const gitkeepPath = `${path}/.gitkeep`;
				const provider = this.providers.get("github") as GitHubProvider;
				const existing = this.ledgerManager.getEntry(gitkeepPath);
				const sha = await provider.uploadRemoteFile(
					gitkeepPath,
					GITKEEP,
					existing?.remoteId,
				);
				return sha || path;
			}
			return entry.remoteId ?? path;
		}

		return undefined;
	}

	private async deleteLocalPath(path: string, entry: LedgerEntry): Promise<void> {
		const node = this.app.vault.getAbstractFileByPath(path);
		if (!node) {
			return;
		}

		if (entry.type === "folder" && node instanceof TFolder) {
			await this.app.vault.trash(node, true);
			return;
		}

		if (node instanceof TFile) {
			await this.app.vault.trash(node, true);
		}
	}

	private async deleteRemotePath(path: string, entry: LedgerEntry): Promise<void> {
		const providerId = this.settings.activeProvider!;

		if (entry.type === "folder") {
			await this.deleteRemoteFolderRecursive(path);
			return;
		}

		if (providerId === "gdrive") {
			const remoteId = entry.remoteId;
			if (!remoteId) {
				return;
			}
			const provider = this.providers.get("gdrive") as GoogleDriveLazyProvider;
			await provider.deleteFile(remoteId);
			return;
		}

		if (providerId === "github") {
			const provider = this.providers.get("github") as GitHubProvider;
			if (entry.remoteId) {
				await provider.deleteRemoteFile(path, entry.remoteId);
			}
		}
	}

	private async deleteRemoteFolderRecursive(folderPath: string): Promise<void> {
		const prefix = `${folderPath}/`;
		const providerId = this.settings.activeProvider!;

		const childPaths = Object.keys(this.ledgerManager.getEntries())
			.filter((key) => key.startsWith(prefix))
			.sort((a, b) => b.length - a.length);

		for (const childPath of childPaths) {
			const child = this.ledgerManager.getEntry(childPath);
			if (!child || child.status !== "D") {
				continue;
			}
			await this.deleteRemotePath(childPath, child);
		}

		const entry = this.ledgerManager.getEntry(folderPath);
		if (!entry) {
			return;
		}

		if (providerId === "gdrive" && entry.remoteId) {
			const provider = this.providers.get("gdrive") as GoogleDriveLazyProvider;
			await provider.deleteFile(entry.remoteId);
			return;
		}

		if (providerId === "github") {
			const provider = this.providers.get("github") as GitHubProvider;
			const gitkeepPath = `${folderPath}/.gitkeep`;
			const gitkeepEntry = this.ledgerManager.getEntry(gitkeepPath);
			if (gitkeepEntry?.remoteId) {
				await provider.deleteRemoteFile(gitkeepPath, gitkeepEntry.remoteId);
			}
		}
	}

	private removeDescendantEntries(folderPath: string): void {
		const prefix = `${folderPath}/`;
		for (const key of Object.keys(this.ledgerManager.getEntries())) {
			if (key.startsWith(prefix)) {
				this.ledgerManager.removeEntry(key);
			}
		}
	}

	private async ensureLocalFolder(dirPath: string): Promise<void> {
		if (!dirPath) {
			return;
		}
		const segments = dirPath.split("/").filter(Boolean);
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
				this.ledgerManager.trackFolder(current);
			}
		}
	}

	private parentPath(path: string): string {
		const idx = path.lastIndexOf("/");
		return idx >= 0 ? path.slice(0, idx) : "";
	}

	private async persistGoogleDriveFolderInfo(): Promise<void> {
		const provider = this.providers.get("gdrive") as GoogleDriveLazyProvider;
		const folder = await provider.getOrCreateTargetFolder();
		const gdrive = this.settings.providerConfig.gdrive;
		if (!gdrive) {
			return;
		}

		const preserveUserFolder =
			gdrive.folderMode === "existing" &&
			!!gdrive.folderId &&
			gdrive.folderId === folder.folderId;

		this.settings.providerConfig.gdrive = {
			...gdrive,
			folderId: folder.folderId,
			folderPath: preserveUserFolder
				? (gdrive.folderPath ?? folder.folderPath)
				: folder.folderPath,
			folderName: preserveUserFolder
				? (gdrive.folderName ?? folder.folderName)
				: folder.folderName,
			folderSelected: true,
			folderMode: preserveUserFolder ? "existing" : gdrive.folderMode,
		};
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
