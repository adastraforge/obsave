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
	resolveRepoLabel,
	walkVaultFiles,
	writeVaultFile,
} from "./vaultPaths";
import type { GitSetupResult, RepoConfig } from "../types";

export type { GitSetupResult };

const DEFAULT_BRANCH = "main";
const REMOTE_NAME = "origin";
const REMOTE_TRACKING_REF = `refs/remotes/${REMOTE_NAME}/${DEFAULT_BRANCH}`;
const AUTHOR = {
	name: "ObSave",
	email: "obsave@adastraforge.local",
};

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
		await this.commitAll(basePath, "ObSave: sincronización inicial");
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

	/** Limpia credenciales del remoto origin en .git (sin borrar el repo local) */
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

	/**
	 * Fusión inteligente: fetch → merge remoto → reconciliar archivos → push seguro
	 */
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
			await this.mergeRemoteBranch(basePath, username, token);

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

		await this.stageAll(basePath);
		await this.commitAll(basePath, "ObSave: fusión inteligente");
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

	/** Integra commits remotos antes de push para evitar rechazos non-fast-forward */
	private async mergeRemoteBranch(
		basePath: string,
		username: string,
		token: string,
	): Promise<void> {
		await this.fetchRemote(basePath, username, token);

		let hasRemote = false;
		try {
			await git.resolveRef({ fs, dir: basePath, ref: REMOTE_TRACKING_REF });
			hasRemote = true;
		} catch {
			hasRemote = false;
		}

		if (!hasRemote) return;

		const currentBranch = await git.currentBranch({ fs, dir: basePath });
		if (!currentBranch) {
			await git.checkout({ fs, dir: basePath, ref: DEFAULT_BRANCH });
		}

		try {
			await git.merge({
				fs,
				dir: basePath,
				ours: DEFAULT_BRANCH,
				theirs: REMOTE_TRACKING_REF,
				author: AUTHOR,
			});
		} catch {
			// Conflicto a nivel Git: conservar working tree y crear commit de reconciliación
			await this.stageAll(basePath);
			await this.commitAll(basePath, "ObSave: reconciliación con remoto");
		}
	}

	private async pushSafe(
		basePath: string,
		username: string,
		token: string,
	): Promise<void> {
		await this.mergeRemoteBranch(basePath, username, token);
		await this.stageAll(basePath);
		await this.commitAll(basePath, "ObSave: sincronización");

		const auth = this.onAuth(username, token);

		try {
			await git.push({
				fs,
				http,
				dir: basePath,
				remote: REMOTE_NAME,
				ref: DEFAULT_BRANCH,
				onAuth: auth,
			});
			return;
		} catch (firstError) {
			await this.fetchRemote(basePath, username, token);
			await this.mergeRemoteBranch(basePath, username, token);
			await this.stageAll(basePath);
			await this.commitAll(basePath, "ObSave: integración remota post-rechazo");

			try {
				await git.push({
					fs,
					http,
					dir: basePath,
					remote: REMOTE_NAME,
					ref: DEFAULT_BRANCH,
					onAuth: auth,
				});
				return;
			} catch {
				throw firstError instanceof Error
					? firstError
					: new Error("Push rechazado: no se pudo integrar con el remoto.");
			}
		}
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

	private async stageAll(basePath: string): Promise<void> {
		const files = await walkVaultFiles(basePath);
		for (const relativePath of files.keys()) {
			await git.add({ fs, dir: basePath, filepath: relativePath });
		}

		const gitignorePath = path.join(basePath, ".gitignore");
		if (fs.existsSync(gitignorePath)) {
			await git.add({ fs, dir: basePath, filepath: ".gitignore" });
		}
	}

	private async commitAll(basePath: string, message: string): Promise<void> {
		const status = await git.statusMatrix({ fs, dir: basePath });
		const hasChanges = status.some((row) => row[1] !== row[2] || row[2] !== row[3]);

		if (!hasChanges) return;

		await git.commit({
			fs,
			dir: basePath,
			message,
			author: AUTHOR,
		});
	}
}
