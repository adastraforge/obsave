import type { App } from "obsidian";
import { Notice, TFolder } from "obsidian";
import type { LedgerManager } from "../ledger/LedgerManager";

export const VAULT_TEMPLATE_FOLDERS = [
	"00_Diarias",
	"01_Proyectos",
	"02_Ideas",
	"03_Personales",
	"04_Trabajo",
	"05_Archivadas",
] as const;

function folderExists(app: App, folderPath: string): boolean {
	const node = app.vault.getAbstractFileByPath(folderPath);
	return node instanceof TFolder;
}

/**
 * Genera la estructura plantilla en disco y la registra en el ledger local.
 * Operación estrictamente local: la subida a la nube es responsabilidad
 * exclusiva del `SyncEngine` en su próximo ciclo.
 */
export async function generateVaultTemplateFolders(
	app: App,
	ledger: LedgerManager,
): Promise<string[]> {
	const created: string[] = [];

	for (const folder of VAULT_TEMPLATE_FOLDERS) {
		if (!folderExists(app, folder)) {
			try {
				await app.vault.createFolder(folder);
				created.push(folder);
			} catch (error) {
				console.warn(`[ObSave] No se pudo crear «${folder}»:`, error);
				continue;
			}
		}
		ledger.trackFolder(folder);
	}

	await ledger.save();

	if (created.length === 0) {
		new Notice("ObSave: Todas las carpetas de plantilla ya existen.");
	} else {
		new Notice(
			`ObSave: Carpetas creadas, pendientes de sincronizar — ${created.join(", ")}`,
		);
	}

	return created;
}

/** `01_Proyectos` → `proyectos` */
export function cleanFolderTypeName(folderPath: string): string {
	const segment = folderPath.split("/").filter(Boolean).pop() ?? folderPath;
	return segment.replace(/^\d{2}_/, "").toLowerCase();
}
