/** Estado de sincronización en el manifiesto */
export type LedgerStatus = "C" | "U" | "D" | "S";

export type LedgerEntryType = "file" | "folder";

export interface LedgerEntry {
	type: LedgerEntryType;
	remoteId?: string;
	hash?: string;
	mtime?: number;
	size?: number;
	status: LedgerStatus;
}

export interface LedgerManifest {
	version: 1;
	lastUpdated: string;
	lastUpdatedByDevice: string;
	entries: Record<string, LedgerEntry>;
}

export const LEDGER_MANIFEST_VERSION = 1 as const;

export const REMOTE_LEDGER_PATH = ".obsave/ledger.json";

export function createEmptyManifest(deviceName: string): LedgerManifest {
	return {
		version: LEDGER_MANIFEST_VERSION,
		lastUpdated: new Date().toISOString(),
		lastUpdatedByDevice: deviceName,
		entries: {},
	};
}
