import { requestUrl } from "obsidian";
import {
	GOOGLE_DRIVE_AUTH_URL,
	GOOGLE_DRIVE_CLIENT_ID,
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

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Conector Google Drive — OAuth2 PKCE con callback HTTP local. */
export class GoogleDriveProvider implements IStorageProvider {
	readonly id = "gdrive";
	readonly name = "Google Drive";

	private config: GoogleDriveProviderConfig | null = null;
	private refreshTimerId: number | null = null;
	private onConfigChanged: ((config: GoogleDriveProviderConfig) => void) | null =
		null;

	constructor() {}

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
	async authenticateWithPkce(): Promise<GoogleDriveProviderConfig> {
		const clientId = this.requireClientId();
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = await generateCodeChallenge(codeVerifier);
		const state = generateCodeVerifier();

		const callbackPromise = waitForOAuthCallback();
		const authUrl = this.buildAuthUrl(codeChallenge, state);

		await this.openExternal(authUrl);

		const callback = await callbackPromise;
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

		let tokens: GoogleTokenResponse;
		try {
			tokens = await this.exchangeCodeForTokens(
				callback.code,
				codeVerifier,
				clientId,
			);
		} catch (error) {
			console.error("[ObSave] Error al intercambiar código OAuth:", error);
			throw new Error("Error al conectar con Google Drive");
		}

		if (!tokens.refresh_token) {
			throw new Error(
				"Google no devolvió refresh_token. Revoca el acceso previo en tu cuenta Google e intenta de nuevo.",
			);
		}

		let userInfo: GoogleUserInfo;
		try {
			userInfo = await this.fetchUserInfo(tokens.access_token);
		} catch (error) {
			console.error("[ObSave] Error al obtener perfil Google:", error);
			throw new Error("Error al conectar con Google Drive");
		}

		const config: GoogleDriveProviderConfig = {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: Date.now() + tokens.expires_in * 1000,
			email: userInfo.email,
			displayName: userInfo.name ?? userInfo.email,
		};

		this.config = config;
		this.persistConfig(config);
		this.scheduleBackgroundRefresh();

		return config;
	}

	async sync(): Promise<SyncResult> {
		if (!this.config?.refreshToken) {
			throw new Error("Google Drive no está conectado.");
		}

		await this.ensureValidAccessToken();

		return {
			message: "ObSave: Google Drive conectado (sync de archivos en desarrollo).",
			downloadedCount: 0,
			uploadedCount: 0,
			noChanges: true,
		};
	}

	async disconnect(): Promise<void> {
		this.clearRefreshTimer();
		this.config = null;
	}

	private requireClientId(): string {
		if (!GOOGLE_DRIVE_CLIENT_ID.trim()) {
			throw new Error(
				"Client ID de Google OAuth no configurado. Define OBSAVE_GOOGLE_CLIENT_ID al compilar.",
			);
		}
		return GOOGLE_DRIVE_CLIENT_ID.trim();
	}

	private async openExternal(url: string): Promise<void> {
		await openExternalUrl(url);
	}

	async exchangeCodeForTokens(
		code: string,
		codeVerifier: string,
		clientId?: string,
	): Promise<GoogleTokenResponse> {
		const resolvedClientId = clientId ?? this.requireClientId();
		const body = new URLSearchParams({
			client_id: resolvedClientId,
			grant_type: "authorization_code",
			code,
			code_verifier: codeVerifier,
			redirect_uri: GOOGLE_DRIVE_REDIRECT_URI,
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
				`Error al intercambiar código OAuth (${response.status}): ${response.text}`,
			);
		}

		return response.json as GoogleTokenResponse;
	}

	private async refreshAccessToken(): Promise<string> {
		if (!this.config?.refreshToken) {
			throw new Error("No hay refresh_token de Google Drive.");
		}

		const body = new URLSearchParams({
			client_id: this.requireClientId(),
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

	private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
		const response = await requestUrl({
			url: GOOGLE_DRIVE_USERINFO_URL,
			method: "GET",
			headers: { Authorization: `Bearer ${accessToken}` },
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(
				`No se pudo obtener perfil Google (${response.status}).`,
			);
		}

		return response.json as GoogleUserInfo;
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
