import type { SyncStatus } from "./types";

/** Proveedor de nube activo (único — sin réplicas espejo) */
export type CloudProviderId = "github" | "gdrive" | "onedrive" | "icloud";

export interface GitHubProviderConfig {
	label: string;
	remoteUrl?: string;
	username?: string;
	token?: string;
}

/** Entrada del registro de sincronización por ruta de bóveda */
export interface SyncLedgerEntry {
	hash: string;
	mtime: number;
	/** Tamaño en bytes del archivo local en la última sync estable */
	size?: number;
	/** Timestamp ms de modifiedTime remoto en la última sync estable */
	remoteMtime?: number;
	/** Tamaño en bytes del archivo remoto en la última sync estable */
	remoteSize?: number;
	driveFileId?: string;
}

/** Modo de carpeta destino en Google Drive */
export type GoogleDriveFolderMode = "new" | "existing";

/** Configuración OAuth2 PKCE — Google Drive */
export interface GoogleDriveProviderConfig {
	/** Cuenta autorizada y lista para usar */
	enabled?: boolean;
	accessToken?: string;
	refreshToken?: string;
	/** Timestamp ms de expiración del access_token */
	expiresAt?: number;
	email?: string;
	displayName?: string;
	/** Email real devuelto por userinfo (si el scope lo permitió) */
	accountEmail?: string;
	/** ID de carpeta en Drive */
	folderId?: string;
	/** Ruta legible para UI, p. ej. `/MiBóveda` */
	folderPath?: string;
	/** `new`: crear carpeta; `existing`: elegir carpeta existente vía modal */
	folderMode?: GoogleDriveFolderMode;
	/** Nombre sugerido al crear carpeta nueva */
	folderName?: string;
	/** `false` en modo existente hasta elegir carpeta en el modal */
	folderSelected?: boolean;
}

/** Skeleton Fase 2 — OAuth2 PKCE */
export interface OneDriveProviderConfig {
	driveId?: string;
}

/** Skeleton Fase 2 */
export interface ICloudProviderConfig {
	containerPath?: string;
}

export interface ProviderConfigMap {
	github?: GitHubProviderConfig | null;
	gdrive?: GoogleDriveProviderConfig | null;
	onedrive?: OneDriveProviderConfig | null;
	icloud?: ICloudProviderConfig | null;
}

/** Opciones discretas de intervalo de sync automática (segundos) */
export const SYNC_INTERVAL_OPTIONS = [
	{ seconds: 15, label: "15 segundos" },
	{ seconds: 30, label: "30 segundos" },
	{ seconds: 60, label: "1 minuto" },
	{ seconds: 300, label: "5 minutos" },
	{ seconds: 900, label: "15 minutos" },
	{ seconds: 1800, label: "30 minutos" },
	{ seconds: 3600, label: "1 hora" },
] as const;

export const DEFAULT_SYNC_INTERVAL_SECONDS = 15;

const ALLOWED_SYNC_INTERVALS = new Set(
	SYNC_INTERVAL_OPTIONS.map((option) => option.seconds),
);

export function formatSyncIntervalLabel(seconds: number): string {
	const match = SYNC_INTERVAL_OPTIONS.find((option) => option.seconds === seconds);
	return match?.label ?? `${seconds} segundos`;
}

export function clampSyncIntervalSeconds(seconds: number): number {
	return ALLOWED_SYNC_INTERVALS.has(seconds)
		? seconds
		: DEFAULT_SYNC_INTERVAL_SECONDS;
}

/** Ajustes persistentes del plugin ObSave */
export interface ObSaveSettings {
	activeProvider: CloudProviderId | null;
	providerConfig: ProviderConfigMap;
	/** Intervalo de sync automática en segundos */
	syncIntervalSeconds: number;
	/** @deprecated Migrado a syncIntervalSeconds */
	syncIntervalMinutes?: number;
	/** Habilita sync periódica en segundo plano */
	autoSyncEnabled: boolean;
	lastSyncAt: string | null;
	syncStatus: SyncStatus;
	/** Huella de archivos sincronizados con éxito (ruta vault → entrada) */
	syncedLedger: Record<string, SyncLedgerEntry>;
}

export const DEFAULT_SETTINGS: ObSaveSettings = {
	activeProvider: null,
	providerConfig: {},
	syncIntervalSeconds: DEFAULT_SYNC_INTERVAL_SECONDS,
	autoSyncEnabled: false,
	lastSyncAt: null,
	syncStatus: "idle",
	syncedLedger: {},
};

/** Formato legacy pre-proveedor-único (migración desde data.json) */
export interface LegacyRepoConfig {
	label: string;
	remoteUrl?: string;
	username?: string;
	token?: string;
}

export interface LegacyStoredSettings extends Partial<ObSaveSettings> {
	masterRepo?: LegacyRepoConfig | null;
	replicaRepos?: unknown[];
}

export function getGitHubConfig(
	settings: ObSaveSettings,
): GitHubProviderConfig | null {
	return settings.providerConfig.github ?? null;
}

export function isProviderConfigured(settings: ObSaveSettings): boolean {
	if (!settings.activeProvider) {
		return false;
	}

	if (settings.activeProvider === "github") {
		return !!settings.providerConfig.github?.token;
	}

	if (settings.activeProvider === "gdrive") {
		return !!settings.providerConfig.gdrive?.refreshToken;
	}

	return settings.providerConfig[settings.activeProvider] != null;
}

export function getGoogleDriveConfig(
	settings: ObSaveSettings,
): GoogleDriveProviderConfig | null {
	return settings.providerConfig.gdrive ?? null;
}

/** Indica si el proveedor tiene credenciales almacenadas (independiente de activeProvider). */
export function hasProviderCredentials(
	settings: ObSaveSettings,
	providerId: CloudProviderId,
): boolean {
	switch (providerId) {
		case "github":
			return !!settings.providerConfig.github?.token;
		case "gdrive":
			return !!settings.providerConfig.gdrive?.refreshToken;
		case "onedrive":
			return settings.providerConfig.onedrive != null;
		case "icloud":
			return settings.providerConfig.icloud != null;
	}
}

export function legacyRepoToGitHubConfig(
	repo: LegacyRepoConfig,
): GitHubProviderConfig {
	return {
		label: repo.label,
		remoteUrl: repo.remoteUrl,
		username: repo.username,
		token: repo.token,
	};
}
