import type { App, TAbstractFile, TFile } from "obsidian";
import { cleanFolderTypeName } from "./vaultStructure";
import { updateNoteTipo } from "../utils/frontmatter";

export function installNoteTypeRenameListener(
	app: App,
	register: (event: ReturnType<App["vault"]["on"]>) => void,
): void {
	register(
		app.vault.on("rename", (file, oldPath) => {
			void handleNoteRename(app, file, oldPath);
		}),
	);
}

async function handleNoteRename(
	app: App,
	file: TAbstractFile,
	oldPath: string,
): Promise<void> {
	if (!(file instanceof TFile) || !file.path.endsWith(".md")) {
		return;
	}

	const parentPath = file.parent?.path;
	if (!parentPath) return;

	const newTipo = cleanFolderTypeName(parentPath);
	const content = await app.vault.read(file);
	const updated = updateNoteTipo(content, newTipo);

	if (updated !== content) {
		await app.vault.modify(file, updated);
		console.log(
			`[ObSave] tipo actualizado tras mover ${oldPath} → ${file.path}: ${newTipo}`,
		);
	}
}
