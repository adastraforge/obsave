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
	TemplateFolderSyncOutcome,
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

	/**
	 * Materializa la estructura plantilla en la nube. Las carpetas quedan en `C`
	 * con su `remoteId` conocido: el estado `S` solo lo concede un ciclo completo,
	 * que es el único que publica `.obsave/ledger.json` en el remoto.
	 */
	async syncTemplateFoldersToCloud(): Promise<TemplateFolderSyncOutcome> {
		const providerId = this.settings.activeProvider;
		if (!providerId) {
			return { pendingPublication: false };
		}

		if (providerId === "gdrive" && this.isGoogleDriveFolderReady()) {
			const provider = this.providers.get("gdrive") as
				| GoogleDriveLazyProvider
				| undefined;
			if (!provider) {
				return { pendingPublication: false };
			}
			await syncTemplateFoldersToGoogleDrive(provider, (path, remoteId) =>
				this.registerRemoteFolder(path, remoteId),
			);
			await this.ledgerManager.save();
			return { pendingPublication: this.ledgerManager.hasPendingChanges() };
		}

		if (providerId === "github") {
			const gh = this.settings.providerConfig.github;
			if (!gh?.token || !gh.remoteUrl) {
				return { pendingPublication: false };
			}
			const provider = this.providers.get("github") as GitHubProvider | undefined;
			if (!provider) {
				return { pendingPublication: false };
			}
			await syncTemplateFoldersToGitHub(
				this.app,
				provider,
				(gitkeepPath, sha) => this.registerRemoteGitkeep(gitkeepPath, sha),
			);
			await this.ledgerManager.save();
			return { pendingPublication: this.ledgerManager.hasPendingChanges() };
		}

		return { pendingPublication: this.ledgerManager.hasPendingChanges() };
	}

	/**
	 * Guarda el id remoto de la carpeta pero la deja pendiente: `S` solo se
	 * concede en un ciclo completo, que es el único que publica el manifiesto.
	 */
	private registerRemoteFolder(vaultPath: string, remoteId: string): void {
		const localFolder = this.app.vault.getAbstractFileByPath(vaultPath);
		if (!(localFolder instanceof TFolder)) {
			return;
		}
		const entry = this.ledgerManager.getEntry(vaultPath);
		if (entry?.previousPath) {
			return;
		}
		this.ledgerManager.attachRemoteId(vaultPath, remoteId, "folder");
	}

	private registerRemoteGitkeep(gitkeepPath: string, sha: string): void {
		this.ledgerManager.attachRemoteId(gitkeepPath, sha, "file");
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
			this.notifyVisualRefresh(true);
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
			this.notifyVisualRefresh(true);
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

			const pulled = await this.reconcileRemoteEntry(path, remoteEntry);
			if (pulled) {
				downloaded++;
			}
		}

		return downloaded;
	}

	/**
	 * Materializa en disco la entrada remota antes de consolidarla como `S`.
	 * Un manifiesto remoto en `S` describe el disco de otro dispositivo, así que
	 * nunca implica presencia local: hay que verificarla o descargarla.
	 */
	private async reconcileRemoteEntry(
		path: string,
		remoteEntry: LedgerEntry,
	): Promise<boolean> {
		if (remoteEntry.type === "folder") {
			await this.ensureLocalFolder(path);
			this.ledgerManager.markSynchronized(path, {
				type: "folder",
				remoteId: remoteEntry.remoteId,
			});
			return false;
		}

		const localFile = this.app.vault.getAbstractFileByPath(path);
		if (!(localFile instanceof TFile)) {
			return this.pullRemoteFile(path, remoteEntry);
		}

		if (remoteEntry.status !== "S") {
			return this.pullRemoteFile(path, remoteEntry);
		}

		const localEntry = this.ledgerManager.getEntry(path);
		if (
			localEntry?.status === "S" &&
			localEntry.hash != null &&
			localEntry.hash === remoteEntry.hash
		) {
			if (!localEntry.remoteId && remoteEntry.remoteId) {
				this.ledgerManager.markSynchronized(path, {
					type: "file",
					remoteId: remoteEntry.remoteId,
				});
			}
			return false;
		}

		const localHash = hashContent(await this.app.vault.read(localFile));
		if (remoteEntry.hash != null && localHash !== remoteEntry.hash) {
			return this.pullRemoteFile(path, remoteEntry);
		}

		this.ledgerManager.markSynchronized(path, {
			type: "file",
			remoteId: remoteEntry.remoteId,
			hash: localHash,
			mtime: localFile.stat.mtime,
			size: localFile.stat.size,
		});
		return false;
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
				console.warn(
					`[ObSave] Entrada remota sin remoteId, imposible descargar: ${path}`,
				);
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
		const hashAtUploadStart = hashContent(content);
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

			return this.finalizeFilePush(path, file, remoteId, hashAtUploadStart);
		}

		if (providerId === "github") {
			const provider = this.providers.get("github") as GitHubProvider;
			let sha: string;

			if (entry.previousPath && entry.remoteId) {
				if (entry.hash === hashAtUploadStart) {
					sha = await provider.moveRemoteFile(
						entry.previousPath,
						path,
						entry.remoteId,
					);
				} else {
					sha = await provider.uploadRemoteFile(path, content);
					await provider.deleteRemoteFile(
						entry.previousPath,
						entry.remoteId,
					);
				}
			} else {
				sha = await provider.uploadRemoteFile(
					path,
					content,
					entry.remoteId,
				);
			}

			return this.finalizeFilePush(path, file, sha, hashAtUploadStart);
		}

		return false;
	}

	/**
	 * Tras subir, re-lee hash/mtime en disco. Si cambió durante la transferencia, deja U y re-encola sync.
	 * `S` solo se escribe con `remoteId` confirmado por el proveedor.
	 */
	private async finalizeFilePush(
		path: string,
		file: TFile,
		remoteId: string,
		hashAtUploadStart: string,
	): Promise<boolean> {
		const contentAfter = await this.app.vault.read(file);
		const hashAfter = hashContent(contentAfter);

		if (!remoteId) {
			this.ledgerManager.markUpdatedWithFingerprint(path, {
				hash: hashAfter,
				mtime: file.stat.mtime,
				size: file.stat.size,
			});
			this.pendingAutoSync = true;
			console.warn(`[ObSave] Subida sin ID remoto confirmado: ${path}`);
			return false;
		}

		if (hashAfter !== hashAtUploadStart) {
			this.ledgerManager.markUpdatedWithFingerprint(path, {
				hash: hashAfter,
				mtime: file.stat.mtime,
				size: file.stat.size,
			});
			if (remoteId) {
				const entry = this.ledgerManager.getEntry(path);
				if (entry) {
					entry.remoteId = remoteId;
				}
			}
			this.pendingAutoSync = true;
			return true;
		}

		const refreshed = this.app.vault.getAbstractFileByPath(path);
		const mtime =
			refreshed instanceof TFile ? refreshed.stat.mtime : file.stat.mtime;
		const size =
			refreshed instanceof TFile ? refreshed.stat.size : file.stat.size;

		this.ledgerManager.markSynchronized(path, {
			type: "file",
			remoteId,
			hash: hashAfter,
			mtime,
			size,
		});
		return true;
	}

	private async pushRemoteFolder(
		path: string,
		entry: LedgerEntry,
	): Promise<string | undefined> {
		const providerId = this.settings.activeProvider!;

		if (providerId === "gdrive") {
			const provider = this.providers.get("gdrive") as GoogleDriveLazyProvider;
			const root = await provider.getOrCreateTargetFolder();
			const pathParts = path.split("/");
			const folderName = pathParts.pop() ?? path;
			const relativeDir = pathParts.join("/");
			const parentId = relativeDir
				? await provider.resolveOrCreateFolderPath(root.folderId, relativeDir)
				: root.folderId;

			if (entry.remoteId && entry.status === "U") {
				await provider.updateDriveFolder(entry.remoteId, {
					name: folderName,
					parentFolderId: parentId,
				});
				return entry.remoteId;
			}

			return provider.resolveOrCreateFolderPath(root.folderId, path);
		}

		if (providerId === "github") {
			const provider = this.providers.get("github") as GitHubProvider;
			const gitkeepPath = `${path}/.gitkeep`;
			const gitkeepEntry = this.ledgerManager.getEntry(gitkeepPath);

			if (gitkeepEntry?.previousPath && gitkeepEntry.remoteId) {
				const newSha = await provider.moveRemoteFile(
					gitkeepEntry.previousPath,
					gitkeepPath,
					gitkeepEntry.remoteId,
				);
				this.ledgerManager.markSynchronized(gitkeepPath, {
					type: "file",
					remoteId: newSha,
					hash: hashContent(GITKEEP),
					mtime: Date.now(),
					size: 0,
				});
				return newSha;
			}

			const folder = this.app.vault.getAbstractFileByPath(path);
			if (folder instanceof TFolder && folder.children.length === 0) {
				const sha = await provider.uploadRemoteFile(
					gitkeepPath,
					GITKEEP,
					gitkeepEntry?.remoteId,
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

	/**
	 * Dispara refresco del explorador. Omitido durante `syncing` para evitar
	 * trabajo redundante; los badges se evalúan O(1) por ruta visible al finalizar.
	 */
	private notifyVisualRefresh(force = false): void {
		if (!force && this.getStatus() === "syncing") {
			return;
		}
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
