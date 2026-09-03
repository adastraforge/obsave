import { loadNodeHttp } from "./runtimeBridge";
import { GOOGLE_DRIVE_CALLBACK_PORT } from "./googleDriveConstants";

export interface OAuthCallbackResult {
	code?: string;
	error?: string;
	errorDescription?: string;
}

export type OAuthCallbackProvider = "gdrive" | "github";

/** Puerto fijo OAuth — no configurable. */
const OAUTH_PORT = GOOGLE_DRIVE_CALLBACK_PORT;

/** Timeout global si el usuario no completa la autorización (2 minutos). */
const CALLBACK_TIMEOUT_MS = 120_000;
const EADDRINUSE_RETRY_DELAY_MS = 300;
const EADDRINUSE_MAX_RETRIES = 3;

const PROVIDER_BRANDING: Record<
	OAuthCallbackProvider,
	{ name: string; logoUrl: string }
> = {
	gdrive: {
		name: "Google Drive",
		logoUrl:
			"https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png",
	},
	github: {
		name: "GitHub",
		logoUrl:
			"https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
	},
};

const AUTO_CLOSE_SCRIPT = `<script>
(function () {
  var manualMsg = document.getElementById("manual-close-msg");
  function showManualClose() {
    if (manualMsg) manualMsg.classList.add("is-visible");
  }
  setTimeout(function () {
    window.opener = null;
    window.open("", "_self", "");
    window.close();
    setTimeout(function () {
      try {
        if (!window.closed) showManualClose();
      } catch (e) {
        showManualClose();
      }
    }, 400);
  }, 1200);
})();
</script>`;

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

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function buildCallbackPage(options: {
	title: string;
	subtitle: string;
	provider: OAuthCallbackProvider;
	isError?: boolean;
	errorMessage?: string;
	showAutoClose?: boolean;
}): string {
	const brand = PROVIDER_BRANDING[options.provider];
	const bodyExtra = options.isError
		? `<p class="error-detail">${escapeHtml(options.errorMessage ?? "Error desconocido.")}</p>`
		: "";

	const autoCloseBlock = options.showAutoClose ? AUTO_CLOSE_SCRIPT : "";
	const manualCloseBlock = options.showAutoClose
		? `<p id="manual-close-msg" class="manual-close">¡Conexión completada! Ya puedes cerrar esta pestaña y regresar a Obsidian.</p>`
		: "";
	const closeButtonBlock = options.isError
		? `<button type="button" onclick="window.close()">Cerrar pestaña</button>`
		: "";

	return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ObSave — ${escapeHtml(options.title)}</title>
<style>
  :root {
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(160deg, #0f1117 0%, #1a1d27 50%, #12141c 100%);
    color: #e8eaed;
    padding: 2rem;
  }
  .card {
    max-width: 420px;
    width: 100%;
    text-align: center;
    padding: 2.5rem 2rem;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
  }
  .logo {
    width: 64px;
    height: 64px;
    object-fit: contain;
    margin-bottom: 1.25rem;
  }
  h1 {
    font-size: 1.35rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
    line-height: 1.35;
  }
  .subtitle {
    font-size: 0.95rem;
    color: #9aa0a6;
    margin: 0 0 1.5rem;
    line-height: 1.5;
  }
  .error-detail {
    font-size: 0.9rem;
    color: #f28b82;
    margin: 0 0 1.25rem;
    line-height: 1.45;
  }
  button {
    appearance: none;
    border: none;
    border-radius: 8px;
    padding: 10px 22px;
    font-size: 0.92rem;
    font-weight: 500;
    cursor: pointer;
    background: #8ab4f8;
    color: #0f1117;
    transition: background 0.15s ease;
  }
  button:hover { background: #aecbfa; }
  .provider-tag {
    display: inline-block;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9aa0a6;
    margin-bottom: 0.5rem;
  }
  .manual-close {
    display: none;
    font-size: 0.95rem;
    color: #81c995;
    margin: 0 0 0.5rem;
    line-height: 1.5;
    font-weight: 500;
  }
  .manual-close.is-visible {
    display: block;
  }
</style>
</head>
<body>
  <div class="card">
    <img class="logo" src="${brand.logoUrl}" alt="${escapeHtml(brand.name)}" width="64" height="64">
    <div class="provider-tag">${escapeHtml(brand.name)}</div>
    <h1>${escapeHtml(options.title)}</h1>
    <p class="subtitle">${escapeHtml(options.subtitle)}</p>
    ${bodyExtra}
    ${manualCloseBlock}
    ${closeButtonBlock}
  </div>
  ${autoCloseBlock}
</body>
</html>`;
}

function buildSuccessHtml(provider: OAuthCallbackProvider = "gdrive"): string {
	return buildCallbackPage({
		title: "¡Conexión Exitosa con ObSave!",
		subtitle: "Puedes cerrar esta pestaña y volver a Obsidian",
		provider,
		showAutoClose: true,
	});
}

function buildErrorHtml(
	message: string,
	provider: OAuthCallbackProvider = "gdrive",
): string {
	return buildCallbackPage({
		title: "No se pudo completar la autorización",
		subtitle: "Cierra esta ventana y vuelve a Obsidian para reintentar.",
		provider,
		isError: true,
		errorMessage: message,
		showAutoClose: false,
	});
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
export function waitForOAuthCallback(
	provider: OAuthCallbackProvider = "gdrive",
): Promise<OAuthCallbackResult> {
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
							buildErrorHtml(message, provider),
							{ error, errorDescription, code },
						);
						return;
					}

					if (!code) {
						sendHtmlAndResolve(
							res,
							buildErrorHtml(
								"Callback OAuth sin código de autorización.",
								provider,
							),
							{ error: "missing_code" },
						);
						return;
					}

					sendHtmlAndResolve(res, buildSuccessHtml(provider), { code });
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
