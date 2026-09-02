import * as fs from "fs";
import * as path from "path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import type { App } from "obsidian";
import {
	buildAuthenticatedUrl,
	createGitHubRepo,
	parseGitHubUrl,
	resolveGitHubUsername,
} from "./githubApi";
import {
	conflictCopyPath,
	ensureGitIgnore,
	formatConflictDate,
	getVaultBasePath,
	prefixedConflictPath,
	readVaultFileBuffer,
	resolveRepoLabel,
	walkVaultFiles,
	writeVaultFile,
} from "./vaultPaths";
import type { GitSetupResult, RepoConfig, SyncPerformResult } from "../types";

export type { GitSetupResult };

const DEFAULT_BRANCH = "main";
const REMOTE_NAME = "origin";
const REMOTE_TRACKING_REF = `refs/remotes/${REMOTE_NAME}/${DEFAULT_BRANCH}`;
const LOCAL_HEAD_REF = `refs/heads/${DEFAULT_BRANCH}`;
const AUTHOR = {
	name: "ObSave",
	email: "obsave@adastraforge.local",
};

/** Rutas excluidas del escaneo de sync (config interna ObSave) */
const SYNC_EXCLUDED_PREFIXES = [".obsidian/", ".git/"];

export interface NewRepoWizardInput {
	username: string;
	token: string;
	repoName: string;
}

export interface ExistingRepoWizardInput {
	remoteUrl: string;
	username: string;
	token: string;
}

export class GitAdapter {
	constructor(private app: App) {}

	/**
	 * Ciclo de sincronización Git (remoto primero, luego local, luego push):
	 * 1) fetch  2) merge+checkout  3) commit local  4) fallback [Local]/[Sync]  5) push
	 */
	async performSync(masterRepo: RepoConfig): Promise<SyncPerformResult> {
		const basePath = getVaultBasePath(this.app);
		const username = masterRepo.username ?? "";
		const token = masterRepo.token ?? "";

		if (!token) {
			throw new Error("No hay token de GitHub configurado.");
		}

		await this.ensureRepoReady(basePath, masterRepo, username, token);

		const conflictNotices: string[] = [];

		// PASO 1 — fetch
		await this.fetchRemote(basePath, username, token);

		const matrix = await git.statusMatrix({ fs, dir: basePath });
		const localChangeCount = this.countLocalChanges(matrix);
		const localHead = await this.resolveRefSafe(basePath, LOCAL_HEAD_REF);
		const remoteHead = await this.resolveRefSafe(basePath, REMOTE_TRACKING_REF);

		if (localChangeCount === 0 && localHead && remoteHead && localHead === remoteHead) {
			console.log("[ObSave] Sin cambios pendientes");
			await this.delay(500);
			return {
				message: "ObSave: Bóveda al día (sin cambios)",
				downloadedCount: 0,
				uploadedCount: 0,
				noChanges: true,
			};
		}

		// PASO 2 — reconciliar remoto → local
		let downloadedCount = 0;
		try {
			downloadedCount = await this.reconcileRemote(basePath, username, token);
		} catch (reconcileError) {
			console.warn("[ObSave] Reconciliación falló, aplicando fallback:", reconcileError);
			const notices = await this.applyMdConflictFallback(basePath, username, token);
			conflictNotices.push(...notices);
			downloadedCount = notices.length;
		}

		// Detectar conflictos .md residuales tras checkout
		const postReconcileNotices = await this.applyMdConflictFallback(
			basePath,
			username,
			token,
		);
		for (const notice of postReconcileNotices) {
			if (!conflictNotices.includes(notice)) {
				conflictNotices.push(notice);
			}
		}

		// PASO 3 — escanear y commitear cambios locales
		let uploadedCount = 0;
		try {
			uploadedCount = await this.commitLocalChanges(basePath);
		} catch (commitError) {
			console.warn("[ObSave] Commit local falló, aplicando fallback:", commitError);
			const notices = await this.applyMdConflictFallback(basePath, username, token);
			conflictNotices.push(...notices);
			uploadedCount = await this.commitLocalChanges(basePath);
		}

		// PASO 5 — push seguro
		let pushed = false;
		try {
			pushed = await this.pushSafe(basePath, username, token);
		} catch (pushError) {
			console.warn("[ObSave] Push falló, aplicando fallback y reintentando:", pushError);
			const notices = await this.applyMdConflictFallback(basePath, username, token);
			conflictNotices.push(...notices);
			uploadedCount += await this.commitLocalChanges(basePath);
			pushed = await this.pushSafe(basePath, username, token);
		}

		const message = this.buildSyncMessage(
			uploadedCount,
			downloadedCount,
			pushed,
			conflictNotices,
		);
		console.log(`[ObSave] ${message}`);

		return {
			message,
			downloadedCount,
			uploadedCount,
			noChanges:
				uploadedCount === 0 &&
				downloadedCount === 0 &&
				!pushed &&
				conflictNotices.length === 0,
			conflictNotices,
		};
	}

