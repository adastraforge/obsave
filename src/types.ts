/** Rol de un repositorio en la estrategia Master-Réplicas */
export type RepoRole = "master" | "replica";

/** Estado visible del motor de sincronización */
export type SyncStatus = "idle" | "syncing" | "error";

/** Proveedores de almacenamiento soportados (Fase 1: solo git como placeholder) */
export type StorageProvider =
	| "git"
	| "google-drive"
	| "onedrive"
	| "s3"
	| "icloud";

/** Configuración de un repositorio individual */
export interface RepoConfig {
	id: string;
	role: RepoRole;
	provider: StorageProvider;
	label: string;
	remoteUrl?: string;
	username?: string;
	/** Token o password — cifrado en fases posteriores */
	token?: string;
	enabled: boolean;
}

/** Ajustes persistentes del plugin ObSave */
export interface ObSaveSettings {
	masterRepo: RepoConfig | null;
	replicaRepos: RepoConfig[];
	syncIntervalMinutes: number;
	lastSyncAt: string | null;
	syncStatus: SyncStatus;
}

export const DEFAULT_SETTINGS: ObSaveSettings = {
	masterRepo: null,
	replicaRepos: [],
	syncIntervalMinutes: 15,
	lastSyncAt: null,
	syncStatus: "idle",
};

/** Contrato para adaptadores de almacenamiento (implementación en fases posteriores) */
export interface StorageAdapter {
	readonly provider: StorageProvider;
	readonly repoId: string;

	connect(): Promise<void>;
	disconnect(): Promise<void>;
	pull(): Promise<void>;
	push(): Promise<void>;
	isConnected(): boolean;
}

/** Resultado de un ciclo performSync en GitAdapter */
export interface SyncPerformResult {
	message: string;
	downloadedCount: number;
	uploadedCount: number;
	noChanges: boolean;
	conflictNotices?: string[];
}

/** Evento emitido por SyncEngine hacia la UI */
export interface SyncEngineEvent {
	type: "status-changed" | "sync-complete" | "sync-error";
	status?: SyncStatus;
	message?: string;
	timestamp: string;
	downloadedCount?: number;
	uploadedCount?: number;
}

/** Resultado del wizard de primera sincronización Git */
export interface GitSetupResult {
	success: boolean;
	message: string;
	needsVaultReopen?: boolean;
	repoConfig?: RepoConfig;
}

/** Modo del wizard de configuración inicial */
export type WizardMode = "choose" | "new-repo" | "existing-repo";
