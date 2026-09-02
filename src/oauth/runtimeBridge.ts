type HttpModule = typeof import("http");
type NodeRequireFn = (id: string) => unknown;

declare global {
	interface Window {
		require?: NodeRequireFn;
	}
}

/**
 * Carga diferida de módulos Node/Electron en runtime Obsidian.
 * Usa `window.require` cuando existe; nunca lanza durante el load del plugin.
 */

let cachedHttp: HttpModule | null = null;

export function loadNodeHttp(): HttpModule | null {
	if (cachedHttp) {
		return cachedHttp;
	}

	try {
		const nodeRequire = resolveWindowRequire();
		if (!nodeRequire) {
			return null;
		}
		cachedHttp = nodeRequire("http") as HttpModule;
		return cachedHttp;
	} catch (error) {
		console.warn("[ObSave] Módulo http no disponible:", error);
		return null;
	}
}

export async function openExternalUrl(url: string): Promise<void> {
	try {
		const nodeRequire = resolveWindowRequire();
		if (nodeRequire) {
			const electron = nodeRequire("electron") as {
				shell?: { openExternal?: (target: string) => Promise<void> };
			};
			if (electron?.shell?.openExternal) {
				await electron.shell.openExternal(url);
				return;
			}
		}
	} catch (error) {
		console.warn("[ObSave] electron.shell no disponible, usando window.open:", error);
	}

	const opened = window.open(url, "_blank");
	if (!opened) {
		throw new Error("No se pudo abrir el navegador para autorización OAuth.");
	}
}

function resolveWindowRequire(): NodeRequireFn | null {
	try {
		if (typeof window !== "undefined" && typeof window.require === "function") {
			return window.require;
		}
	} catch {
		// Entorno sin window.require
	}

	try {
		if (typeof require === "function") {
			return require;
		}
	} catch {
		// require global no expuesto
	}

	return null;
}