	private buildSyncMessage(
		uploaded: number,
		downloaded: number,
		pushed: boolean,
		conflictNotices: string[] = [],
	): string {
		const parts: string[] = [];

		if (downloaded > 0) {
			parts.push(
				`Se descargaron ${downloaded} cambio${downloaded === 1 ? "" : "s"} de GitHub`,
			);
		}
		if (uploaded > 0) {
			parts.push(
				`Se subieron ${uploaded} cambio${uploaded === 1 ? "" : "s"} locales`,
			);
		}

		if (parts.length === 0 && !pushed && conflictNotices.length === 0) {
			return "ObSave: Bóveda al día (sin cambios)";
		}

		let message =
			parts.length > 0
				? `ObSave: ${parts.join(". ")}`
				: "ObSave: Bóveda al día (sin cambios)";

		if (conflictNotices.length > 0) {
			message = `${message}. ${conflictNotices.join(". ")}`;
		}

		return message;
	}

	/** PASO A — Escanea, stagea y commitea cambios locales */
	private async commitLocalChanges(basePath: string): Promise<number> {
		const matrix = await git.statusMatrix({ fs, dir: basePath });
		let stagedCount = 0;

		for (const row of matrix) {
			const filepath = row[0];
			const headStatus = row[1];
			const workdirStatus = row[2];

			if (!this.shouldTrackPath(filepath)) continue;
			if (headStatus === workdirStatus) continue;

			if (workdirStatus === 0) {
				await git.remove({ fs, dir: basePath, filepath });
			} else {
				await git.add({ fs, dir: basePath, filepath });
			}
			stagedCount++;
		}

		if (stagedCount === 0) return 0;

		const timestamp = new Date().toISOString();
		await git.commit({
			fs,
			dir: basePath,
			message: `sync: auto-commit local [${timestamp}]`,
			author: AUTHOR,
		});

		console.log(`[ObSave] PASO A: ${stagedCount} archivo(s) commiteados localmente`);
		return stagedCount;
	}

	/** PASO 2 — Fetch ya ejecutado; merge remoto + checkout forzado al working directory */
	private async reconcileRemote(
		basePath: string,
		username: string,
		token: string,
	): Promise<number> {
		const localHeadBefore = await this.resolveRefSafe(basePath, LOCAL_HEAD_REF);
		const remoteHead = await this.resolveRefSafe(basePath, REMOTE_TRACKING_REF);

		if (!remoteHead) return 0;
		if (localHeadBefore === remoteHead) return 0;

		let downloadedCount = 0;
		if (localHeadBefore) {
			downloadedCount = await this.countRemoteDiffFiles(
				basePath,
				localHeadBefore,
				remoteHead,
			);
		}

		try {
			await git.merge({
				fs,
				dir: basePath,
				ours: DEFAULT_BRANCH,
				theirs: REMOTE_TRACKING_REF,
				author: AUTHOR,
			});
		} catch (mergeError) {
			console.warn("[ObSave] Merge con conflictos:", mergeError);
			throw mergeError;
		}

		await git.checkout({
			fs,
			dir: basePath,
			ref: DEFAULT_BRANCH,
			force: true,
		});

		console.log(
			`[ObSave] PASO 2: ${downloadedCount} cambio(s) integrados desde remoto`,
		);
		return downloadedCount;
	}

