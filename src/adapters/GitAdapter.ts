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
	getVaultFolderName,
	renameVaultFolder,
	walkVaultFiles,
	writeVaultFile,
} from "./vaultPaths";
import type { GitSetupResult, RepoConfig } from "../types";

export type { GitSetupResult };

const DEFAULT_BRANCH = "main";
const REMOTE_NAME = "origin";
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
	renameLocalToMatchRemote?: boolean;
}

export class GitAdapter {
	constructor(private app: App) {}

	/** PASO 1-A — Crear repo nuevo en GitHub y sincronizar bóveda local */
	async setupNewRepository(input: NewRepoWizardInput): Promise<GitSetupResult> {
		const repoName = input.repoName.trim();
		if (!repoName) {
			return { success: false, message: "El nombre del repositorio es obligatorio." };
		}

		const currentFolder = getVaultFolderName(this.app);
		let needsVaultReopen = false;

		if (repoName !== currentFolder) {
			await renameVaultFolder(this.app, repoName);
			needsVaultReopen = true;
		}

		const owner = input.username.trim() || (await resolveGitHubUsername(input.token));
		const created = await createGitHubRepo(repoName, input.token);
		const authUrl = buildAuthenticatedUrl(created.httpsUrl, owner, input.token);

		const basePath = needsVaultReopen
			? path.join(path.dirname(getVaultBasePath(this.app)), repoName)
			: getVaultBasePath(this.app);

		await this.initializeLocalRepo(basePath, authUrl, owner, input.token);
		await this.commitAll(basePath, "ObSave: sincronización inicial");
		await this.push(basePath, owner, input.token);

		return {
			success: true,
			message: `Repositorio "${repoName}" creado y sincronizado con GitHub.`,
			needsVaultReopen,
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

	/** Comprueba si hace falta decisión de renombrado (PASO 1-B) */
	checkExistingRepoNameMismatch(remoteUrl: string): {
		needsRenameDecision: boolean;
		localFolderName: string;
		remoteRepoName: string;
	} {
		const parsed = parseGitHubUrl(remoteUrl);
		const localFolderName = getVaultFolderName(this.app);
		return {
			needsRenameDecision: parsed.repo !== localFolderName,
			localFolderName,
			remoteRepoName: parsed.repo,
		};
	}

	/** PASO 1-B — Conectar repo existente con fusión inteligente */
	async setupExistingRepository(
		input: ExistingRepoWizardInput,
	): Promise<GitSetupResult> {
		const parsed = parseGitHubUrl(input.remoteUrl);
		const localFolder = getVaultFolderName(this.app);
		let needsVaultReopen = false;

		if (parsed.repo !== localFolder) {
			if (input.renameLocalToMatchRemote === undefined) {
				return {
					success: false,
					message: "Se requiere decisión de renombrado.",
					needsRenameDecision: true,
					localFolderName: localFolder,
					remoteRepoName: parsed.repo,
				};
			}

			if (input.renameLocalToMatchRemote) {
				await renameVaultFolder(this.app, parsed.repo);
				needsVaultReopen = true;
			}
		}

		const username =
			input.username.trim() || (await resolveGitHubUsername(input.token));
		const authUrl = buildAuthenticatedUrl(parsed.httpsUrl, username, input.token);

		const basePath = needsVaultReopen
			? path.join(path.dirname(getVaultBasePath(this.app)), parsed.repo)
			: getVaultBasePath(this.app);

		await this.initializeLocalRepo(basePath, authUrl, username, input.token);
		await this.smartMerge(basePath, username, input.token);

		return {
			success: true,
			message: `Repositorio "${parsed.repo}" conectado con fusión inteligente completada.`,
			needsVaultReopen,
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

		// Verificar conectividad
		await git.fetch({
			fs,
			http,
			dir: basePath,
			remote: REMOTE_NAME,
			onAuth: () => ({ username, password: token }),
		});
	}

	/**
	 * Fusión inteligente: Descargar remoto → resolver conflictos → Subir local
	 */
	private async smartMerge(
		basePath: string,
		username: string,
		token: string,
	): Promise<void> {
		await git.fetch({
			fs,
			http,
			dir: basePath,
			remote: REMOTE_NAME,
			onAuth: () => ({ username, password: token }),
		});

		let remoteCommit: string | undefined;
		try {
			remoteCommit = await git.resolveRef({
				fs,
				dir: basePath,
				ref: `refs/remotes/${REMOTE_NAME}/${DEFAULT_BRANCH}`,
			});
		} catch {
			remoteCommit = undefined;
		}

		const localFiles = await walkVaultFiles(basePath);
		const dateStr = formatConflictDate(new Date());

		if (!remoteCommit) {
			await this.stageAll(basePath);
			await this.commitAll(basePath, "ObSave: sincronización inicial");
			await this.push(basePath, username, token);
			return;
		}

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

		await this.stageAll(basePath);
		await this.commitAll(basePath, "ObSave: fusión inteligente");
		await this.push(basePath, username, token);
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

	private async push(
		basePath: string,
		username: string,
		token: string,
	): Promise<void> {
		await git.push({
			fs,
			http,
			dir: basePath,
			remote: REMOTE_NAME,
			ref: DEFAULT_BRANCH,
			onAuth: () => ({ username, password: token }),
		});
	}
}
