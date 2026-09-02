import * as path from "path";
import { App, FileSystemAdapter } from "obsidian";

const SKIP_DIRS = new Set([".git", ".trash", "node_modules"]);

export function getVaultAdapter(app: App): FileSystemAdapter {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error(
			"ObSave requiere Obsidian Desktop con acceso al sistema de archivos.",
		);
	}
	return adapter;
}

export function getVaultBasePath(app: App): string {
	return getVaultAdapter(app).getBasePath();
}

export function getVaultFolderName(app: App): string {
	return path.basename(getVaultBasePath(app));
}

/**
 * Renombra la carpeta física del vault usando FileSystemAdapter como gateway.
 * Retorna la ruta absoluta nueva (el adapter de Obsidian sigue apuntando a la
 * ruta anterior hasta que el usuario reabra la bóveda).
 */
export async function renameVaultFolder(
	app: App,
	newName: string,
): Promise<string> {
	const adapter = getVaultAdapter(app);
	const sanitized = newName.trim();

	if (!sanitized) {
		throw new Error("El nombre de la carpeta no puede estar vacío.");
	}

	if (/[<>:"/\\|?*]/.test(sanitized)) {
		throw new Error("El nombre contiene caracteres no permitidos.");
	}

	const oldBasePath = adapter.getBasePath();
	const parentDir = path.dirname(oldBasePath);
	const newBasePath = path.join(parentDir, sanitized);

	if (path.basename(oldBasePath) === sanitized) {
		return oldBasePath;
	}

	await adapter.exists("");
	await renameDirectoryViaAdapter(adapter, parentDir, path.basename(oldBasePath), sanitized);

	return newBasePath;
}

/** Renombrado de directorio hermano al vault — misma semántica que FileSystemAdapter.rename */
async function renameDirectoryViaAdapter(
	vaultAdapter: FileSystemAdapter,
	parentDir: string,
	oldFolderName: string,
	newFolderName: string,
): Promise<void> {
	const oldFullPath = path.join(parentDir, oldFolderName);
	const newFullPath = path.join(parentDir, newFolderName);

	const fs = require("fs") as typeof import("fs");

	if (fs.existsSync(newFullPath)) {
		throw new Error(
			`Ya existe una carpeta llamada "${newFolderName}" en ${parentDir}.`,
		);
	}

	await new Promise<void>((resolve, reject) => {
		fs.rename(oldFullPath, newFullPath, (err: NodeJS.ErrnoException | null) => {
			if (err) {
				reject(
					new Error(
						`No se pudo renombrar la bóveda: ${err.message}. Cierre otros programas que usen la carpeta e intente de nuevo.`,
					),
				);
				return;
			}
			resolve();
		});
	});

	void vaultAdapter;
}

export function conflictCopyPath(relativePath: string, dateStr: string): string {
	const ext = path.extname(relativePath);
	const base = ext ? relativePath.slice(0, -ext.length) : relativePath;
	return `${base} (Copia de conflicto local ${dateStr})${ext}`;
}

export function formatConflictDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export async function walkVaultFiles(
	basePath: string,
): Promise<Map<string, Buffer>> {
	const fs = require("fs") as typeof import("fs");
	const files = new Map<string, Buffer>();

	async function walk(currentDir: string, prefix: string): Promise<void> {
		const entries = await fs.promises.readdir(currentDir, {
			withFileTypes: true,
		});

		for (const entry of entries) {
			if (SKIP_DIRS.has(entry.name) || entry.name === ".git") continue;

			if (entry.isDirectory()) {
				await walk(
					path.join(currentDir, entry.name),
					prefix ? `${prefix}/${entry.name}` : entry.name,
				);
				continue;
			}

			if (!entry.isFile()) continue;

			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			const full = path.join(currentDir, entry.name);
			const content = await fs.promises.readFile(full);
			files.set(relative, content);
		}
	}

	await walk(basePath, "");
	return files;
}

export async function writeVaultFile(
	basePath: string,
	relativePath: string,
	content: Buffer,
): Promise<void> {
	const fs = require("fs") as typeof import("fs");
	const fullPath = path.join(basePath, relativePath);
	await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.promises.writeFile(fullPath, content);
}

export async function ensureGitIgnore(basePath: string): Promise<void> {
	const fs = require("fs") as typeof import("fs");
	const gitignorePath = path.join(basePath, ".gitignore");
	const defaults = [".trash/", ".DS_Store", "Thumbs.db", "*.tmp"].join("\n");

	if (!fs.existsSync(gitignorePath)) {
		await fs.promises.writeFile(gitignorePath, `${defaults}\n`);
		return;
	}

	const current = await fs.promises.readFile(gitignorePath, "utf8");
	if (!current.includes(".trash/")) {
		await fs.promises.appendFile(gitignorePath, `\n${defaults}\n`);
	}
}
