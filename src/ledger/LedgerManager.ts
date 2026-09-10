import type { App, TAbstractFile, TFile } from "obsidian";
import { Notice, normalizePath, TFolder } from "obsidian";
import type { SyncLedgerEntry } from "../settings";
import { hashContent } from "../utils/contentHash";
import {
	createEmptyManifest,
	type LedgerEntry,
	type LedgerEntryType,
	type LedgerManifest,
	type LedgerStatus,
	LEDGER_MANIFEST_VERSION,
} from "./types";

const LOCAL_LEDGER_REL = "plugins/obsave/ledger.json";

export class LedgerManager {
	private manifest: LedgerManifest;
	private loaded = false;
	private saveQueue: Promise<void> = Promise.resolve();

	constructor(
		private app: App,
		private getDeviceName: () => string,
	) {
		this.manifest = createEmptyManifest(getDeviceName());
	}

	getManifest(): LedgerManifest {
		return this.manifest;
	}

	getEntry(path: string): LedgerEntry | undefined {
		return this.manifest.entries[path];
	}

	getEntries(): Record<string, LedgerEntry> {
		return this.manifest.entries;
	}

	hasPendingChanges(): boolean {
		return Object.values(this.manifest.entries).some(
			(e) => e.status === "C" || e.status === "U" || e.status === "D",
		);
	}

	isLoaded(): boolean {
		return this.loaded;
	}

	private localPath(): string {
		return normalizePath(`${this.app.vault.configDir}/${LOCAL_LEDGER_REL}`);
	}

	private backupPath(): string {
		return `${this.localPath()}.bak`;
	}

	private tempPath(): string {
		return `${this.localPath()}.tmp`;
	}

	async load(): Promise<void> {
		const primary = await this.readManifestFile(this.localPath());
		if (primary.outcome === "ok") {
			this.manifest = primary.manifest;
			this.loaded = true;
			return;
		}

		// Un manifiesto ilegible nunca debe degradar a vacío en silencio: primero
		// el temporal de una escritura interrumpida (el más reciente), luego el respaldo.
		for (const candidate of [this.tempPath(), this.backupPath()]) {
			const fallback = await this.readManifestFile(candidate);
			if (fallback.outcome !== "ok") {
				continue;
			}

			this.manifest = fallback.manifest;
			this.loaded = true;
			console.warn(
				`[ObSave] ledger.json ilegible; restaurado desde ${candidate}`,
			);
			new Notice(
				"ObSave: manifiesto dañado — restaurado desde copia de seguridad.",
			);
			await this.save();
			return;
		}

		if (primary.outcome === "corrupt") {
			console.warn(
				"[ObSave] ledger.json corrupto y sin respaldo utilizable; se reconstruye vacío.",
			);
			new Notice(
				"ObSave: manifiesto dañado y sin respaldo. Usa «Reparar / Reconstruir Bóveda Remota».",
			);
		}

		this.manifest = createEmptyManifest(this.getDeviceName());
		this.loaded = true;
	}

	private async readManifestFile(
		path: string,
	): Promise<
		| { outcome: "ok"; manifest: LedgerManifest }
		| { outcome: "missing" | "corrupt" }
	> {
		try {
			if (!(await this.app.vault.adapter.exists(path))) {
				return { outcome: "missing" };
			}
			const raw = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(raw) as LedgerManifest;
			if (parsed.version !== LEDGER_MANIFEST_VERSION || !parsed.entries) {
				return { outcome: "corrupt" };
			}
			return { outcome: "ok", manifest: parsed };
		} catch {
			return { outcome: "corrupt" };
		}
	}

	/** Encola la escritura: nunca hay dos `write` compitiendo por el mismo archivo. */
	save(): Promise<void> {
		this.saveQueue = this.saveQueue
			.catch(() => undefined)
			.then(() => this.writeManifest());
		return this.saveQueue;
	}

