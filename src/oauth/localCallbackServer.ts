import { loadNodeHttp } from "./runtimeBridge";
import { GOOGLE_DRIVE_CALLBACK_PORT } from "./googleDriveConstants";

export interface OAuthCallbackResult {
	code?: string;
	error?: string;
	errorDescription?: string;
}

/** Puerto fijo OAuth — no configurable. */
const OAUTH_PORT = GOOGLE_DRIVE_CALLBACK_PORT;

/** Timeout global si el usuario no completa la autorización (2 minutos). */
const CALLBACK_TIMEOUT_MS = 120_000;
const EADDRINUSE_RETRY_DELAY_MS = 300;
const EADDRINUSE_MAX_RETRIES = 3;

const SUCCESS_HTML =
	"<html><body><h2>Autenticación exitosa</h2><p>Puedes cerrar esta ventana y regresar a Obsidian.</p><script>setTimeout(() => { window.close(); }, 1000);</script></body></html>";

type HttpModule = NonNullable<ReturnType<typeof loadNodeHttp>>;
type HttpServer = ReturnType<HttpModule["createServer"]>;

/** Instancia HTTP activa en 127.0.0.1:42000 — una sola a la vez. */
let activeServer: HttpServer | null = null;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function forceCloseConnections(server: HttpServer): void {
	try {
		const closable = server as HttpServer & {
			closeAllConnections?: () => void;
			unref?: () => void;
		};
		closable.closeAllConnections?.();
		closable.unref?.();
	} catch {
		// Ignorar si el runtime no expone estas APIs
	}
}

/** Cierra y libera el servidor callback activo en el puerto 42000. */
export function stopServer(): Promise<void> {
	return new Promise((resolve) => {
		if (!activeServer) {
			resolve();
			return;
		}

		const server = activeServer;
		activeServer = null;
		console.log("[ObSave OAuth] Cerrando servidor callback activo (puerto 42000)");

		forceCloseConnections(server);

		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			console.log("[ObSave OAuth] Puerto 42000 liberado");
			resolve();
		};

		try {
			server.unref?.();
		} catch {
			// unref opcional
		}

		server.close(() => finish());
		setTimeout(finish, 200);
	});
}

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

function listenWithRetry(server: HttpServer, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const attemptListen = (attempt: number): void => {
			const onError = (err: NodeJS.ErrnoException): void => {
				server.removeListener("error", onError);

				if (err.code === "EADDRINUSE" && attempt < EADDRINUSE_MAX_RETRIES) {
					console.warn(
						`[ObSave OAuth] EADDRINUSE en ${host}:${OAUTH_PORT}, reintento ${attempt + 1}/${EADDRINUSE_MAX_RETRIES}`,
					);
					void stopServer()
						.then(() => sleep(EADDRINUSE_RETRY_DELAY_MS))
						.then(() => attemptListen(attempt + 1))
						.catch(reject);
					return;
				}

				reject(
					err instanceof Error
						? err
						: new Error("No se pudo iniciar el servidor OAuth local."),
				);
			};

			server.once("error", onError);
			server.listen(OAUTH_PORT, host, () => {
				server.removeListener("error", onError);
				resolve();
			});
		};

		attemptListen(0);
	});
}

/**
 * Servidor HTTP efímero exclusivamente en 127.0.0.1:42000/callback.
 */
export function waitForOAuthCallback(): Promise<OAuthCallbackResult> {
	return new Promise((resolve, reject) => {
		void (async () => {
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

			await stopServer();

			let settled = false;
			let timeoutId: ReturnType<typeof setTimeout>;

			const cleanupAndReject = (error: Error): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				void stopServer().finally(() => reject(error));
			};

			const resolveCallback = (result: OAuthCallbackResult): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				resolve(result);
			};

			const sendHtmlAndResolve = (
				response: import("http").ServerResponse,
				html: string,
				result: OAuthCallbackResult,
			): void => {
				if (settled) return;
				response.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
				});
				response.end(html, () => {
					console.log("[ObSave OAuth] Respuesta HTML enviada — cerrando puerto 42000");
					resolveCallback(result);
					void stopServer();
				});
			};

			try {
				const server = http.createServer((req, res) => {
					const reqUrl = req.url ?? "";
					if (!reqUrl.startsWith("/callback")) {
						res.writeHead(404);
						res.end("Not found");
						return;
					}

					const { code, error, errorDescription } = parseCallbackPath(reqUrl);
					console.log("[ObSave OAuth] Callback recibido en :42000", {
						hasCode: !!code,
						error: error ?? null,
					});

					if (error) {
						const message =
							errorDescription ??
							error ??
							"Autorización rechazada por Google.";
						sendHtmlAndResolve(
							res,
							buildErrorHtml(message),
							{ error, errorDescription, code },
						);
						return;
					}

					if (!code) {
						sendHtmlAndResolve(
							res,
							buildErrorHtml("Callback OAuth sin código de autorización."),
							{ error: "missing_code" },
						);
						return;
					}

					sendHtmlAndResolve(res, SUCCESS_HTML, { code });
				});

				activeServer = server;

				server.on("error", (err) => {
					const nodeErr = err as NodeJS.ErrnoException;
					if (nodeErr.code === "EADDRINUSE") {
						console.warn("[ObSave OAuth] Error EADDRINUSE en servidor activo");
						return;
					}
					cleanupAndReject(
						err instanceof Error
							? err
							: new Error("Error en servidor OAuth local."),
					);
				});

				timeoutId = setTimeout(() => {
					console.warn(
						"[ObSave OAuth] Timeout global (120s) — destruyendo servidor",
					);
					cleanupAndReject(
						new Error(
							"Tiempo de espera agotado para la autorización OAuth (2 minutos).",
						),
					);
				}, CALLBACK_TIMEOUT_MS);

				await listenWithRetry(server, "127.0.0.1");
				console.log(
					`[ObSave OAuth] Escuchando en 127.0.0.1:${OAUTH_PORT}/callback`,
				);
			} catch (error) {
				cleanupAndReject(
					error instanceof Error
						? error
						: new Error("Error al crear servidor OAuth local."),
				);
			}
		})();
	});
}
