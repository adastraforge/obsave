import {
	clampSyncIntervalSeconds,
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
		syncIntervalSeconds: resolveSyncIntervalSeconds(migrated),
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
		syncedLedger: migrateSyncedLedger(migrated),
	};
}

function migrateSyncedLedger(
	migrated: Partial<ObSaveSettings>,
): Record<string, import("./settings").SyncLedgerEntry> {
	if (migrated.syncedLedger && typeof migrated.syncedLedger === "object") {
		return { ...migrated.syncedLedger };
	}

	const gdrive = migrated.providerConfig?.gdrive as
		| (typeof migrated.providerConfig extends { gdrive?: infer G } ? G : never)
		| undefined;
	if (!gdrive) {
		return {};
	}

	const legacy = gdrive as typeof gdrive & {
		syncedFileMtimes?: Record<string, number>;
		syncedContentHashes?: Record<string, string>;
	};
	const mtimes = legacy.syncedFileMtimes ?? {};
	const hashes = legacy.syncedContentHashes ?? {};
	const ledger: Record<string, import("./settings").SyncLedgerEntry> = {};

	for (const path of Object.keys(mtimes)) {
		ledger[path] = {
			hash: hashes[path] ?? "",
			mtime: mtimes[path],
		};
	}

	return ledger;
}

function resolveSyncIntervalSeconds(migrated: Partial<ObSaveSettings>): number {
	if (typeof migrated.syncIntervalSeconds === "number") {
		return clampSyncIntervalSeconds(migrated.syncIntervalSeconds);
	}

	if (typeof migrated.syncIntervalMinutes === "number") {
		return clampSyncIntervalSeconds(migrated.syncIntervalMinutes * 60);
	}

	return DEFAULT_SETTINGS.syncIntervalSeconds;
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
