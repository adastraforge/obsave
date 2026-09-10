import type { App, TAbstractFile, TFile } from "obsidian";
import { normalizePath, TFolder } from "obsidian";
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

	async load(): Promise<void> {
		const path = this.localPath();
		try {
			const raw = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(raw) as LedgerManifest;
			if (parsed.version === LEDGER_MANIFEST_VERSION && parsed.entries) {
				this.manifest = parsed;
			}
		} catch {
			this.manifest = createEmptyManifest(this.getDeviceName());
		}
		this.loaded = true;
	}

	async save(): Promise<void> {
		this.manifest.lastUpdated = new Date().toISOString();
		this.manifest.lastUpdatedByDevice = this.getDeviceName();
		const path = this.localPath();
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (!(await this.app.vault.adapter.exists(dir))) {
			await this.app.vault.adapter.mkdir(dir);
		}
		await this.app.vault.adapter.write(
			path,
			JSON.stringify(this.manifest, null, 2),
		);
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
		if (this.manifest.entries[path]) {
			return;
		}
		this.manifest.entries[path] = { type: "folder", status: "C" };
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
