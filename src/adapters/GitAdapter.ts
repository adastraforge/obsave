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
	ensureGitIgnore,
	getVaultBasePath,
	resolveRepoLabel,
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
	 * Sync Git — Last-Write-Wins, sin duplicación de archivos:
	 * a) fetch  b) merge+checkout remoto  c) commit local  d) push (+ reintento)
	 */
	async performSync(masterRepo: RepoConfig): Promise<SyncPerformResult> {
		const basePath = getVaultBasePath(this.app);
		const username = masterRepo.username ?? "";
		const token = masterRepo.token ?? "";

		if (!token) {
			throw new Error("No hay token de GitHub configurado.");
		}

		await this.ensureRepoReady(basePath, masterRepo, username, token);

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

		const downloadedCount = await this.integrateRemoteChanges(
			basePath,
			username,
			token,
		);
		const uploadedCount = await this.commitLocalChanges(basePath);
		const pushed = await this.pushWithRetry(basePath, username, token);

		const message = this.buildSyncMessage(uploadedCount, downloadedCount, pushed);
		console.log(`[ObSave] ${message}`);

		return {
			message,
			downloadedCount,
			uploadedCount,
			noChanges: uploadedCount === 0 && downloadedCount === 0 && !pushed,
		};
	}

	private buildSyncMessage(
		uploaded: number,
		downloaded: number,
		pushed: boolean,
	): string {
		if (uploaded === 0 && downloaded === 0 && !pushed) {
			return "ObSave: Bóveda al día (sin cambios)";
		}

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

		return parts.length > 0
			? `ObSave: ${parts.join(". ")}`
			: "ObSave: Bóveda al día (sin cambios)";
	}

	/** b) Integrar commits remotos: merge (no FF) + checkout force + LWW en conflictos */
	private async integrateRemoteChanges(
		basePath: string,
		username: string,
		token: string,
	): Promise<number> {
		const localHeadBefore = await this.resolveRefSafe(basePath, LOCAL_HEAD_REF);
		const remoteHead = await this.resolveRefSafe(basePath, REMOTE_TRACKING_REF);

		if (!remoteHead || localHeadBefore === remoteHead) return 0;

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
				fastForwardOnly: false,
				author: AUTHOR,
			});
		} catch (mergeError) {
			console.warn("[ObSave] Merge conflictivo — aplicando Last-Write-Wins:", mergeError);
			await this.applyLastWriteWins(basePath, remoteHead);
			await this.commitLocalChanges(basePath, "sync: last-write-wins merge");
		}

		await git.checkout({
			fs,
			dir: basePath,
			ref: DEFAULT_BRANCH,
			force: true,
		});

		console.log(
			`[ObSave] Remoto integrado: ${downloadedCount} cambio(s), rutas originales preservadas`,
		);
		return downloadedCount;
	}

	/**
	 * Last-Write-Wins: gana la versión con timestamp más reciente.
	 * Escribe siempre en la ruta original — sin prefijos [Local]/[Sync].
	 */
	private async applyLastWriteWins(
		basePath: string,
		remoteHead: string,
	): Promise<void> {
		const { commit } = await git.readCommit({ fs, dir: basePath, oid: remoteHead });
		const remoteTimeMs = commit.committer.timestamp * 1000;
		const remoteFiles = await this.listFilesInCommit(basePath, remoteHead);

		for (const [filePath, remoteContent] of remoteFiles) {
			if (!this.shouldTrackPath(filePath)) continue;

			const fullPath = path.join(basePath, filePath);
			let useRemote = true;

			if (fs.existsSync(fullPath)) {
				const localMtime = fs.statSync(fullPath).mtimeMs;
				useRemote = remoteTimeMs >= localMtime;
			}

			if (useRemote) {
				await writeVaultFile(basePath, filePath, remoteContent);
			}
		}
	}

	/** c) Escanea, stagea y commitea cambios locales pendientes */
	private async commitLocalChanges(
		basePath: string,
		message?: string,
	): Promise<number> {
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
			message: message ?? `sync: auto-commit local [${timestamp}]`,
			author: AUTHOR,
		});

		console.log(`[ObSave] ${stagedCount} archivo(s) commiteados localmente`);
		return stagedCount;
	}

	/** d) Push con reintento: fetch + merge + push ante PushRejected */
	private async pushWithRetry(
		basePath: string,
		username: string,
		token: string,
	): Promise<boolean> {
		const auth = this.onAuth(username, token);

		if (!(await this.shouldPush(basePath))) {
			return false;
		}

		try {
			await git.push({
				fs,
				http,
				dir: basePath,
				remote: REMOTE_NAME,
				ref: DEFAULT_BRANCH,
				onAuth: auth,
			});
			console.log("[ObSave] Push completado");
			return true;
		} catch (pushError) {
			console.warn("[ObSave] Push rechazado, reintentando tras merge:", pushError);
			await this.fetchRemote(basePath, username, token);
			await this.integrateRemoteChanges(basePath, username, token);
			await this.commitLocalChanges(basePath);

			await git.push({
				fs,
				http,
				dir: basePath,
				remote: REMOTE_NAME,
				ref: DEFAULT_BRANCH,
				onAuth: auth,
			});
			console.log("[ObSave] Push completado tras reconciliación");
			return true;
		}
	}

	private async shouldPush(basePath: string): Promise<boolean> {
		const localHead = await this.resolveRefSafe(basePath, LOCAL_HEAD_REF);
		const remoteHead = await this.resolveRefSafe(basePath, REMOTE_TRACKING_REF);

		if (!localHead) return false;
		if (!remoteHead) return true;
		if (localHead === remoteHead) return false;

		const mergeBase = await git
			.findMergeBase({ fs, dir: basePath, oids: [localHead, remoteHead] })
			.catch(() => []);

		if (mergeBase.length > 0 && mergeBase[0] === localHead) {
			return false;
		}

		return true;
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
		await this.integrateRemoteChanges(basePath, owner, input.token);
		await this.commitLocalChanges(basePath);
		await this.pushWithRetry(basePath, owner, input.token);

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

	async setupExistingRepository(
		input: ExistingRepoWizardInput,
	): Promise<GitSetupResult> {
		const parsed = parseGitHubUrl(input.remoteUrl);
		const basePath = getVaultBasePath(this.app);
		const username =
			input.username.trim() || (await resolveGitHubUsername(input.token));
		const authUrl = buildAuthenticatedUrl(parsed.httpsUrl, username, input.token);

		await this.initializeLocalRepo(basePath, authUrl, username, input.token);
		await this.fetchRemote(basePath, username, input.token);
		await this.integrateRemoteChanges(basePath, username, input.token);
		await this.commitLocalChanges(basePath);
		await this.pushWithRetry(basePath, username, input.token);

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
