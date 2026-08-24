export interface ParsedGitHubUrl {
	owner: string;
	repo: string;
	httpsUrl: string;
}

export function parseGitHubUrl(rawUrl: string): ParsedGitHubUrl {
	const trimmed = rawUrl.trim().replace(/\.git$/i, "").replace(/\/$/, "");

	const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
	if (sshMatch) {
		const [, owner, repo] = sshMatch;
		return {
			owner,
			repo,
			httpsUrl: `https://github.com/${owner}/${repo}.git`,
		};
	}

	const httpsMatch = trimmed.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i,
	);
	if (httpsMatch) {
		const [, owner, repo] = httpsMatch;
		return {
			owner,
			repo,
			httpsUrl: `https://github.com/${owner}/${repo}.git`,
		};
	}

	throw new Error(
		"URL no válida. Use https://github.com/usuario/repo o git@github.com:usuario/repo",
	);
}

export function buildAuthenticatedUrl(
	httpsUrl: string,
	username: string,
	token: string,
): string {
	const url = new URL(httpsUrl);
	url.username = username;
	url.password = token;
	return url.toString();
}

export async function createGitHubRepo(
	repoName: string,
	token: string,
	privateRepo = true,
): Promise<ParsedGitHubUrl> {
	const response = await fetch("https://api.github.com/user/repos", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
		body: JSON.stringify({
			name: repoName,
			private: privateRepo,
			auto_init: false,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`No se pudo crear el repositorio en GitHub (${response.status}): ${body}`,
		);
	}

	const data = (await response.json()) as {
		owner: { login: string };
		name: string;
		clone_url: string;
	};

	return {
		owner: data.owner.login,
		repo: data.name,
		httpsUrl: data.clone_url,
	};
}

export async function resolveGitHubUsername(token: string): Promise<string> {
	const response = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
		},
	});

	if (!response.ok) {
		throw new Error("Token de GitHub inválido o sin permisos suficientes.");
	}

	const data = (await response.json()) as { login: string };
	return data.login;
}
