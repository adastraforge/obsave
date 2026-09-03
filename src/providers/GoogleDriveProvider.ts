import { Notice, requestUrl } from "obsidian";
import {
	GOOGLE_DRIVE_AUTH_URL,
	GOOGLE_DRIVE_CLIENT_ID,
	GOOGLE_DRIVE_CLIENT_SECRET,
	GOOGLE_DRIVE_OAUTH_SCOPE,
	GOOGLE_DRIVE_REDIRECT_URI,
	GOOGLE_DRIVE_TOKEN_URL,
	GOOGLE_DRIVE_USERINFO_URL,
} from "../oauth/googleDriveConstants";
import { waitForOAuthCallback } from "../oauth/localCallbackServer";
import { generateCodeChallenge, generateCodeVerifier } from "../oauth/pkce";
import { openExternalUrl } from "../oauth/runtimeBridge";
import type { GoogleDriveProviderConfig } from "../settings";
import type { IStorageProvider, SyncResult } from "./IStorageProvider";

interface GoogleTokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	token_type: string;
}

interface GoogleUserInfo {
	email?: string;
	name?: string;
}

interface GoogleOAuthErrorBody {
	error?: string;
	error_description?: string;
}

/** Hooks opcionales para persistir estado y refrescar UI tras OAuth exitoso. */
export interface GoogleDriveAuthContext {
	onAuthSuccess: (config: GoogleDriveProviderConfig) => Promise<void>;
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export interface GoogleDriveFolderInfo {
	folderId: string;
	folderPath: string;
	folderName: string;
}

export interface GoogleDriveRemoteFile {
	id: string;
	name: string;
}

const GOOGLE_CREDENTIALS_ERROR =
	"Credenciales de Google no inyectadas en la compilación. Revisa GitHub Secrets.";

function parseTokenEndpointError(
	status: number,
	responseText: string,
): string {
	let errorData: GoogleOAuthErrorBody = {};
	try {
		errorData = JSON.parse(responseText) as GoogleOAuthErrorBody;
	} catch {
		// cuerpo no JSON
	}
	const detail =
		errorData.error_description ||
		errorData.error ||
		responseText ||
		String(status);
	return `Google OAuth [${status}]: ${detail}`;
}

/** Form body intercambio de tokens PKCE + client_secret inyectado en build. */
function buildTokenExchangeBody(
	clientId: string,
	clientSecret: string,
	code: string,
	codeVerifier: string,
): string {
	const bodyParams = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret || "",
		code,
		grant_type: "authorization_code",
		redirect_uri: GOOGLE_DRIVE_REDIRECT_URI,
		code_verifier: codeVerifier,
	});
	return bodyParams.toString();
}

const DEFAULT_USER_PROFILE: GoogleUserInfo = {
	email: "Cuenta Conectada",
	name: "Google Drive User",
};

const TOKEN_EXCHANGE_FIELD_NAMES = [
	"client_id",
	"client_secret",
	"code",
	"grant_type",
	"redirect_uri",
	"code_verifier",
] as const;

/** Conector Google Drive — OAuth2 PKCE con callback HTTP local. */
export class GoogleDriveProvider implements IStorageProvider {
	readonly id = "gdrive";
	readonly name = "Google Drive";

	private config: GoogleDriveProviderConfig | null = null;
	private refreshTimerId: number | null = null;
	private onConfigChanged: ((config: GoogleDriveProviderConfig) => void) | null =
		null;
	private authContext: GoogleDriveAuthContext | null = null;

	constructor() {}

	setAuthContext(context: GoogleDriveAuthContext | null): void {
		this.authContext = context;
	}

	setConfigChangeListener(
		listener: ((config: GoogleDriveProviderConfig) => void) | null,
	): void {
		this.onConfigChanged = listener;
	}

	getConfig(): GoogleDriveProviderConfig | null {
		return this.config;
	}

