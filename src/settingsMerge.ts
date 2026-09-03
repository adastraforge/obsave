import {
	DEFAULT_SETTINGS,
	type LegacyStoredSettings,
	type ObSaveSettings,
	legacyRepoToGitHubConfig,
} from "./settings";

/**
 * Fusiona data.json persistido sin sobrescribir proveedor activo ni credenciales
 * con valores por defecto durante la inicialización.
 * Migra automáticamente el formato legacy `masterRepo` / `replicaRepos`.
 */
export function mergeStoredSettings(
	stored: LegacyStoredSettings | null | undefined,
): ObSaveSettings {
	if (!stored || typeof stored !== "object") {
		return { ...DEFAULT_SETTINGS };
	}

	const migrated = migrateLegacyProviderFields(stored);

	return {
		activeProvider:
			migrated.activeProvider !== undefined
				? migrated.activeProvider
				: DEFAULT_SETTINGS.activeProvider,
		providerConfig: {
			...DEFAULT_SETTINGS.providerConfig,
			...(migrated.providerConfig ?? {}),
			github:
				migrated.providerConfig?.github !== undefined
					? migrated.providerConfig.github
						? { ...migrated.providerConfig.github }
						: null
					: DEFAULT_SETTINGS.providerConfig.github,
			gdrive:
				migrated.providerConfig?.gdrive !== undefined
					? migrated.providerConfig.gdrive
						? { ...migrated.providerConfig.gdrive }
						: null
					: DEFAULT_SETTINGS.providerConfig.gdrive,
			onedrive:
				migrated.providerConfig?.onedrive !== undefined
					? migrated.providerConfig.onedrive
						? { ...migrated.providerConfig.onedrive }
						: null
					: DEFAULT_SETTINGS.providerConfig.onedrive,
			icloud:
				migrated.providerConfig?.icloud !== undefined
					? migrated.providerConfig.icloud
						? { ...migrated.providerConfig.icloud }
						: null
					: DEFAULT_SETTINGS.providerConfig.icloud,
		},
		syncIntervalMinutes:
			typeof migrated.syncIntervalMinutes === "number"
				? migrated.syncIntervalMinutes
				: DEFAULT_SETTINGS.syncIntervalMinutes,
		autoSyncEnabled:
			typeof migrated.autoSyncEnabled === "boolean"
				? migrated.autoSyncEnabled
				: DEFAULT_SETTINGS.autoSyncEnabled,
		lastSyncAt:
			migrated.lastSyncAt !== undefined
				? migrated.lastSyncAt
				: DEFAULT_SETTINGS.lastSyncAt,
		syncStatus:
			migrated.syncStatus !== undefined
				? migrated.syncStatus
				: DEFAULT_SETTINGS.syncStatus,
	};
}

function migrateLegacyProviderFields(
	stored: LegacyStoredSettings,
): Partial<ObSaveSettings> {
	if (stored.activeProvider !== undefined || !stored.masterRepo) {
		const { masterRepo: _master, replicaRepos: _replicas, ...rest } = stored;
		return rest;
	}

	return {
		...stored,
		activeProvider: "github",
		providerConfig: {
			...stored.providerConfig,
			github: legacyRepoToGitHubConfig(stored.masterRepo),
		},
	};
}
