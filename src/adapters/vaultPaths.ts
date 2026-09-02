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
 * Metadatos del repositorio en ObSave — no renombra la carpeta física del vault.
 * Obsidian pierde referencia a data.json si se mueve la bóveda en caliente.
 */
export function resolveRepoLabel(
	app: App,
	preferredRepoName: string,
): string {
	const sanitized = preferredRepoName.trim();
	if (sanitized) return sanitized;
	return getVaultFolderName(app);
}

export function conflictCopyPath(relativePath: string, dateStr: string): string {
	const ext = path.extname(relativePath);
	const base = ext ? relativePath.slice(0, -ext.length) : relativePath;
	return `${base} (Copia de conflicto local ${dateStr})${ext}`;
}

/** Ruta con prefijo [Local] o [Sync] para resolución de conflictos .md */
export function prefixedConflictPath(
	relativePath: string,
	prefix: "Local" | "Sync",
): string {
	const dir = path.dirname(relativePath);
	const base = path.basename(relativePath);
	const prefixed = `[${prefix}] ${base}`;
	return dir === "." ? prefixed : path.join(dir, prefixed).replace(/\\/g, "/");
}

export async function readVaultFileBuffer(
	basePath: string,
	relativePath: string,
): Promise<Buffer | null> {
	const fs = require("fs") as typeof import("fs");
	const fullPath = path.join(basePath, relativePath);
	if (!fs.existsSync(fullPath)) return null;
	return fs.promises.readFile(fullPath);
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
