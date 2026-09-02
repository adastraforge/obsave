import { loadNodeHttp } from "./runtimeBridge";
import { GOOGLE_DRIVE_CALLBACK_PORT } from "./googleDriveConstants";

export interface OAuthCallbackResult {
	code?: string;
	error?: string;
	errorDescription?: string;
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const SERVER_CLOSE_DELAY_MS = 1500;

const SUCCESS_HTML =
	"<html><body><h2>Autenticación exitosa</h2><p>Puedes cerrar esta ventana y regresar a Obsidian.</p><script>setTimeout(() => { window.close(); }, 1000);</script></body></html>";

function parseCallbackPath(reqUrl: string): {
	code?: string;
	error?: string;
	errorDescription?: string;
} {
	const queryIndex = reqUrl.indexOf("?");
	if (queryIndex === -1) {
		return {};
	}

	const params = new URLSearchParams(reqUrl.slice(queryIndex + 1));
	return {
		code: params.get("code") ?? undefined,
		error: params.get("error") ?? undefined,
		errorDescription: params.get("error_description") ?? undefined,
	};
}

function buildErrorHtml(message: string): string {
	const safeMessage = message
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

	return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>ObSave — Error de autenticación</title>
</head>
<body style="font-family: system-ui; text-align: center; padding: 3rem;">
<h2>No se pudo completar la autorización</h2>
<p>${safeMessage}</p>
<p>Cierra esta ventana y vuelve a Obsidian para reintentar.</p>
</body>
</html>`;
}

/**
 * Servidor HTTP efímero en 127.0.0.1:42000/callback.
 * Extrae el `code` OAuth y resuelve la promesa; el intercambio de tokens
 * ocurre en `GoogleDriveProvider.authenticateWithPkce()`.
 */
export function waitForOAuthCallback(
	port = GOOGLE_DRIVE_CALLBACK_PORT,
): Promise<OAuthCallbackResult> {
	return new Promise((resolve, reject) => {
		let http: ReturnType<typeof loadNodeHttp>;
		try {
			http = loadNodeHttp();
		} catch (error) {
			reject(
				error instanceof Error
					? error
					: new Error("No se pudo cargar el módulo http."),
			);
			return;
		}

		if (!http) {
			reject(
				new Error(
					"Servidor OAuth local no disponible (window.require/http ausente).",
				),
			);
			return;
		}

		let settled = false;
		let server: { close: () => void } | null = null;
		let timeoutId: ReturnType<typeof setTimeout>;

		const closeServerDelayed = (): void => {
			setTimeout(() => {
				server?.close();
				console.log("[ObSave OAuth] Servidor callback cerrado");
			}, SERVER_CLOSE_DELAY_MS);
		};

		const resolveCallback = (result: OAuthCallbackResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			resolve(result);
		};

		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			server?.close();
			reject(error);
		};

		const sendHtmlAndResolve = (
			response: import("http").ServerResponse,
			html: string,
			result: OAuthCallbackResult,
			delayClose: boolean,
		): void => {
			if (settled) return;
			response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			response.end(html, () => {
				console.log("[ObSave OAuth] Respuesta HTML enviada al navegador");
				resolveCallback(result);
				if (delayClose) {
					closeServerDelayed();
				} else {
					server?.close();
				}
			});
		};

		try {
			server = http.createServer((req, res) => {
				const reqUrl = req.url ?? "";
				if (!reqUrl.startsWith("/callback")) {
					res.writeHead(404);
					res.end("Not found");
					return;
				}

				const { code, error, errorDescription } = parseCallbackPath(reqUrl);
				console.log("[ObSave OAuth] Callback recibido", {
					hasCode: !!code,
					error: error ?? null,
				});

				if (error) {
					const message =
						errorDescription ?? error ?? "Autorización rechazada por Google.";
					sendHtmlAndResolve(
						res,
						buildErrorHtml(message),
						{ error, errorDescription, code },
						false,
					);
					return;
				}

				if (!code) {
					sendHtmlAndResolve(
						res,
						buildErrorHtml("Callback OAuth sin código de autorización."),
						{ error: "missing_code" },
						false,
					);
					return;
				}

				sendHtmlAndResolve(res, SUCCESS_HTML, { code }, true);
			});

			server.on("error", (err) => {
				fail(
					err instanceof Error
						? err
						: new Error("No se pudo iniciar el servidor OAuth local."),
				);
			});

			timeoutId = setTimeout(() => {
				fail(new Error("Tiempo de espera agotado para la autorización OAuth."));
			}, CALLBACK_TIMEOUT_MS);

			server.listen(port, "127.0.0.1", () => {
				console.log(
					"[ObSave OAuth] Escuchando en 127.0.0.1:" + port + "/callback",
				);
			});
		} catch (error) {
			fail(
				error instanceof Error
					? error
					: new Error("Error al crear servidor OAuth local."),
			);
		}
	});
}
