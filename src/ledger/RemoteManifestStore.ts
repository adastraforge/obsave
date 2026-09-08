import type { App } from "obsidian";
import type { CloudProviderId, ObSaveSettings } from "../settings";
import type { GitHubProvider } from "../providers/GitHubProvider";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";
import type { IStorageProvider } from "../providers/IStorageProvider";
import { GitHubApiClient } from "../oauth/GitHubProvider";
import { hashManifest } from "./manifestHash";
import {
	type LedgerManifest,
	REMOTE_LEDGER_PATH,
	LEDGER_MANIFEST_VERSION,
} from "./types";

export interface RemoteLedgerSnapshot {
	manifest: LedgerManifest | null;
	hash: string | null;
	remoteId?: string;
}

const LEDGER_FILE_NAME = "ledger.json";
const OBSAVE_FOLDER = ".obsave";

export class RemoteManifestStore {
	constructor(
		private app: App,
		private settings: ObSaveSettings,
		private providers: Map<CloudProviderId, IStorageProvider>,
	) {}

	updateSettings(settings: ObSaveSettings): void {
		this.settings = settings;
	}

	async fetchRemoteLedger(): Promise<RemoteLedgerSnapshot> {
		const providerId = this.settings.activeProvider;
		if (providerId === "gdrive") {
			return this.fetchGoogleDriveLedger();
		}
		if (providerId === "github") {
			return this.fetchGitHubLedger();
		}
		return { manifest: null, hash: null };
	}

	async uploadRemoteLedger(
		manifest: LedgerManifest,
		remoteId?: string,
	): Promise<string> {
		const providerId = this.settings.activeProvider;
		const payload = JSON.stringify(manifest, null, 2);

		if (providerId === "gdrive") {
			const provider = this.getGoogleDrive();
			const root = await provider.getOrCreateTargetFolder();
			const obsaveFolderId = await provider.resolveOrCreateFolderPath(
				root.folderId,
				OBSAVE_FOLDER,
			);
			const fileId = await provider.uploadFile(
				LEDGER_FILE_NAME,
				payload,
				obsaveFolderId,
				remoteId,
			);
			return fileId;
		}

		if (providerId === "github") {
			const provider = this.getGitHub();
			return provider.uploadRemoteFile(REMOTE_LEDGER_PATH, payload, remoteId);
		}

		throw new Error("Proveedor no soportado para manifiesto remoto.");
	}

	async clearRemoteStorage(): Promise<void> {
		const providerId = this.settings.activeProvider;
		if (providerId === "gdrive") {
			await this.clearGoogleDriveStorage();
			return;
		}
		if (providerId === "github") {
			await this.clearGitHubStorage();
		}
	}

	private async fetchGoogleDriveLedger(): Promise<RemoteLedgerSnapshot> {
		const provider = this.getGoogleDrive();
		const root = await provider.getOrCreateTargetFolder();
		const obsaveFolderId = await provider.resolveOrCreateFolderPath(
			root.folderId,
			OBSAVE_FOLDER,
		);
		const files = await provider.listFiles(obsaveFolderId);
		const ledgerFile = files.find((file) => file.name === LEDGER_FILE_NAME);
		if (!ledgerFile) {
			return { manifest: null, hash: null };
		}

		const content = await provider.downloadFile(ledgerFile.id);
		if (!content.trim()) {
			return { manifest: null, hash: null, remoteId: ledgerFile.id };
		}

		const manifest = this.parseManifest(content);
		if (!manifest) {
			return { manifest: null, hash: null, remoteId: ledgerFile.id };
		}

		return {
			manifest,
			hash: hashManifest(manifest),
			remoteId: ledgerFile.id,
		};
	}

	private async fetchGitHubLedger(): Promise<RemoteLedgerSnapshot> {
		const provider = this.getGitHub();
		const exists = await provider.confirmRemotePathDeleted(REMOTE_LEDGER_PATH);
		if (exists) {
			return { manifest: null, hash: null };
		}

		const content = await provider.downloadRemoteFile(REMOTE_LEDGER_PATH);
		if (!content.trim()) {
			return { manifest: null, hash: null };
		}

		const manifest = this.parseManifest(content);
		if (!manifest) {
			return { manifest: null, hash: null };
		}

		const client = provider.getApiClient();
		const sha = await this.resolveGitHubFileSha(client, REMOTE_LEDGER_PATH);
		return {
			manifest,
			hash: hashManifest(manifest),
			remoteId: sha,
		};
	}

	private parseManifest(content: string): LedgerManifest | null {
		try {
			const parsed = JSON.parse(content) as LedgerManifest;
			if (parsed.version !== LEDGER_MANIFEST_VERSION || !parsed.entries) {
				return null;
			}
			return parsed;
		} catch {
			return null;
		}
	}

	private async clearGoogleDriveStorage(): Promise<void> {
		const provider = this.getGoogleDrive();
		const root = await provider.getOrCreateTargetFolder();
		await this.deleteGoogleDriveFolderContents(provider, root.folderId);
	}

	private async deleteGoogleDriveFolderContents(
		provider: GoogleDriveLazyProvider,
		folderId: string,
	): Promise<void> {
		const files = await provider.listFiles(folderId);
		for (const file of files) {
			await provider.deleteFile(file.id);
		}

		const subfolders = await provider.listFoldersInParent(folderId);
		for (const subfolder of subfolders) {
			await this.deleteGoogleDriveFolderContents(provider, subfolder.id);
			await provider.deleteFile(subfolder.id);
		}
	}

	private async clearGitHubStorage(): Promise<void> {
		const provider = this.getGitHub();
		const client = provider.getApiClient();
		const paths = await client.listAllRemoteFiles();
		const sorted = [...paths].sort(
			(a, b) => b.path.length - a.path.length,
		);

		for (const entry of sorted) {
			if (
				entry.path.startsWith(".obsidian/") ||
				entry.path.startsWith(".git/")
			) {
				continue;
			}
			await client.deleteFile(entry.path, entry.sha);
		}
	}

	private async resolveGitHubFileSha(
		client: GitHubApiClient,
		path: string,
	): Promise<string | undefined> {
		try {
			const content = await client.getFileMeta(path);
			return content.sha;
		} catch {
			return undefined;
		}
	}

	private getGoogleDrive(): GoogleDriveLazyProvider {
		const provider = this.providers.get("gdrive");
		if (!provider) {
			throw new Error("Google Drive no registrado.");
		}
		return provider as GoogleDriveLazyProvider;
	}

	private getGitHub(): GitHubProvider {
		const provider = this.providers.get("github");
		if (!provider) {
			throw new Error("GitHub no registrado.");
		}
		return provider as GitHubProvider;
	}
}
