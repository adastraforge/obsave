import type { App } from "obsidian";
import type { OneDriveProviderConfig } from "../settings";
import type { IStorageProvider, SyncResult } from "./IStorageProvider";

/** Conector Microsoft OneDrive — skeleton Fase 2 (OAuth2 PKCE) */
export class OneDriveProvider implements IStorageProvider {
	readonly id = "onedrive";
	readonly name = "OneDrive";

	constructor(private app: App) {}

	async connect(_config: OneDriveProviderConfig): Promise<boolean> {
		console.log("[ObSave] OneDrive — connect pendiente (Fase 2)");
		return false;
	}

	async sync(): Promise<SyncResult> {
		throw new Error("OneDrive aún no está disponible (Fase 2).");
	}

	async disconnect(): Promise<void> {
		console.log("[ObSave] OneDrive — disconnect (sin sesión activa)");
	}
}
