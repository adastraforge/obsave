import type { App } from "obsidian";
import type { CloudProviderId } from "../settings";
import type { IStorageProvider } from "./IStorageProvider";
import { GitHubProvider } from "./GitHubProvider";
import { GoogleDriveLazyProvider } from "./GoogleDriveLazyProvider";
import { ICloudProvider } from "./ICloudProvider";
import { OneDriveProvider } from "./OneDriveProvider";

export type { IStorageProvider, SyncResult } from "./IStorageProvider";
export { GitHubProvider } from "./GitHubProvider";
export { GoogleDriveLazyProvider } from "./GoogleDriveLazyProvider";
export { OneDriveProvider } from "./OneDriveProvider";
export { ICloudProvider } from "./ICloudProvider";

export function createProviderRegistry(
	app: App,
	githubProvider: GitHubProvider,
	googleDriveProvider: GoogleDriveLazyProvider,
): Map<CloudProviderId, IStorageProvider> {
	return new Map<CloudProviderId, IStorageProvider>([
		["github", githubProvider],
		["gdrive", googleDriveProvider],
		["onedrive", new OneDriveProvider(app)],
		["icloud", new ICloudProvider(app)],
	]);
}
