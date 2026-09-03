/** URI de redirección registrada en Google Cloud Console (PKCE desktop). */
export const GOOGLE_DRIVE_REDIRECT_URI =
	"http://127.0.0.1:42000/callback";

export const GOOGLE_DRIVE_OAUTH_SCOPE =
	"https://www.googleapis.com/auth/drive email profile";

export const GOOGLE_DRIVE_AUTH_URL =
	"https://accounts.google.com/o/oauth2/v2/auth";

export const GOOGLE_DRIVE_TOKEN_URL =
	"https://oauth2.googleapis.com/token";

export const GOOGLE_DRIVE_USERINFO_URL =
	"https://www.googleapis.com/oauth2/v3/userinfo";

/** Puerto del servidor HTTP efímero para capturar el callback OAuth. */
export const GOOGLE_DRIVE_CALLBACK_PORT = 42000;

/**
 * Client ID OAuth 2.0 — definir `OBSAVE_GOOGLE_CLIENT_ID` al compilar.
 */
export const GOOGLE_DRIVE_CLIENT_ID: string =
	typeof __OBSAVE_GOOGLE_CLIENT_ID__ === "string"
		? __OBSAVE_GOOGLE_CLIENT_ID__
		: "";

/**
 * Client secret OAuth 2.0 — definir `OBSAVE_GOOGLE_CLIENT_SECRET` al compilar.
 */
export const GOOGLE_DRIVE_CLIENT_SECRET: string =
	typeof __OBSAVE_GOOGLE_CLIENT_SECRET__ === "string"
		? __OBSAVE_GOOGLE_CLIENT_SECRET__
		: "";
