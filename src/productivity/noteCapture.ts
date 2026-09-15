import type { App } from "obsidian";
import { MarkdownView, Notice, TFile } from "obsidian";
import {
	DEFAULT_PRIORITY_ID,
	firstStatus,
	firstType,
	type ObSaveSettings,
} from "../settings";
import {
	buildFrontmatterYaml,
	DEFAULT_NOTE_TAGS,
	formatNowDateTime,
	formatTimestampForFilename,
	formatTodayDate,
} from "../utils/frontmatter";

export interface CaptureNoteOptions {
	title?: string;
	folder: string;
	fechaAtencion?: string;
	extraTags?: string[];
	tipoId?: string;
	estadoId?: string;
}

/**
 * Tipos declarados en `types.json` del vault: fechas nativas y texto con
 * selector ObSave (las opciones las pinta `PropertySelectEnhancer`).
 */
const PROPERTY_TYPES: Record<string, string> = {
	tipo: "text",
	estado: "text",
	prioridad: "text",
	fecha_creacion: "datetime",
	fecha_atencion: "date",
	tags: "tags",
};

type TypeManager = {
	setType?: (key: string, type: string) => void;
};

/**
 * Registra los tipos de propiedad en `<config>/types.json` y en
 * `metadataTypeManager` para que el panel nativo use fecha/texto/tags.
 */
