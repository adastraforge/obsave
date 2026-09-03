import type { GoogleDriveProviderConfig } from "../settings";
import type { GoogleDriveAuthContext } from "./GoogleDriveProvider";
import type { IStorageProvider, SyncResult } from "./IStorageProvider";

type GoogleDriveProviderClass = typeof import("./GoogleDriveProvider").GoogleDriveProvider;

/**
 * Proxy que carga `GoogleDriveProvider` solo bajo demanda (OAuth / sync).
 * Evita evaluar módulos OAuth/Node durante el load del plugin.
 */
export class GoogleDriveLazyProvider implements IStorageProvider {
	readonly id = "gdrive";
	readonly name = "Google Drive";

	private delegate: InstanceType<GoogleDriveProviderClass> | null = null;
	private pendingConfig: GoogleDriveProviderConfig | null = null;
	private onConfigChanged: ((config: GoogleDriveProviderConfig) => void) | null =
		null;

	setConfigChangeListener(
		listener: ((config: GoogleDriveProviderConfig) => void) | null,
	): void {
		this.onConfigChanged = listener;
		if (this.delegate) {
			this.delegate.setConfigChangeListener(listener);
		}
	}

	setPendingConfig(config: GoogleDriveProviderConfig | null): void {
		this.pendingConfig = config;
	}

	async ensureLoaded(): Promise<InstanceType<GoogleDriveProviderClass>> {
		if (!this.delegate) {
			const { GoogleDriveProvider } = await import("./GoogleDriveProvider");
			this.delegate = new GoogleDriveProvider();
			if (this.onConfigChanged) {
				this.delegate.setConfigChangeListener(this.onConfigChanged);
			}
			if (this.pendingConfig) {
				await this.delegate.connect(this.pendingConfig);
			}
		}
		return this.delegate;
	}

	isLoaded(): boolean {
		return this.delegate !== null;
	}

	async connect(config: GoogleDriveProviderConfig): Promise<boolean> {
		this.pendingConfig = config;
		const delegate = await this.ensureLoaded();
		return delegate.connect(config);
	}

	async sync(): Promise<SyncResult> {
		const delegate = await this.ensureLoaded();
		if (this.pendingConfig) {
			await delegate.connect(this.pendingConfig);
		}
		return delegate.sync();
	}

	async listFolders(): Promise<{ id: string; name: string }[]> {
		const delegate = await this.ensureLoaded();
		if (this.pendingConfig) {
			await delegate.connect(this.pendingConfig);
		}
		return delegate.listFolders();
	}

	async getOrCreateTargetFolder(): Promise<
		import("./GoogleDriveProvider").GoogleDriveFolderInfo
	> {
		const delegate = await this.ensureLoaded();
		if (this.pendingConfig) {
			await delegate.connect(this.pendingConfig);
		}
		return delegate.getOrCreateTargetFolder();
	}

	async listFiles(
		folderId: string,
	): Promise<import("./GoogleDriveProvider").GoogleDriveRemoteFile[]> {
		const delegate = await this.ensureLoaded();
		if (this.pendingConfig) {
			await delegate.connect(this.pendingConfig);
		}
		return delegate.listFiles(folderId);
	}

	async uploadFile(
		driveFileName: string,
		content: string,
		folderId: string,
		existingFileId?: string,
	): Promise<void> {
		const delegate = await this.ensureLoaded();
		if (this.pendingConfig) {
			await delegate.connect(this.pendingConfig);
		}
		return delegate.uploadFile(
			driveFileName,
			content,
			folderId,
			existingFileId,
		);
	}

	async disconnect(): Promise<void> {
		this.pendingConfig = null;
		if (this.delegate) {
			await this.delegate.disconnect();
		}
	}

	async authenticateWithPkce(
		authContext?: GoogleDriveAuthContext,
	): Promise<GoogleDriveProviderConfig> {
		const delegate = await this.ensureLoaded();
		return delegate.authenticateWithPkce(authContext);
	}
}
