import { hashContent } from "../utils/contentHash";
import type { LedgerManifest } from "./types";

/** Hash estable del manifiesto para verificación ligera remota. */
export function hashManifest(manifest: LedgerManifest): string {
	const sortedEntries: Record<string, unknown> = {};
	for (const key of Object.keys(manifest.entries).sort()) {
		sortedEntries[key] = manifest.entries[key];
	}
	const payload = JSON.stringify({
		version: manifest.version,
		entries: sortedEntries,
	});
	return hashContent(payload);
}
