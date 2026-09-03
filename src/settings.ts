import type { SyncStatus } from "./types";

/** Proveedor de nube activo (único — sin réplicas espejo) */
export type CloudProviderId = "github" | "gdrive" | "onedrive" | "icloud";

export interface GitHubProviderConfig {
	label: string;
	remoteUrl?: string;
	username?: string;
	token?: string;
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
	/** Mapa ruta vault → mtime ms tras último sync exitoso (badges explorador) */
	syncedFileMtimes?: Record<string, number>;
	/** Hash de contenido tras último sync exitoso (badges explorador) */
	syncedContentHashes?: Record<string, string>;
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

/** Ajustes persistentes del plugin ObSave */
export interface ObSaveSettings {
	activeProvider: CloudProviderId | null;
	providerConfig: ProviderConfigMap;
	syncIntervalMinutes: number;
	/** Habilita sync periódica en segundo plano */
	autoSyncEnabled: boolean;
	lastSyncAt: string | null;
	syncStatus: SyncStatus;
}

export const DEFAULT_SETTINGS: ObSaveSettings = {
	activeProvider: null,
	providerConfig: {},
	syncIntervalMinutes: 15,
	autoSyncEnabled: false,
	lastSyncAt: null,
	syncStatus: "idle",
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
