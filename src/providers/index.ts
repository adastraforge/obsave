import type { App } from "obsidian";
import type { CloudProviderId } from "../settings";
import type { IStorageProvider } from "./IStorageProvider";
import { GitHubProvider } from "./GitHubProvider";
import { GoogleDriveProvider } from "./GoogleDriveProvider";
import { ICloudProvider } from "./ICloudProvider";
import { OneDriveProvider } from "./OneDriveProvider";

export type { IStorageProvider, SyncResult } from "./IStorageProvider";
export { GitHubProvider } from "./GitHubProvider";
export { GoogleDriveProvider } from "./GoogleDriveProvider";
export { OneDriveProvider } from "./OneDriveProvider";
export { ICloudProvider } from "./ICloudProvider";

export function createProviderRegistry(
	app: App,
	githubProvider: GitHubProvider,
): Map<CloudProviderId, IStorageProvider> {
	return new Map<CloudProviderId, IStorageProvider>([
		["github", githubProvider],
		["gdrive", new GoogleDriveProvider(app)],
		["onedrive", new OneDriveProvider(app)],
		["icloud", new ICloudProvider(app)],
	]);
}