	async connect(config: GoogleDriveProviderConfig): Promise<boolean> {
		if (!config.refreshToken && !config.accessToken) {
			return false;
		}
		this.config = config;
		this.scheduleBackgroundRefresh();
		return true;
	}

	buildAuthUrl(codeChallenge: string, state: string): string {
		const params = new URLSearchParams({
			client_id: this.requireClientId(),
			redirect_uri: GOOGLE_DRIVE_REDIRECT_URI,
			response_type: "code",
			scope: GOOGLE_DRIVE_OAUTH_SCOPE,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			access_type: "offline",
			prompt: "consent",
			state,
		});
		return `${GOOGLE_DRIVE_AUTH_URL}?${params.toString()}`;
	}

	/** Flujo completo: PKCE → navegador → callback → tokens → perfil. */
	async authenticateWithPkce(
		authContext?: GoogleDriveAuthContext,
	): Promise<GoogleDriveProviderConfig> {
		try {
			if (authContext) {
				this.authContext = authContext;
			}

			const { clientId } = this.requireGoogleCredentials();

			console.log("[ObSave OAuth] Iniciando flujo PKCE");

			console.log("[ObSave OAuth] Generando PKCE verifier y challenge...");
			const codeVerifier = generateCodeVerifier();
			const codeChallenge = await generateCodeChallenge(codeVerifier);
			const state = generateCodeVerifier();

			const callbackPromise = waitForOAuthCallback();
			const authUrl = this.buildAuthUrl(codeChallenge, state);

			console.log("[ObSave OAuth] Abriendo URL de autorización:", authUrl);
			console.log("[ObSave OAuth] Esperando respuesta en el puerto 42000...");
			await this.openExternal(authUrl);

			const callback = await callbackPromise;
			console.log("[ObSave OAuth] Callback procesado", {
				hasCode: !!callback.code,
				error: callback.error ?? null,
			});

			if (callback.error) {
				throw new Error(
					callback.errorDescription ??
						callback.error ??
						"Autorización rechazada por Google.",
				);
			}

			if (!callback.code) {
				throw new Error("No se recibió código de autorización.");
			}

			console.log("[ObSave OAuth] Intercambiando code por tokens");
			const tokens = await this.exchangeCodeForTokens(
				callback.code,
				codeVerifier,
				clientId,
			);
			console.log("[ObSave OAuth] Tokens recibidos", {
				hasAccessToken: !!tokens.access_token,
				hasRefreshToken: !!tokens.refresh_token,
				expiresIn: tokens.expires_in,
			});

			if (!tokens.refresh_token) {
				console.warn("[ObSave OAuth] Google no devolvió refresh_token");
				throw new Error(
					"Google no devolvió refresh_token. Revoca el acceso previo en tu cuenta Google e intenta de nuevo.",
				);
			}

			console.log("[ObSave OAuth] Obteniendo perfil de usuario");
			const userProfile = await this.fetchUserProfile(tokens.access_token);
			console.log("[ObSave OAuth] Perfil obtenido", {
				email: userProfile.email,
				name: userProfile.name,
				accountEmail: userProfile.accountEmail ?? null,
			});

			const config: GoogleDriveProviderConfig = {
				enabled: true,
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
				expiresAt: Date.now() + tokens.expires_in * 1000,
				email: userProfile.email,
				displayName: userProfile.name,
				accountEmail: userProfile.accountEmail,
			};

			this.config = config;
			this.persistConfig(config);
			this.scheduleBackgroundRefresh();

			console.log(
				"[ObSave OAuth] Autenticación completada — persistiendo estado",
			);

			if (this.authContext) {
				await this.authContext.onAuthSuccess(config);
			}

			return config;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error("[ObSave OAuth] authenticateWithPkce:", e);
			new Notice("Error en OAuth: " + message);
			throw e instanceof Error ? e : new Error(message);
		}
	}

