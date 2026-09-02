import type { App } from "obsidian";
import type { ICloudProviderConfig } from "../settings";
import type { IStorageProvider, SyncResult } from "./IStorageProvider";

/** Conector Apple iCloud — skeleton Fase 2 */
export class ICloudProvider implements IStorageProvider {
	readonly id = "icloud";
	readonly name = "iCloud";

	constructor(private app: App) {}

	async connect(_config: ICloudProviderConfig): Promise<boolean> {
		console.log("[ObSave] iCloud — connect pendiente (Fase 2)");
		return false;
	}

	async sync(): Promise<SyncResult> {
		throw new Error("iCloud aún no está disponible (Fase 2).");
	}

	async disconnect(): Promise<void> {
		console.log("[ObSave] iCloud — disconnect (sin sesión activa)");
	}
}
