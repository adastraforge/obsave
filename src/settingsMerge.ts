import type { ObSaveSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

/**
 * Fusiona data.json persistido sin sobrescribir masterRepo ni credenciales
 * con valores por defecto durante la inicialización.
 */
export function mergeStoredSettings(
	stored: Partial<ObSaveSettings> | null | undefined,
): ObSaveSettings {
	if (!stored || typeof stored !== "object") {
		return { ...DEFAULT_SETTINGS };
	}

	return {
		masterRepo:
			stored.masterRepo !== undefined
				? stored.masterRepo
					? { ...stored.masterRepo }
					: null
				: DEFAULT_SETTINGS.masterRepo,
		replicaRepos: Array.isArray(stored.replicaRepos)
			? stored.replicaRepos.map((r) => ({ ...r }))
			: DEFAULT_SETTINGS.replicaRepos,
		syncIntervalMinutes:
			typeof stored.syncIntervalMinutes === "number"
				? stored.syncIntervalMinutes
				: DEFAULT_SETTINGS.syncIntervalMinutes,
		lastSyncAt:
			stored.lastSyncAt !== undefined
				? stored.lastSyncAt
				: DEFAULT_SETTINGS.lastSyncAt,
		syncStatus:
			stored.syncStatus !== undefined
				? stored.syncStatus
				: DEFAULT_SETTINGS.syncStatus,
	};
}