	async sync(): Promise<SyncResult> {
		if (!this.config?.refreshToken) {
			throw new Error("Google Drive no está conectado.");
		}

		await this.ensureValidAccessToken();

		return {
			message: "¡Sincronización completada exitosamente!",
			downloadedCount: 0,
			uploadedCount: 0,
			noChanges: true,
		};
	}

	/** Lista carpetas accesibles en Drive (scope drive.file). */
	async listFolders(): Promise<{ id: string; name: string }[]> {
		const token = await this.ensureValidAccessToken();
		const query = encodeURIComponent(
			"mimeType='application/vnd.google-apps.folder' and trashed=false",
		);

		const response = await requestUrl({
			url: `${GOOGLE_DRIVE_API}/files?q=${query}&fields=files(id,name)&pageSize=200&orderBy=name`,
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(
				`Error al listar carpetas Drive (${response.status}): ${response.text}`,
			);
		}

		const data = response.json as { files?: { id: string; name: string }[] };
		return data.files ?? [];
	}

	/**
	 * Resuelve la carpeta destino según folderMode:
	 * - `new`: busca o crea carpeta por nombre.
	 * - `existing`: usa folderId seleccionado en el modal.
	 */
	async getOrCreateTargetFolder(): Promise<GoogleDriveFolderInfo> {
		if (!this.config) {
			throw new Error("Google Drive no está configurado.");
		}

		const mode = this.config.folderMode ?? "new";

		if (mode === "existing") {
			if (!this.config.folderSelected || !this.config.folderId) {
				throw new Error(
					"Selecciona una carpeta de Google Drive antes de sincronizar.",
				);
			}

			const name =
				this.config.folderPath?.replace(/^\//, "") ??
				this.config.folderName ??
				"Carpeta";

			return {
				folderId: this.config.folderId,
				folderPath: this.config.folderPath ?? `/${name}`,
				folderName: name,
			};
		}

		const folderName = (
			this.config.folderName?.trim() || "ObSave Vault"
		).slice(0, 255);

		const token = await this.ensureValidAccessToken();

		if (this.config.folderId) {
			return {
				folderId: this.config.folderId,
				folderPath: this.config.folderPath ?? `/${folderName}`,
				folderName,
			};
		}

		const escapedName = folderName.replace(/'/g, "\\'");
		const searchQuery = encodeURIComponent(
			`mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false`,
		);

		const searchResponse = await requestUrl({
			url: `${GOOGLE_DRIVE_API}/files?q=${searchQuery}&fields=files(id,name)&pageSize=1`,
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			throw: false,
		});

		if (searchResponse.status === 200) {
			const searchData = searchResponse.json as {
				files?: { id: string; name: string }[];
			};
			const existing = searchData.files?.[0];
			if (existing) {
				const info: GoogleDriveFolderInfo = {
					folderId: existing.id,
					folderPath: `/${existing.name}`,
					folderName: existing.name,
				};
				this.updateFolderConfig(info);
				return info;
			}
		}

		const createResponse = await requestUrl({
			url: `${GOOGLE_DRIVE_API}/files`,
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: folderName,
				mimeType: "application/vnd.google-apps.folder",
			}),
			throw: false,
		});

		if (createResponse.status >= 400) {
			throw new Error(
				`Error al crear carpeta en Drive (${createResponse.status}): ${createResponse.text}`,
			);
		}

		const created = createResponse.json as { id: string; name: string };
		const info: GoogleDriveFolderInfo = {
			folderId: created.id,
			folderPath: `/${created.name}`,
			folderName: created.name,
		};
		this.updateFolderConfig(info);
		return info;
	}

	/** Lista archivos no-carpeta dentro de la carpeta destino. */
	async listFiles(folderId: string): Promise<GoogleDriveRemoteFile[]> {
		const token = await this.ensureValidAccessToken();
		const query = encodeURIComponent(
			`'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
		);

		const response = await requestUrl({
			url: `${GOOGLE_DRIVE_API}/files?q=${query}&fields=files(id,name)&pageSize=500`,
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(
				`Error al listar archivos Drive (${response.status}): ${response.text}`,
			);
		}

		const data = response.json as { files?: GoogleDriveRemoteFile[] };
		return data.files ?? [];
	}

	/**
	 * Sube o actualiza un archivo en la carpeta destino.
	 * `driveFileName` es el nombre plano en Drive (sin barras).
	 */
	async uploadFile(
		driveFileName: string,
		content: string,
		folderId: string,
		existingFileId?: string,
	): Promise<void> {
		const token = await this.ensureValidAccessToken();

		if (existingFileId) {
			const response = await requestUrl({
				url: `${GOOGLE_DRIVE_UPLOAD_API}/files/${existingFileId}?uploadType=media`,
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "text/markdown; charset=utf-8",
				},
				body: content,
				throw: false,
			});

			if (response.status >= 400) {
				throw new Error(
					`Error al actualizar «${driveFileName}» (${response.status}): ${response.text}`,
				);
			}
			return;
		}

		const metadata = {
			name: driveFileName,
			mimeType: "text/markdown",
			parents: [folderId],
		};

		const boundary = "obsave_gdrive_boundary";
		const body =
			`--${boundary}\r\n` +
			"Content-Type: application/json; charset=UTF-8\r\n\r\n" +
			`${JSON.stringify(metadata)}\r\n` +
			`--${boundary}\r\n` +
			"Content-Type: text/markdown; charset=utf-8\r\n\r\n" +
			`${content}\r\n` +
			`--${boundary}--`;

		const response = await requestUrl({
			url: `${GOOGLE_DRIVE_UPLOAD_API}/files?uploadType=multipart`,
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": `multipart/related; boundary=${boundary}`,
			},
			body,
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(
				`Error al subir «${driveFileName}» (${response.status}): ${response.text}`,
			);
		}
	}

	private updateFolderConfig(info: GoogleDriveFolderInfo): void {
		if (!this.config) return;

		const updated: GoogleDriveProviderConfig = {
			...this.config,
			folderId: info.folderId,
			folderPath: info.folderPath,
			folderName: info.folderName,
			folderSelected: true,
		};
		this.config = updated;
		this.persistConfig(updated);
	}

	async disconnect(): Promise<void> {
		this.clearRefreshTimer();
		this.config = null;
	}

	private requireGoogleCredentials(): {
		clientId: string;
		clientSecret: string;
	} {
		if (
			!GOOGLE_DRIVE_CLIENT_ID.trim() ||
			!GOOGLE_DRIVE_CLIENT_SECRET.trim()
		) {
			throw new Error(GOOGLE_CREDENTIALS_ERROR);
		}
		return {
			clientId: GOOGLE_DRIVE_CLIENT_ID.trim(),
			clientSecret: GOOGLE_DRIVE_CLIENT_SECRET.trim(),
		};
	}

	private requireClientId(): string {
		return this.requireGoogleCredentials().clientId;
	}

	private requireClientSecret(): string {
		return this.requireGoogleCredentials().clientSecret;
	}

	private async openExternal(url: string): Promise<void> {
		await openExternalUrl(url);
	}

	async exchangeCodeForTokens(
		code: string,
		codeVerifier: string,
		clientId?: string,
	): Promise<GoogleTokenResponse> {
		const { clientId: resolvedClientId, clientSecret } =
			clientId != null
				? {
						clientId,
						clientSecret: this.requireGoogleCredentials().clientSecret,
					}
				: this.requireGoogleCredentials();

		console.log("[ObSave OAuth] Solicitando tokens con el code recibido...");

		const body = buildTokenExchangeBody(
			resolvedClientId,
			clientSecret,
			code,
			codeVerifier,
		);

		console.log(
			"[ObSave OAuth] Payload token exchange:",
			TOKEN_EXCHANGE_FIELD_NAMES.join(", "),
			"| client_secret:",
			clientSecret ? "[presente]" : "[vacío]",
		);

		const response = await requestUrl({
			url: GOOGLE_DRIVE_TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			throw: false,
		});

		console.log("[ObSave OAuth] Respuesta token endpoint", {
			status: response.status,
		});

		if (response.status !== 200) {
			const responseText = response.text;
			const message = parseTokenEndpointError(response.status, responseText);
			console.error("[ObSave Token Error Body]", responseText);
			throw new Error(message);
		}

		const tokens = response.json as GoogleTokenResponse;
		console.log("[ObSave OAuth] Tokens PKCE recibidos (HTTP 200)", {
			hasAccessToken: !!tokens.access_token,
			hasRefreshToken: !!tokens.refresh_token,
		});

		return tokens;
	}

	private async refreshAccessToken(): Promise<string> {
		if (!this.config?.refreshToken) {
			throw new Error("No hay refresh_token de Google Drive.");
		}

		const body = new URLSearchParams({
			client_id: this.requireClientId(),
			client_secret: this.requireClientSecret() || "",
			grant_type: "refresh_token",
			refresh_token: this.config.refreshToken,
		}).toString();

		const response = await requestUrl({
			url: GOOGLE_DRIVE_TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(
				`Error al renovar token Google (${response.status}): ${response.text}`,
			);
		}

		const tokens = response.json as GoogleTokenResponse;
		const updated: GoogleDriveProviderConfig = {
			...this.config,
			accessToken: tokens.access_token,
			expiresAt: Date.now() + tokens.expires_in * 1000,
			refreshToken: tokens.refresh_token ?? this.config.refreshToken,
		};

		this.config = updated;
		this.persistConfig(updated);
		this.scheduleBackgroundRefresh();

		console.log("[ObSave] Token Google Drive renovado en segundo plano");
		return tokens.access_token;
	}

	private async ensureValidAccessToken(): Promise<string> {
		if (!this.config?.accessToken) {
			return this.refreshAccessToken();
		}

		const expiresAt = this.config.expiresAt ?? 0;
		if (Date.now() >= expiresAt - TOKEN_REFRESH_MARGIN_MS) {
			return this.refreshAccessToken();
		}

		return this.config.accessToken;
	}

	private async fetchUserProfile(accessToken: string): Promise<{
		email: string;
		name: string;
		accountEmail?: string;
	}> {
		const response = await requestUrl({
			url: GOOGLE_DRIVE_USERINFO_URL,
			method: "GET",
			headers: { Authorization: `Bearer ${accessToken}` },
			throw: false,
		});

		if (response.status !== 200) {
			console.warn(
				`[ObSave OAuth] userinfo respondió ${response.status} — perfil por defecto`,
			);
			return { ...DEFAULT_USER_PROFILE };
		}

		const data = response.json as GoogleUserInfo;
		const accountEmail = data.email?.trim() || undefined;

		return {
			email: accountEmail ?? DEFAULT_USER_PROFILE.email!,
			name: data.name?.trim() || DEFAULT_USER_PROFILE.name!,
			accountEmail,
		};
	}

	private persistConfig(config: GoogleDriveProviderConfig): void {
		this.onConfigChanged?.(config);
	}

	private scheduleBackgroundRefresh(): void {
		this.clearRefreshTimer();

		if (!this.config?.expiresAt || !this.config.refreshToken) {
			return;
		}

		const delay = Math.max(
			0,
			this.config.expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS,
		);

		this.refreshTimerId = window.setTimeout(() => {
			void this.refreshAccessToken().catch((error) => {
				console.warn("[ObSave] Renovación automática Google Drive falló:", error);
			});
		}, delay);
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimerId !== null) {
			window.clearTimeout(this.refreshTimerId);
			this.refreshTimerId = null;
		}
	}
}