	/**
	 * PASO 4 — Conflict Fallback para archivos .md:
	 * [Local] conserva copia local, [Sync] escribe versión remota.
	 */
	private async applyMdConflictFallback(
		basePath: string,
		username: string,
		token: string,
	): Promise<string[]> {
		const remoteHead = await this.resolveRefSafe(basePath, REMOTE_TRACKING_REF);
		if (!remoteHead) return [];

		const remoteFiles = await this.listFilesInCommit(basePath, remoteHead);
		const notices: string[] = [];

		for (const [filePath, remoteContent] of remoteFiles) {
			if (!filePath.endsWith(".md")) continue;
			if (!this.shouldTrackPath(filePath)) continue;

			const localContent = await readVaultFileBuffer(basePath, filePath);
			if (!localContent || localContent.equals(remoteContent)) continue;

			const localCopyPath = prefixedConflictPath(filePath, "Local");
			const syncCopyPath = prefixedConflictPath(filePath, "Sync");
			const fileName = path.basename(filePath);

			await writeVaultFile(basePath, localCopyPath, localContent);
			await writeVaultFile(basePath, syncCopyPath, remoteContent);

			const notice = `ObSave: Conflicto detectado en ${fileName}. Se crearon copias [Local] y [Sync]`;
			notices.push(notice);
			console.warn(`[ObSave] ${notice}`);
		}

		return notices;
	}

	/** PASO 5 — Push seguro si HEAD local está adelante del remoto */
	private async pushSafe(
		basePath: string,
		username: string,
		token: string,
	): Promise<boolean> {
		await this.fetchRemote(basePath, username, token);

		const localHead = await this.resolveRefSafe(basePath, LOCAL_HEAD_REF);
		const remoteHead = await this.resolveRefSafe(basePath, REMOTE_TRACKING_REF);

		if (!localHead) return false;
		if (localHead === remoteHead) return false;

		if (remoteHead) {
			const mergeBase = await git
				.findMergeBase({
					fs,
					dir: basePath,
					oids: [localHead, remoteHead],
				})
				.catch(() => []);

			if (mergeBase.length > 0 && mergeBase[0] === localHead) {
				return false;
			}
		}

		try {
			await git.push({
				fs,
				http,
				dir: basePath,
				remote: REMOTE_NAME,
				ref: DEFAULT_BRANCH,
				onAuth: this.onAuth(username, token),
			});
			console.log("[ObSave] PASO 5: push completado");
			return true;
		} catch (firstError) {
			await this.fetchRemote(basePath, username, token);
			try {
				await git.merge({
					fs,
					dir: basePath,
					ours: DEFAULT_BRANCH,
					theirs: REMOTE_TRACKING_REF,
					author: AUTHOR,
				});
			} catch {
				await this.applyMdConflictFallback(basePath, username, token);
			}
			await git.checkout({
				fs,
				dir: basePath,
				ref: DEFAULT_BRANCH,
				force: true,
			});
			await this.commitLocalChanges(basePath);
			await git.push({
				fs,
				http,
				dir: basePath,
				remote: REMOTE_NAME,
				ref: DEFAULT_BRANCH,
				onAuth: this.onAuth(username, token),
			});
			console.log("[ObSave] PASO 5: push completado tras reconciliación");
			return true;
		}
	}

	private shouldTrackPath(filepath: string): boolean {
		if (filepath === ".obsidian" || filepath.startsWith(".obsidian/")) {
			return false;
		}
		for (const prefix of SYNC_EXCLUDED_PREFIXES) {
			if (filepath.startsWith(prefix)) return false;
		}
		return true;
	}

	private countLocalChanges(
		matrix: [string, number, number, number][],
	): number {
		let count = 0;
		for (const row of matrix) {
			if (!this.shouldTrackPath(row[0])) continue;
			if (row[1] !== row[2]) count++;
		}
		return count;
	}

	private async countRemoteDiffFiles(
		basePath: string,
		localOid: string,
		remoteOid: string,
	): Promise<number> {
		const localFiles = await this.listFilesInCommit(basePath, localOid);
		const remoteFiles = await this.listFilesInCommit(basePath, remoteOid);
		let count = 0;

		for (const [filePath, remoteContent] of remoteFiles) {
			if (!this.shouldTrackPath(filePath)) continue;
			const localContent = localFiles.get(filePath);
			if (!localContent || !localContent.equals(remoteContent)) {
				count++;
			}
		}

		return count;
	}

	private async resolveRefSafe(
		basePath: string,
		ref: string,
	): Promise<string | undefined> {
		try {
			return await git.resolveRef({ fs, dir: basePath, ref });
		} catch {
			return undefined;
		}
	}

