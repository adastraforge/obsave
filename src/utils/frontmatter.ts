import type { App, TFile } from "obsidian";
import {
	canonicalStatusName,
	canonicalTypeName,
	stripPropertyQuotes,
	type ObSaveSettings,
} from "../settings";

export interface NoteFrontmatterFields {
	tipo?: string;
	fecha_creacion?: string;
	fecha_atencion?: string;
	estado?: string;
	tags?: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export const DEFAULT_NOTE_TAGS = ["pendiente"] as const;

/**
 * En YAML una almohadilla precedida de espacio abre un comentario, así que
 * `- #pendiente` no produce ninguna etiqueta indexable. Se normaliza sin `#`.
 */
export function normalizeTag(raw: string): string {
	return raw
		.trim()
		.replace(/^["']|["']$/g, "")
		.replace(/^#+/, "")
		.trim();
}

export function parseFrontmatter(content: string): {
	frontmatter: NoteFrontmatterFields;
	body: string;
} {
	const match = content.match(FRONTMATTER_RE);
	if (!match) {
		return { frontmatter: {}, body: content };
	}

	const yaml = match[1];
	const body = content.slice(match[0].length).replace(/^\r?\n/, "");
	const frontmatter: NoteFrontmatterFields = {};
	let insideTagList = false;

	for (const line of yaml.split("\n")) {
		const listItem = line.match(/^\s+-\s*(.*)$/);
		if (insideTagList && listItem) {
			const tag = normalizeTag(listItem[1]);
			if (tag) {
				frontmatter.tags = frontmatter.tags ?? [];
				frontmatter.tags.push(tag);
			}
			continue;
		}
		insideTagList = false;

		if (/^tags:\s*$/.test(line)) {
			insideTagList = true;
			frontmatter.tags = frontmatter.tags ?? [];
			continue;
		}
		const inlineTags = line.match(/^tags:\s*\[(.*)\]\s*$/);
		if (inlineTags) {
			frontmatter.tags = inlineTags[1]
				.split(",")
				.map((tag) => normalizeTag(tag))
				.filter(Boolean);
			continue;
		}
		const tipoMatch = line.match(/^tipo:\s*(.+)$/);
		if (tipoMatch) {
			frontmatter.tipo = stripPropertyQuotes(tipoMatch[1]);
			continue;
		}
		const fechaCreacion = line.match(/^fecha_creacion:\s*(.+)$/);
		if (fechaCreacion) {
			frontmatter.fecha_creacion = fechaCreacion[1].trim();
			continue;
		}
		const fechaAtencion = line.match(/^fecha_atencion:\s*(.+)$/);
		if (fechaAtencion) {
			frontmatter.fecha_atencion = fechaAtencion[1].trim();
			continue;
		}
		const estadoMatch = line.match(/^estado:\s*(.+)$/);
		if (estadoMatch) {
			frontmatter.estado = stripPropertyQuotes(estadoMatch[1]);
		}
	}

	return { frontmatter, body };
}

export function updateNoteTipo(content: string, newTipo: string): string {
	const { frontmatter, body } = parseFrontmatter(content);
	const nowDisplay = frontmatter.fecha_creacion ?? formatNowDateTime();
	const fechaAtencion = frontmatter.fecha_atencion ?? formatTodayDate();
	const estado = frontmatter.estado ?? "pendientes";
	const tags = frontmatter.tags?.length
		? frontmatter.tags
		: [...DEFAULT_NOTE_TAGS];

	const updatedYaml = buildFrontmatterYaml({
		tipo: newTipo,
		fecha_creacion: nowDisplay,
		fecha_atencion: fechaAtencion,
		estado,
		tags,
	});

	// Notas anteriores a v1.2.0 conservan el callout; se mantiene sincronizado.
	let updatedBody = body;
	const infoBlockRe =
		/> \[!info\] Información General[\s\S]*?(?=\n%% Sección de Contenido %%|\n## Contenido|$)/;
	if (infoBlockRe.test(updatedBody)) {
		updatedBody = updatedBody.replace(
			infoBlockRe,
			`> [!info] Información General\n> **Tipo:** ${newTipo}\n> **Fecha de creación:** ${nowDisplay}\n> **Atender el:** ${fechaAtencion}\n> **Estado:** ${capitalize(estado)}\n\n`,
		);
	}

	return `${updatedYaml}\n${updatedBody}`;
}

export function buildFrontmatterYaml(fields: NoteFrontmatterFields): string {
	const tags = (fields.tags ?? [...DEFAULT_NOTE_TAGS])
		.map((tag) => normalizeTag(tag))
		.filter(Boolean);

	const lines = [
		"---",
		`tipo: ${fields.tipo ?? "diaria"}`,
		`fecha_creacion: ${fields.fecha_creacion ?? formatNowDateTime()}`,
		`fecha_atencion: ${fields.fecha_atencion ?? formatTodayDate()}`,
		`estado: ${fields.estado ?? "pendientes"}`,
	];

	if (tags.length > 0) {
		lines.push("tags:", ...tags.map((tag) => `  - ${tag}`));
	}

	lines.push("---");
	return lines.join("\n");
}

/**
 * Escribe `estado` o `tipo` al instante. Acepta id (`pausadas`) o nombre
 * (`Pausadas`) y persiste siempre la etiqueta configurada.
 */
export async function writeFrontmatterProperty(
	app: App,
	file: TFile,
	key: "estado" | "tipo",
	raw: string,
	settings: ObSaveSettings,
): Promise<string> {
	const canonical =
		key === "estado"
			? (canonicalStatusName(raw, settings.statuses) ?? raw.trim())
			: (canonicalTypeName(raw, settings.types) ?? raw.trim());

	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		frontmatter[key] = canonical;
	});

	return canonical;
}

export function formatNowDateTime(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const h = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

export function formatTodayDate(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Sello legible y ordenable alfabéticamente para nombres de archivo: `2026-09-10 1712`. */
export function formatTimestampForFilename(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const h = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	return `${y}-${m}-${day} ${h}${min}`;
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
