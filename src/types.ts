/** Estado visible del motor de sincronización */
export type SyncStatus = "idle" | "syncing" | "error";

/** Origen de una solicitud de sincronización */
export type SyncTrigger = "manual" | "automatic";

/** Estado de sync visible en el explorador de archivos */
export type FileSyncStatus = "new" | "modified" | "synced";

/** Evento emitido por SyncEngine hacia la UI */
export interface SyncEngineEvent {
	type: "status-changed" | "sync-complete" | "sync-error";
	status?: SyncStatus;
	message?: string;
	timestamp: string;
	trigger?: SyncTrigger;
	noChanges?: boolean;
	downloadedCount?: number;
	uploadedCount?: number;
}

/** Resultado del wizard de primera sincronización GitHub */
export interface GitSetupResult {
	success: boolean;
	message: string;
	needsVaultReopen?: boolean;
	githubConfig?: import("./settings").GitHubProviderConfig;
}

/** Modo del wizard de configuración inicial */
export type WizardMode =
	| "select-provider"
	| "choose"
	| "new-repo"
	| "existing-repo"
	| "gdrive-setup";

export type {
	CloudProviderId,
	GitHubProviderConfig,
	GoogleDriveProviderConfig,
	ICloudProviderConfig,
	ObSaveSettings,
	OneDriveProviderConfig,
	ProviderConfigMap,
	SyncLedgerEntry,
} from "./settings";
export {
	clampSyncIntervalSeconds,
	DEFAULT_SETTINGS,
	getGitHubConfig,
	getGoogleDriveConfig,
	hasProviderCredentials,
	isProviderConfigured,
} from "./settings";

export type { SyncResult } from "./providers/IStorageProvider";
