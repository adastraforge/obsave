import { loadNodeHttp } from "./runtimeBridge";
import { GOOGLE_DRIVE_CALLBACK_PORT } from "./googleDriveConstants";

export interface OAuthCallbackResult {
	code?: string;
	error?: string;
	errorDescription?: string;
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

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

function buildSuccessHtml(): string {
	return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ObSave — Autenticación exitosa</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #f0f4f8;
    padding: 1.5rem;
  }
  .card {
    text-align: center;
    max-width: 420px;
    padding: 2.5rem 2rem;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 1.25rem;
    background: linear-gradient(135deg, #4ade80, #22c55e);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
    line-height: 1;
  }
  h1 { font-size: 1.35rem; font-weight: 600; margin-bottom: 0.75rem; }
  p { font-size: 0.95rem; opacity: 0.85; line-height: 1.5; }
  .brand { margin-top: 1.5rem; font-size: 0.75rem; opacity: 0.5; letter-spacing: 0.05em; }
</style>
</head>
<body>
<div class="card">
  <div class="icon" aria-hidden="true">&#10003;</div>
  <h1>Autenticación exitosa</h1>
  <p>Regresando a Obsidian…</p>
  <p class="brand">ObSave · Ad Astra Forge</p>
</div>
<script>
  window.open('', '_self', '');
  window.close();
</script>
</body>
</html>`;
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ObSave — Error de autenticación</title>
<style>
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
    background: #1a1a2e;
    color: #f0f4f8;
    padding: 1.5rem;
    text-align: center;
  }
  .card {
    max-width: 420px;
    padding: 2rem;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 12px;
  }
  h1 { font-size: 1.2rem; margin-bottom: 0.75rem; color: #fca5a5; }
  p { font-size: 0.9rem; opacity: 0.85; }
</style>
</head>
<body>
<div class="card">
  <h1>No se pudo completar la autorización</h1>
  <p>${safeMessage}</p>
  <p style="margin-top:1rem;font-size:0.8rem;">Cierra esta ventana y vuelve a Obsidian para reintentar.</p>
</div>
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

		const finish = (result: OAuthCallbackResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			server?.close();
			resolve(result);
		};

		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			server?.close();
			reject(error);
		};

		const sendHtmlAndFinish = (
			response: import("http").ServerResponse,
			html: string,
			result: OAuthCallbackResult,
		): void => {
			if (settled) return;
			response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			response.end(html, () => finish(result));
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

				if (error) {
					const message =
						errorDescription ?? error ?? "Autorización rechazada por Google.";
					sendHtmlAndFinish(res, buildErrorHtml(message), {
						error,
						errorDescription,
						code,
					});
					return;
				}

				if (!code) {
					sendHtmlAndFinish(
						res,
						buildErrorHtml("Callback OAuth sin código de autorización."),
						{ error: "missing_code" },
					);
					return;
				}

				sendHtmlAndFinish(res, buildSuccessHtml(), { code });
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
					`[ObSave] OAuth callback escuchando en 127.0.0.1:${port}/callback`,
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