	private async ensureRepoReady(
		basePath: string,
		masterRepo: RepoConfig,
		username: string,
		token: string,
	): Promise<void> {
		if (!masterRepo.remoteUrl) {
			throw new Error("URL del repositorio Master no configurada.");
		}
		const authUrl = buildAuthenticatedUrl(
			masterRepo.remoteUrl,
			username,
			token,
		);
		await this.initializeLocalRepo(basePath, authUrl, username, token);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/** PASO 1-A — Crear repo nuevo en GitHub y sincronizar bóveda local */
	async setupNewRepository(input: NewRepoWizardInput): Promise<GitSetupResult> {
		const repoName = resolveRepoLabel(this.app, input.repoName);
		if (!repoName) {
			return { success: false, message: "El nombre del repositorio es obligatorio." };
		}

		const basePath = getVaultBasePath(this.app);
		const owner = input.username.trim() || (await resolveGitHubUsername(input.token));
		const created = await createGitHubRepo(repoName, input.token);
		const authUrl = buildAuthenticatedUrl(created.httpsUrl, owner, input.token);

		await this.initializeLocalRepo(basePath, authUrl, owner, input.token);
		await this.fetchRemote(basePath, owner, input.token);
		await this.reconcileRemote(basePath, owner, input.token).catch(() => {});
		await this.commitLocalChanges(basePath);
		await this.pushSafe(basePath, owner, input.token);

		return {
			success: true,
			message: `Repositorio "${repoName}" creado y sincronizado con GitHub.`,
			repoConfig: this.buildRepoConfig({
				label: repoName,
				owner,
				repo: created.repo,
				httpsUrl: created.httpsUrl,
				username: owner,
				token: input.token,
			}),
		};
	}

	/** PASO 1-B — Conectar repo existente con fusión inteligente */
	async setupExistingRepository(
		input: ExistingRepoWizardInput,
	): Promise<GitSetupResult> {
		const parsed = parseGitHubUrl(input.remoteUrl);
		const basePath = getVaultBasePath(this.app);

		const username =
			input.username.trim() || (await resolveGitHubUsername(input.token));
		const authUrl = buildAuthenticatedUrl(parsed.httpsUrl, username, input.token);

		await this.initializeLocalRepo(basePath, authUrl, username, input.token);
		await this.smartMerge(basePath, username, input.token);

		return {
			success: true,
			message: `Repositorio "${parsed.repo}" conectado con fusión inteligente completada.`,
			repoConfig: this.buildRepoConfig({
				label: parsed.repo,
				owner: parsed.owner,
				repo: parsed.repo,
				httpsUrl: parsed.httpsUrl,
				username,
				token: input.token,
			}),
		};
	}

	async clearGitSession(): Promise<void> {
		const basePath = getVaultBasePath(this.app);
		const gitDir = path.join(basePath, ".git");
		if (!fs.existsSync(gitDir)) return;

		const remotes = await git.listRemotes({ fs, dir: basePath });
		const origin = remotes.find((r) => r.remote === REMOTE_NAME);
		if (!origin?.url) return;

		const cleanUrl = this.stripCredentialsFromRemoteUrl(origin.url);
		if (cleanUrl === origin.url) return;

		await git.deleteRemote({ fs, dir: basePath, remote: REMOTE_NAME });
		await git.addRemote({
			fs,
			dir: basePath,
			remote: REMOTE_NAME,
			url: cleanUrl,
		});
	}

	private stripCredentialsFromRemoteUrl(url: string): string {
		if (url.startsWith("git@")) return url;

		try {
			const parsed = new URL(url);
			parsed.username = "";
			parsed.password = "";
			return parsed.toString();
		} catch {
			return url.replace(/^https?:\/\/[^@]+@/i, "https://");
		}
	}

	private buildRepoConfig(params: {
		label: string;
		owner: string;
		repo: string;
		httpsUrl: string;
		username: string;
		token: string;
	}): RepoConfig {
		return {
			id: `git-${params.owner}-${params.repo}`,
			role: "master",
			provider: "git",
			label: params.label,
			remoteUrl: params.httpsUrl,
			username: params.username,
			token: params.token,
			enabled: true,
		};
	}

	private onAuth(username: string, token: string) {
		return () => ({ username, password: token });
	}

	private async initializeLocalRepo(
		basePath: string,
		authUrl: string,
		username: string,
		token: string,
	): Promise<void> {
		await ensureGitIgnore(basePath);
		const gitDir = path.join(basePath, ".git");

		if (!fs.existsSync(gitDir)) {
			await git.init({ fs, dir: basePath, defaultBranch: DEFAULT_BRANCH });
		}

		const remotes = await git.listRemotes({ fs, dir: basePath });
		const origin = remotes.find((r) => r.remote === REMOTE_NAME);

		if (!origin) {
			await git.addRemote({
				fs,
				dir: basePath,
				remote: REMOTE_NAME,
				url: authUrl,
			});
		} else if (origin.url !== authUrl) {
			await git.deleteRemote({ fs, dir: basePath, remote: REMOTE_NAME });
			await git.addRemote({
				fs,
				dir: basePath,
				remote: REMOTE_NAME,
				url: authUrl,
			});
		}

		const currentBranch = await git.currentBranch({ fs, dir: basePath });
		if (currentBranch !== DEFAULT_BRANCH) {
			const branches = await git.listBranches({ fs, dir: basePath });
			if (branches.includes(DEFAULT_BRANCH)) {
				await git.checkout({ fs, dir: basePath, ref: DEFAULT_BRANCH });
			} else if (!currentBranch) {
				await git.branch({
					fs,
					dir: basePath,
					ref: DEFAULT_BRANCH,
					checkout: true,
				});
			}
		}

		await git.fetch({
			fs,
			http,
			dir: basePath,
			remote: REMOTE_NAME,
			onAuth: this.onAuth(username, token),
		});
	}

	private async smartMerge(
		basePath: string,
		username: string,
		token: string,
	): Promise<void> {
		await this.fetchRemote(basePath, username, token);

		let remoteCommit: string | undefined;
		try {
			remoteCommit = await git.resolveRef({
				fs,
				dir: basePath,
				ref: REMOTE_TRACKING_REF,
			});
		} catch {
			remoteCommit = undefined;
		}

		const localFiles = await walkVaultFiles(basePath);
		const dateStr = formatConflictDate(new Date());

		if (remoteCommit) {
			try {
				await git.merge({
					fs,
					dir: basePath,
					ours: DEFAULT_BRANCH,
					theirs: REMOTE_TRACKING_REF,
					author: AUTHOR,
				});
			} catch {
				/* fusión inicial tolerante */
			}

			await git.checkout({
				fs,
				dir: basePath,
				ref: DEFAULT_BRANCH,
				force: true,
			});

			const remoteFiles = await this.listFilesInCommit(basePath, remoteCommit);

			for (const [relativePath, remoteContent] of remoteFiles) {
				const localContent = localFiles.get(relativePath);

				if (localContent && !localContent.equals(remoteContent)) {
					const conflictPath = conflictCopyPath(relativePath, dateStr);
					await writeVaultFile(basePath, conflictPath, localContent);
					await writeVaultFile(basePath, relativePath, remoteContent);
				} else if (!localContent) {
					await writeVaultFile(basePath, relativePath, remoteContent);
				}
			}
		}

		await this.commitLocalChanges(basePath);
		await this.pushSafe(basePath, username, token);
	}

	private async fetchRemote(
		basePath: string,
		username: string,
		token: string,
	): Promise<void> {
		await git.fetch({
			fs,
			http,
			dir: basePath,
			remote: REMOTE_NAME,
			onAuth: this.onAuth(username, token),
		});
	}

	private async listFilesInCommit(
		basePath: string,
		commitOid: string,
	): Promise<Map<string, Buffer>> {
		const files = new Map<string, Buffer>();

		async function walkTree(relativeDir: string, oid: string): Promise<void> {
			const { tree } = await git.readTree({ fs, dir: basePath, oid });
			for (const entry of tree) {
				const entryPath = relativeDir
					? `${relativeDir}/${entry.path}`
					: entry.path;

				if (entry.type === "tree") {
					await walkTree(entryPath, entry.oid);
				} else if (entry.type === "blob") {
					const { blob } = await git.readBlob({
						fs,
						dir: basePath,
						oid: entry.oid,
					});
					files.set(entryPath, Buffer.from(blob));
				}
			}
		}

		const { commit } = await git.readCommit({ fs, dir: basePath, oid: commitOid });
		await walkTree("", commit.tree);
		return files;
	}
}
