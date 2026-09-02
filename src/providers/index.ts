import type { App } from "obsidian";
import type { CloudProviderId } from "../settings";

export type { IStorageProvider, SyncResult } from "./IStorageProvider";
export { GitHubProvider } from "./GitHubProvider";
export { GoogleDriveProvider } from "./GoogleDriveProvider";
export { OneDriveProvider } from "./OneDriveProvider";
export { ICloudProvider } from "./ICloudProvider";

export function createProviderRegistry(
	app: App,
	githubProvider: GitHubProvider,
	googleDriveProvider: GoogleDriveProvider,
): Map<CloudProviderId, IStorageProvider> {
	return new Map<CloudProviderId, IStorageProvider>([
		["github", githubProvider],
		["gdrive", googleDriveProvider],
		["onedrive", new OneDriveProvider(app)],
		["icloud", new ICloudProvider(app)],
	]);
}
