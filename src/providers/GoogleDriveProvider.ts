import type { App } from "obsidian";
import type { GoogleDriveProviderConfig } from "../settings";
import type { IStorageProvider, SyncResult } from "./IStorageProvider";

/** Conector Google Drive — skeleton Fase 2 (OAuth2 PKCE) */
export class GoogleDriveProvider implements IStorageProvider {
	readonly id = "gdrive";
	readonly name = "Google Drive";

	constructor(private app: App) {}

	async connect(_config: GoogleDriveProviderConfig): Promise<boolean> {
		console.log("[ObSave] Google Drive — connect pendiente (Fase 2)");
		return false;
	}

	async sync(): Promise<SyncResult> {
		throw new Error("Google Drive aún no está disponible (Fase 2).");
	}

	async disconnect(): Promise<void> {
		console.log("[ObSave] Google Drive — disconnect (sin sesión activa)");
	}
}