	private async writeManifest(): Promise<void> {
		this.manifest.lastUpdated = new Date().toISOString();
		this.manifest.lastUpdatedByDevice = this.getDeviceName();

		const adapter = this.app.vault.adapter;
		const path = this.localPath();
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (!(await adapter.exists(dir))) {
			await adapter.mkdir(dir);
		}

		const payload = JSON.stringify(this.manifest, null, 2);
		const temp = this.tempPath();

		// Escritura atómica: temporal + rename, con la versión previa como respaldo.
		try {
			await adapter.write(temp, payload);

			if (await adapter.exists(path)) {
				try {
					const previous = await adapter.read(path);
					await adapter.write(this.backupPath(), previous);
				} catch (error) {
					console.warn("[ObSave] No se pudo respaldar ledger.json:", error);
				}
				await adapter.remove(path);
			}

			await adapter.rename(temp, path);
		} catch (error) {
			// El adaptador puede no soportar rename/remove: garantizar el manifiesto.
			console.warn(
				"[ObSave] Escritura atómica del ledger no disponible, se escribe directo:",
				error,
			);
			await adapter.write(path, payload);
			try {
				if (await adapter.exists(temp)) {
					await adapter.remove(temp);
				}
			} catch {
				/* temporal residual sin impacto funcional */
			}
		}
	}

	async migrateFromLegacyLedger(
		legacy: Record<string, SyncLedgerEntry> | undefined,
	): Promise<void> {
		if (!legacy || Object.keys(legacy).length === 0) {
			return;
		}
		if (Object.keys(this.manifest.entries).length > 0) {
			return;
		}
		for (const [vaultPath, entry] of Object.entries(legacy)) {
			const isFolder = !vaultPath.endsWith(".md");
			this.manifest.entries[vaultPath] = {
				type: isFolder ? "folder" : "file",
				remoteId: entry.driveFileId,
				hash: entry.hash,
				mtime: entry.mtime,
				size: entry.size,
				status: entry.driveFileId ? "S" : "C",
			};
		}
		await this.save();
	}

	markCreated(path: string, type: LedgerEntryType): void {
		const existing = this.manifest.entries[path];
		this.manifest.entries[path] = {
			type,
			status: "C",
			remoteId: existing?.remoteId,
			hash: existing?.hash,
			mtime: existing?.mtime,
			size: existing?.size,
		};
	}

	markUpdated(path: string): void {
		const existing = this.manifest.entries[path];
		if (!existing) {
			const type: LedgerEntryType = path.endsWith(".md") ? "file" : "folder";
			this.markCreated(path, type);
			return;
		}
		if (existing.status === "C") {
			return;
		}
		existing.status = "U";
	}

	markDeleted(path: string): void {
		const existing = this.manifest.entries[path];
		if (!existing) {
			const type: LedgerEntryType = path.endsWith(".md") ? "file" : "folder";
			this.manifest.entries[path] = { type, status: "D" };
			return;
		}
		existing.status = "D";
	}

	markSynchronized(
		path: string,
		patch: Partial<Pick<LedgerEntry, "remoteId" | "hash" | "mtime" | "size" | "type">>,
	): void {
		const existing = this.manifest.entries[path];
		this.manifest.entries[path] = {
			type: patch.type ?? existing?.type ?? (path.endsWith(".md") ? "file" : "folder"),
			remoteId: patch.remoteId ?? existing?.remoteId,
			hash: patch.hash ?? existing?.hash,
			mtime: patch.mtime ?? existing?.mtime,
			size: patch.size ?? existing?.size,
			status: "S",
		};
		delete this.manifest.entries[path]!.previousPath;
	}

	removeEntry(path: string): void {
		delete this.manifest.entries[path];
	}

	/** Renombra carpeta/archivo y descendientes; marca U y conserva remoteId. */
	renamePathCascade(oldPath: string, newPath: string): void {
		if (oldPath === newPath) {
			return;
		}

		const prefix = `${oldPath}/`;
		const keysToMove = Object.keys(this.manifest.entries).filter(
			(key) => key === oldPath || key.startsWith(prefix),
		);

		if (keysToMove.length === 0 && !oldPath.endsWith(".md")) {
			this.manifest.entries[newPath] = {
				type: "folder",
				status: "U",
			};
			return;
		}

		const moves: { from: string; to: string }[] = keysToMove.map((from) => {
			const suffix = from === oldPath ? "" : from.slice(oldPath.length);
			return { from, to: `${newPath}${suffix}` };
		});

		for (const { from, to } of moves) {
			const entry = this.manifest.entries[from];
			if (!entry) {
				continue;
			}
			delete this.manifest.entries[from];
			this.manifest.entries[to] = {
				...entry,
				previousPath: from,
				status: entry.status === "C" ? "C" : "U",
			};
		}
	}

