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
			this.attachDelegateConfigListener();
		}
	}

	setPendingConfig(config: GoogleDriveProviderConfig | null): void {
		this.pendingConfig = config;
	}

	getPendingConfig(): GoogleDriveProviderConfig | null {
		return this.pendingConfig;
	}

	private attachDelegateConfigListener(): void {
		if (!this.delegate) {
			return;
		}
		this.delegate.setConfigChangeListener((config) => {
			this.pendingConfig = config;
			this.onConfigChanged?.(config);
		});
	}

	async ensureLoaded(): Promise<InstanceType<GoogleDriveProviderClass>> {
		if (!this.delegate) {
			const { GoogleDriveProvider } = await import("./GoogleDriveProvider");
			this.delegate = new GoogleDriveProvider();
			this.attachDelegateConfigListener();
			if (this.pendingConfig) {
				await this.delegate.connect(this.pendingConfig);
			}
		}
		return this.delegate;
	}

	isLoaded(): boolean {
		return this.delegate !== null;
	}

	private configNeedsSync(
		delegate: InstanceType<GoogleDriveProviderClass>,
	): boolean {
		if (!this.pendingConfig) {
			return false;
		}
		const current = delegate.getConfig();
		if (!current) {
			return true;
		}
		return (
			current.accessToken !== this.pendingConfig.accessToken ||
			current.expiresAt !== this.pendingConfig.expiresAt ||
			current.refreshToken !== this.pendingConfig.refreshToken
		);
	}

	private async ensureDelegateSynced(): Promise<
		InstanceType<GoogleDriveProviderClass>
	> {
		const delegate = await this.ensureLoaded();
		if (this.pendingConfig && this.configNeedsSync(delegate)) {
			await delegate.connect(this.pendingConfig);
		}
		return delegate;
	}

	async connect(config: GoogleDriveProviderConfig): Promise<boolean> {
		this.pendingConfig = config;
		const delegate = await this.ensureLoaded();
		return delegate.connect(config);
	}

	async sync(): Promise<SyncResult> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.sync();
	}

	async listFoldersInParent(
		parentId: string,
	): Promise<import("./GoogleDriveProvider").GoogleDriveFolderEntry[]> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.listFoldersInParent(parentId);
	}

	async listFolders(): Promise<{ id: string; name: string }[]> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.listFolders();
	}

	async getOrCreateTargetFolder(): Promise<
		import("./GoogleDriveProvider").GoogleDriveFolderInfo
	> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.getOrCreateTargetFolder();
	}

	async listFiles(
		folderId: string,
	): Promise<import("./GoogleDriveProvider").GoogleDriveRemoteFile[]> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.listFiles(folderId);
	}

	async listAllMarkdownFiles(
		rootFolderId: string,
	): Promise<import("./GoogleDriveProvider").GoogleDriveRemoteMarkdown[]> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.listAllMarkdownFiles(rootFolderId);
	}

	async downloadFile(fileId: string): Promise<string> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.downloadFile(fileId);
	}

	async deleteFile(fileId: string): Promise<void> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.deleteFile(fileId);
	}

	async resolveOrCreateFolderPath(
		rootFolderId: string,
		relativePath: string,
	): Promise<string> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.resolveOrCreateFolderPath(rootFolderId, relativePath);
	}

	async uploadFile(
		fileName: string,
		content: string,
		folderId: string,
		existingFileId?: string,
	): Promise<void> {
		const delegate = await this.ensureDelegateSynced();
		return delegate.uploadFile(
			fileName,
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
		const config = await delegate.authenticateWithPkce(authContext);
		this.pendingConfig = config;
		return config;
	}
}