export async function registerNotePropertyTypes(app: App): Promise<void> {
	const manager = (app as App & { metadataTypeManager?: TypeManager })
		.metadataTypeManager;
	if (manager?.setType) {
		for (const [key, value] of Object.entries(PROPERTY_TYPES)) {
			try {
				manager.setType(key, value);
			} catch (error) {
				console.warn(`[ObSave] No se pudo asignar tipo a «${key}»:`, error);
			}
		}
	}

	const path = `${app.vault.configDir}/types.json`;
	const adapter = app.vault.adapter;
	let parsed: Record<string, unknown> = {};

	try {
		if (await adapter.exists(path)) {
			parsed = JSON.parse(await adapter.read(path)) as Record<string, unknown>;
		}
	} catch (error) {
		// Un types.json ilegible es del usuario: no se sobrescribe a ciegas.
		console.warn("[ObSave] types.json ilegible, no se registran propiedades:", error);
		return;
	}

	const current =
		parsed.types && typeof parsed.types === "object"
			? { ...(parsed.types as Record<string, string>) }
			: {};

	let changed = false;
	for (const [key, value] of Object.entries(PROPERTY_TYPES)) {
		if (current[key] !== value) {
			current[key] = value;
			changed = true;
		}
	}
	if (!changed) {
		return;
	}

	try {
		await adapter.write(
			path,
			`${JSON.stringify({ ...parsed, types: current }, null, 2)}\n`,
		);
	} catch (error) {
		console.warn("[ObSave] No se pudo escribir types.json:", error);
	}
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
/** Prohibidos por Windows y macOS. */
const OS_FORBIDDEN = /[\\/:*?"<>|]/g;
/** Legales en el sistema de archivos pero rompen `[[wikilinks]]`. */
const OBSIDIAN_UNSAFE = /[#^[\]]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 120;

/**
 * Conserva espacios y capitalización del usuario: solo elimina lo que el
 * sistema operativo o los enlaces internos de Obsidian no admiten.
 */
export function sanitizeFileName(raw: string): string {
	let name = raw
		.replace(CONTROL_CHARS, "")
		.replace(OS_FORBIDDEN, "-")
		.replace(OBSIDIAN_UNSAFE, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.replace(/[.\s]+$/, "");

	if (WINDOWS_RESERVED.test(name)) {
		name = `${name} nota`;
	}
	if (name.length > MAX_NAME_LENGTH) {
		name = name.slice(0, MAX_NAME_LENGTH).trim();
	}

	return name || "Nota sin título";
}

function notePath(folder: string, name: string): string {
	return folder ? `${folder}/${name}.md` : `${name}.md`;
}

/** Añade `(2)`, `(3)`… hasta encontrar un nombre libre en la carpeta. */
function resolveAvailablePath(
	app: App,
	folder: string,
	baseName: string,
): { path: string; name: string; collided: boolean } {
	let candidate = baseName;
	let suffix = 1;

	while (app.vault.getAbstractFileByPath(notePath(folder, candidate))) {
		suffix++;
		candidate = `${baseName} (${suffix})`;
	}

	return {
		path: notePath(folder, candidate),
		name: candidate,
		collided: suffix > 1,
	};
}

export function normalizeFolderPath(folder: string): string {
	if (!folder || folder === "/") {
		return "";
	}
	return folder.replace(/\/+$/, "");
}

/**
 * Plantilla única para nota rápida y nueva nota. `estado` y `tipo` se escriben
 * con el nombre configurado: es lo que ofrece el autocompletado nativo de
 * propiedades al reutilizar valores ya presentes en la bóveda.
 * Devuelve la línea donde debe caer el cursor.
 */
function buildNote(fields: {
	tipo: string;
	estado: string;
	prioridad?: string;
	created: string;
	atender: string;
	tags: string[];
}): { content: string; cursorLine: number } {
	const yaml = buildFrontmatterYaml({
		tipo: fields.tipo,
		fecha_creacion: fields.created,
		fecha_atencion: fields.atender,
		estado: fields.estado,
		prioridad: fields.prioridad ?? DEFAULT_PRIORITY_ID,
		tags: fields.tags,
	});

	const content = `${yaml}\n\n## Detalle\n\n`;
	return { content, cursorLine: content.split("\n").length - 1 };
}

/** Abre la nota con el cursor ya situado en el cuerpo y el editor enfocado. */
async function openNoteAtBody(
	app: App,
	file: TFile,
	cursorLine: number,
): Promise<void> {
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(file, { state: { mode: "source" } });

	const view = leaf.view;
	if (view instanceof MarkdownView) {
		view.editor.setCursor({ line: cursorLine, ch: 0 });
		view.editor.focus();
	}
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) {
		return;
	}
	if (!app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder);
	}
}

export async function createQuickDailyNote(
	app: App,
	settings: ObSaveSettings,
): Promise<TFile | null> {
	const folder = "";

	const tipo = firstType(settings);
	const estado = firstStatus(settings);
	const baseName = sanitizeFileName(`${tipo.name} ${formatTimestampForFilename()}`);
	const target = resolveAvailablePath(app, folder, baseName);

	const { content, cursorLine } = buildNote({
		tipo: tipo.name,
		estado: estado.name,
		prioridad: DEFAULT_PRIORITY_ID,
		created: formatNowDateTime(),
		atender: formatTodayDate(),
		tags: [...DEFAULT_NOTE_TAGS],
	});

	const file = await app.vault.create(target.path, content);
	new Notice(`ObSave: Nota creada — ${target.name}`);
	await openNoteAtBody(app, file, cursorLine);
	return file;
}

export async function createCaptureNote(
	app: App,
	settings: ObSaveSettings,
	options: CaptureNoteOptions,
): Promise<TFile> {
	const folder = normalizeFolderPath(options.folder);
	await ensureFolder(app, folder);

	const tipo =
		settings.types.find((item) => item.id === options.tipoId) ?? firstType(settings);
	const estado =
		settings.statuses.find((item) => item.id === options.estadoId) ??
		firstStatus(settings);
	const title = options.title?.trim();
	const baseName = sanitizeFileName(
		title || `${tipo.name} ${formatTimestampForFilename()}`,
	);
	const target = resolveAvailablePath(app, folder, baseName);

	const { content, cursorLine } = buildNote({
		tipo: tipo.name,
		estado: estado.name,
		prioridad: DEFAULT_PRIORITY_ID,
		created: formatNowDateTime(),
		atender: options.fechaAtencion ?? formatTodayDate(),
		tags: [...DEFAULT_NOTE_TAGS, ...(options.extraTags ?? [])],
	});

	const file = await app.vault.create(target.path, content);
	new Notice(
		target.collided
			? `ObSave: Ya existía «${baseName}». Nota creada como «${target.name}».`
			: `ObSave: Nota creada — ${target.name}`,
	);
	await openNoteAtBody(app, file, cursorLine);
	return file;
}

export function listDestinationFolders(app: App): string[] {
	const folders = new Set<string>(["00_Diarias"]);
	for (const folder of app.vault.getAllFolders()) {
		folders.add(folder.path);
	}
	return [...folders].sort((a, b) => a.localeCompare(b));
}
