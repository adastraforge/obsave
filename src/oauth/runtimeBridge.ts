type HttpModule = typeof import("http");
type NodeRequireFn = (id: string) => unknown;

/**
 * Carga diferida de módulos Node/Electron en runtime Obsidian.
 * Evita `require()` en el ámbito superior del bundle (fallo "Failed to load plugin").
 */

let cachedHttp: HttpModule | null = null;

export function loadNodeHttp(): HttpModule {
	if (!cachedHttp) {
		const nodeRequire = resolveNodeRequire();
		cachedHttp = nodeRequire("http") as HttpModule;
	}
	return cachedHttp;
}

export async function openExternalUrl(url: string): Promise<void> {
	try {
		const nodeRequire = resolveNodeRequire();
		const electron = nodeRequire("electron") as {
			shell?: { openExternal?: (target: string) => Promise<void> };
		};
		if (electron?.shell?.openExternal) {
			await electron.shell.openExternal(url);
			return;
		}
	} catch (error) {
		console.warn("[ObSave] electron.shell no disponible, usando window.open:", error);
	}

	const opened = window.open(url, "_blank");
	if (!opened) {
		throw new Error("No se pudo abrir el navegador para autorización OAuth.");
	}
}

function resolveNodeRequire(): NodeRequireFn {
	if (typeof require === "function") {
		return require;
	}
	throw new Error("Entorno Node require no disponible.");
}
