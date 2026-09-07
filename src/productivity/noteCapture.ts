import type { App } from "obsidian";
import { Notice, TFile } from "obsidian";
import { cleanFolderTypeName } from "../productivity/vaultStructure";
import {
	buildFrontmatterYaml,
	formatNowDateTime,
	formatTimestampForFilename,
	formatTodayDate,
} from "../utils/frontmatter";

export interface CaptureNoteOptions {
	title?: string;
	folder: string;
	fechaAtencion?: string;
	extraTags?: string[];
}

function sanitizeFileName(name: string): string {
	return name
		.trim()
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, "_")
		.slice(0, 120);
}

function buildNoteBody(tipo: string, title: string, created: string, atender: string): string {
	return `${buildFrontmatterYaml({
		tipo,
		fecha_creacion: created,
		fecha_atencion: atender,
		estado: "pendiente",
		tags: ["#obsidian", "#nota", "#pendiente"],
	})}

# ${title}

%% Sección General %%
> [!info] Información General
> **Tipo:** ${tipo}
> **Fecha de creación:** ${created}
> **Atender el:** ${atender}
> **Estado:** Pendiente

%% Sección de Contenido %%
## Contenido
- Escribe aquí el detalle de la nota...

%% Notas / Tareas de seguimiento %%
- [ ] Tarea pendiente inicial
`;
}

export async function createQuickDailyNote(app: App): Promise<TFile | null> {
	const folder = "00_Diarias";
	if (!app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder);
	}

	const created = formatNowDateTime();
	const atender = formatTodayDate();
	const fileName = `Nota_diarias(${formatTimestampForFilename()}).md`;
	const path = `${folder}/${fileName}`;
	const content = buildNoteBody("diarias", "Nota diarias", created, atender);

	const file = await app.vault.create(path, content);
	new Notice(`ObSave: Nota creada — ${path}`);
	await app.workspace.getLeaf(false).openFile(file);
	return file;
}

export async function createCaptureNote(
	app: App,
	options: CaptureNoteOptions,
): Promise<TFile | null> {
	const folder = options.folder.replace(/\/+$/, "");
	if (!app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder);
	}

	const tipo = cleanFolderTypeName(folder);
	const created = formatNowDateTime();
	const atender = options.fechaAtencion ?? formatTodayDate();
	const title = options.title?.trim();
	const baseTags = ["#obsidian", "#nota", "#pendiente"];
	const tags = [...baseTags, ...(options.extraTags ?? [])];

	let fileName: string;
	let heading: string;
	if (title) {
		fileName = `${sanitizeFileName(title)}.md`;
		heading = title;
	} else {
		fileName = `Nota_${tipo}(${formatTimestampForFilename()}).md`;
		heading = `Nota ${tipo}`;
	}

	const path = `${folder}/${fileName}`;
	if (app.vault.getAbstractFileByPath(path)) {
		new Notice(`ObSave: Ya existe ${path}`);
		return null;
	}

	const content = `${buildFrontmatterYaml({
		tipo,
		fecha_creacion: created,
		fecha_atencion: atender,
		estado: "pendiente",
		tags,
	})}

# ${heading}

%% Sección General %%
> [!info] Información General
> **Tipo:** ${tipo}
> **Fecha de creación:** ${created}
> **Atender el:** ${atender}
> **Estado:** Pendiente

%% Sección de Contenido %%
## Contenido
- Escribe aquí el detalle de la nota...

%% Notas / Tareas de seguimiento %%
- [ ] Tarea pendiente inicial
`;

	const file = await app.vault.create(path, content);
	new Notice(`ObSave: Nota creada — ${path}`);
	await app.workspace.getLeaf(false).openFile(file);
	return file;
}

export function listDestinationFolders(app: App): string[] {
	const folders = new Set<string>(["00_Diarias"]);
	for (const folder of app.vault.getAllFolders()) {
		folders.add(folder.path);
	}
	return [...folders].sort((a, b) => a.localeCompare(b));
}
