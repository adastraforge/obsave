import { parseGitHubUrl } from "../adapters/githubApi";

const GITHUB_API = "https://api.github.com";
const API_HEADERS = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
};

export interface GitHubUserInfo {
	login: string;
	name?: string;
}

export interface GitHubRepoSummary {
	id: number;
	name: string;
	fullName: string;
	owner: string;
	private: boolean;
	htmlUrl: string;
	cloneUrl: string;
	updatedAt: string;
}

export interface GitHubRemoteMarkdown {
	relativePath: string;
	sha: string;
	size?: number;
	modifiedTimeMs: number;
}

/** Contrato REST para sync con ledger (paridad con Google Drive). */
export interface CloudStorageProvider {
	listAllMarkdownFiles(): Promise<GitHubRemoteMarkdown[]>;
	downloadFile(path: string): Promise<string>;
	uploadFile(path: string, content: string, existingSha?: string): Promise<string>;
	deleteFile(path: string, sha: string): Promise<void>;
}

function authHeaders(token: string): Record<string, string> {
	return {
		...API_HEADERS,
		Authorization: `Bearer ${token}`,
	};
}

function encodePath(path: string): string {
	return path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function toBase64(content: string): string {
	return btoa(unescape(encodeURIComponent(content)));
}

function fromBase64(encoded: string): string {
	return decodeURIComponent(escape(atob(encoded)));
}

export async function validateGitHubToken(token: string): Promise<GitHubUserInfo> {
	const response = await fetch(`${GITHUB_API}/user`, {
		headers: authHeaders(token),
	});

	if (!response.ok) {
		throw new Error(
			`Token de GitHub inválido o sin permisos (${response.status}). Requiere scope repo.`,
		);
	}

	const data = (await response.json()) as { login: string; name?: string };
	return { login: data.login, name: data.name };
}

export async function createGitHubRepository(
	token: string,
	name: string,
	isPrivate: boolean,
): Promise<GitHubRepoSummary> {
	const response = await fetch(`${GITHUB_API}/user/repos`, {
		method: "POST",
		headers: {
			...authHeaders(token),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			name,
			private: isPrivate,
			auto_init: false,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`No se pudo crear el repositorio (${response.status}): ${body}`);
	}

	return mapRepo(await response.json());
}

export async function listUserRepositories(
	token: string,
): Promise<GitHubRepoSummary[]> {
	const repos: GitHubRepoSummary[] = [];
	let page = 1;

	while (page <= 5) {
		const response = await fetch(
			`${GITHUB_API}/user/repos?per_page=100&page=${page}&sort=updated`,
			{ headers: authHeaders(token) },
		);

		if (!response.ok) {
			throw new Error(`Error al listar repositorios (${response.status})`);
		}

		const batch = (await response.json()) as Record<string, unknown>[];
		if (batch.length === 0) break;

		repos.push(...batch.map(mapRepo));
		if (batch.length < 100) break;
		page++;
	}

	return repos;
}

function mapRepo(data: Record<string, unknown>): GitHubRepoSummary {
	const owner = data.owner as { login: string };
	return {
		id: data.id as number,
		name: data.name as string,
		fullName: data.full_name as string,
		owner: owner.login,
		private: data.private as boolean,
		htmlUrl: data.html_url as string,
		cloneUrl: data.clone_url as string,
		updatedAt: data.updated_at as string,
	};
}

/** Cliente GitHub REST v3 para sync ledger de notas `.md`. */
export class GitHubApiClient implements CloudStorageProvider {
	constructor(
		private token: string,
		private owner: string,
		private repo: string,
	) {}

	static fromRemoteUrl(token: string, remoteUrl: string): GitHubApiClient {
		const parsed = parseGitHubUrl(remoteUrl);
		return new GitHubApiClient(token, parsed.owner, parsed.repo);
	}

	private repoPath(path = ""): string {
		return `${GITHUB_API}/repos/${this.owner}/${this.repo}${path}`;
	}

	async listAllMarkdownFiles(): Promise<GitHubRemoteMarkdown[]> {
		const refResponse = await fetch(
			this.repoPath("/git/ref/heads/main"),
			{ headers: authHeaders(this.token) },
		);

		if (refResponse.status === 404) {
			return [];
		}

		if (!refResponse.ok) {
			throw new Error(`Error al resolver rama main (${refResponse.status})`);
		}

		const refData = (await refResponse.json()) as {
			object: { sha: string };
		};

		const treeResponse = await fetch(
			this.repoPath(`/git/trees/${refData.object.sha}?recursive=1`),
			{ headers: authHeaders(this.token) },
		);

		if (!treeResponse.ok) {
			throw new Error(`Error al listar árbol del repo (${treeResponse.status})`);
		}

		const treeData = (await treeResponse.json()) as {
			tree?: {
				path: string;
				type: string;
				sha: string;
				size?: number;
			}[];
		};

		return (treeData.tree ?? [])
			.filter(
				(entry) =>
					entry.type === "blob" &&
					entry.path.endsWith(".md") &&
					!entry.path.startsWith(".obsidian/"),
			)
			.map((entry) => ({
				relativePath: entry.path,
				sha: entry.sha,
				size: entry.size,
				modifiedTimeMs: Date.now(),
			}));
	}

	async downloadFile(path: string): Promise<string> {
		const response = await fetch(this.repoPath(`/contents/${encodePath(path)}`), {
			headers: authHeaders(this.token),
		});

		if (response.status === 404) {
			return "";
		}

		if (!response.ok) {
			throw new Error(`Error al descargar «${path}» (${response.status})`);
		}

		const data = (await response.json()) as { content?: string; encoding?: string };
		if (!data.content) return "";
		return data.encoding === "base64" ? fromBase64(data.content.replace(/\n/g, "")) : data.content;
	}

	async uploadFile(
		path: string,
		content: string,
		existingSha?: string,
	): Promise<string> {
		const body: Record<string, string> = {
			message: `chore(sync): update ${path} [ObSave]`,
			content: toBase64(content),
		};
		if (existingSha) {
			body.sha = existingSha;
		}

		const response = await fetch(this.repoPath(`/contents/${encodePath(path)}`), {
			method: "PUT",
			headers: {
				...authHeaders(this.token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Error al subir «${path}» (${response.status}): ${text}`);
		}

		const data = (await response.json()) as { content?: { sha?: string } };
		return data.content?.sha ?? existingSha ?? "";
	}

	async deleteFile(path: string, sha: string): Promise<void> {
		const response = await fetch(this.repoPath(`/contents/${encodePath(path)}`), {
			method: "DELETE",
			headers: {
				...authHeaders(this.token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				message: `chore(sync): delete ${path} [ObSave]`,
				sha,
			}),
		});

		if (!response.ok && response.status !== 404) {
			throw new Error(`Error al eliminar «${path}» (${response.status})`);
		}
	}
}
