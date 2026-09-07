import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";
import type { GitHubProvider } from "../providers/GitHubProvider";
import { VAULT_TEMPLATE_FOLDERS } from "./vaultStructure";

const GITKEEP_BODY = "";

function folderExists(app: App, folderPath: string): boolean {
	const node = app.vault.getAbstractFileByPath(folderPath);
	return node instanceof TFolder;
}

function isFolderEmpty(app: App, folderPath: string): boolean {
	const node = app.vault.getAbstractFileByPath(folderPath);
	if (!(node instanceof TFolder)) {
		return false;
	}
	return node.children.length === 0;
}

async function ensureLocalGitkeep(app: App, folderPath: string): Promise<string> {
	const gitkeepPath = `${folderPath}/.gitkeep`;
	const existing = app.vault.getAbstractFileByPath(gitkeepPath);
	if (existing instanceof TFile) {
		return gitkeepPath;
	}
	await app.vault.create(gitkeepPath, GITKEEP_BODY);
	return gitkeepPath;
}

/** Asegura la jerarquía de carpetas plantilla en Google Drive (incluso vacías). */
export async function syncTemplateFoldersToGoogleDrive(
	provider: GoogleDriveLazyProvider,
): Promise<void> {
	const root = await provider.getOrCreateTargetFolder();
	for (const templateFolder of VAULT_TEMPLATE_FOLDERS) {
		await provider.resolveOrCreateFolderPath(root.folderId, templateFolder);
	}
}

/** Sube `.gitkeep` en carpetas plantilla vacías para que GitHub rastree la estructura. */
export async function syncTemplateFoldersToGitHub(
	app: App,
	provider: GitHubProvider,
): Promise<void> {
	for (const templateFolder of VAULT_TEMPLATE_FOLDERS) {
		if (!folderExists(app, templateFolder)) {
			continue;
		}
		if (!isFolderEmpty(app, templateFolder)) {
			continue;
		}

		const gitkeepPath = await ensureLocalGitkeep(app, templateFolder);
		const missingOnRemote = await provider.confirmRemotePathDeleted(gitkeepPath);
		if (!missingOnRemote) {
			continue;
		}

		await provider.uploadRemoteFile(gitkeepPath, GITKEEP_BODY);
	}
}