	markUpdatedWithFingerprint(
		path: string,
		fingerprint: { hash: string; mtime: number; size: number },
	): void {
		const existing = this.manifest.entries[path];
		if (!existing) {
			this.manifest.entries[path] = {
				type: path.endsWith(".md") ? "file" : "folder",
				status: "U",
				...fingerprint,
			};
			return;
		}
		existing.status = existing.status === "C" ? "C" : "U";
		existing.hash = fingerprint.hash;
		existing.mtime = fingerprint.mtime;
		existing.size = fingerprint.size;
	}

	applyRemoteManifest(remote: LedgerManifest): void {
		for (const [path, remoteEntry] of Object.entries(remote.entries)) {
			const local = this.manifest.entries[path];
			if (local && (local.status === "C" || local.status === "U" || local.status === "D")) {
				continue;
			}
			this.manifest.entries[path] = { ...remoteEntry };
		}
	}

	replaceManifest(manifest: LedgerManifest): void {
		this.manifest = manifest;
	}

	async rebuildFromLocalVault(): Promise<void> {
		const device = this.getDeviceName();
		const manifest = createEmptyManifest(device);

		for (const folder of this.app.vault.getAllFolders()) {
			if (folder.path.startsWith(".obsidian") || folder.path.startsWith(".obsave")) {
				continue;
			}
			manifest.entries[folder.path] = { type: "folder", status: "C" };
		}

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path.startsWith(".obsidian") || file.path.startsWith(".obsave")) {
				continue;
			}
			const content = await this.app.vault.read(file);
			manifest.entries[file.path] = {
				type: "file",
				status: "C",
				hash: hashContent(content),
				mtime: file.stat.mtime,
				size: file.stat.size,
			};
		}

		this.manifest = manifest;
		await this.save();
	}

	async trackFileFromDisk(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const entry = this.manifest.entries[file.path];
		const hash = hashContent(content);
		if (!entry) {
			this.manifest.entries[file.path] = {
				type: "file",
				status: "C",
				hash,
				mtime: file.stat.mtime,
				size: file.stat.size,
			};
			return;
		}
		// El archivo volvió a existir: cancelar el borrado pendiente antes de
		// que el ciclo lo propague al remoto.
		if (entry.status === "D") {
			entry.type = "file";
			entry.status = entry.remoteId ? "U" : "C";
			entry.hash = hash;
			entry.mtime = file.stat.mtime;
			entry.size = file.stat.size;
			delete entry.previousPath;
			return;
		}
		if (entry.status === "S" && entry.hash === hash && entry.mtime === file.stat.mtime) {
			return;
		}
		if (entry.status === "C") {
			entry.hash = hash;
			entry.mtime = file.stat.mtime;
			entry.size = file.stat.size;
			return;
		}
		entry.status = "U";
		entry.hash = hash;
		entry.mtime = file.stat.mtime;
		entry.size = file.stat.size;
	}

	trackFolder(path: string): void {
		const entry = this.manifest.entries[path];
		if (!entry) {
			this.manifest.entries[path] = { type: "folder", status: "C" };
			return;
		}
		// Recreada tras un borrado sin propagar: revive como pendiente de subida.
		if (entry.status === "D") {
			entry.type = "folder";
			entry.status = "C";
			delete entry.previousPath;
		}
	}

	/** Registra el id remoto conocido sin declarar la entrada sincronizada. */
	attachRemoteId(
		path: string,
		remoteId: string,
		type: LedgerEntryType,
	): void {
		const entry = this.manifest.entries[path];
		if (!entry) {
			this.manifest.entries[path] = { type, status: "C", remoteId };
			return;
		}
		entry.remoteId = remoteId;
		if (entry.status === "D") {
			entry.status = "C";
			delete entry.previousPath;
		}
	}

	trackDelete(file: TAbstractFile): void {
		const path = file.path;
		this.markDeleted(path);
		if (file instanceof TFolder) {
			const prefix = `${path}/`;
			for (const key of Object.keys(this.manifest.entries)) {
				if (key.startsWith(prefix)) {
					this.manifest.entries[key]!.status = "D";
				}
			}
		}
	}

	pendingPaths(): string[] {
		return Object.entries(this.manifest.entries)
			.filter(([, e]) => e.status === "C" || e.status === "U" || e.status === "D")
			.map(([p]) => p);
	}

	allPathsWithStatus(status: LedgerStatus): string[] {
		return Object.entries(this.manifest.entries)
			.filter(([, e]) => e.status === status)
			.map(([p]) => p);
	}
}
