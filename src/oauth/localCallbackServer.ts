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

/**
 * Servidor HTTP efímero en 127.0.0.1:42000/callback para capturar el código OAuth.
 * `http` se carga solo al invocar esta función (no en el load del plugin).
 */
export function waitForOAuthCallback(
	port = GOOGLE_DRIVE_CALLBACK_PORT,
): Promise<OAuthCallbackResult> {
	return new Promise((resolve, reject) => {
		const http = loadNodeHttp();
		let settled = false;

		const finish = (result: OAuthCallbackResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			server.close();
			resolve(result);
		};

		const fail = (error: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			server.close();
			reject(error);
		};

		const server = http.createServer((req, res) => {
			const reqUrl = req.url ?? "";
			if (!reqUrl.startsWith("/callback")) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const { code, error, errorDescription } = parseCallbackPath(reqUrl);

			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(`<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>ObSave</title></head>
<body style="font-family: system-ui; text-align: center; padding: 3rem;">
<h1>ObSave — Autorización completada</h1>
<p>Puedes cerrar esta ventana y volver a Obsidian.</p>
<script>setTimeout(() => window.close(), 1500);</script>
</body>
</html>`);

			if (error) {
				finish({ error, errorDescription, code });
				return;
			}

			if (!code) {
				fail(new Error("Callback OAuth sin código de autorización."));
				return;
			}

			finish({ code });
		});

		server.on("error", (err) => {
			fail(
				err instanceof Error
					? err
					: new Error("No se pudo iniciar el servidor OAuth local."),
			);
		});

		const timeoutId = setTimeout(() => {
			fail(new Error("Tiempo de espera agotado para la autorización OAuth."));
		}, CALLBACK_TIMEOUT_MS);

		server.listen(port, "127.0.0.1", () => {
			console.log(
				`[ObSave] OAuth callback escuchando en 127.0.0.1:${port}/callback`,
			);
		});
	});
}
