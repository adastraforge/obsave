export interface NoteFrontmatterFields {
	tipo?: string;
	fecha_creacion?: string;
	fecha_atencion?: string;
	estado?: string;
	tags?: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

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

	for (const line of yaml.split("\n")) {
		const tipoMatch = line.match(/^tipo:\s*(.+)$/);
		if (tipoMatch) {
			frontmatter.tipo = tipoMatch[1].trim();
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
			frontmatter.estado = estadoMatch[1].trim();
			continue;
		}
		const tagMatch = line.match(/^\s*-\s*(.+)$/);
		if (tagMatch && line.includes("#")) {
			frontmatter.tags = frontmatter.tags ?? [];
			frontmatter.tags.push(tagMatch[1].trim());
		}
	}

	return { frontmatter, body };
}

export function updateNoteTipo(content: string, newTipo: string): string {
	const { frontmatter, body } = parseFrontmatter(content);
	const nowDisplay = frontmatter.fecha_creacion ?? formatNowDateTime();
	const fechaAtencion = frontmatter.fecha_atencion ?? formatTodayDate();
	const estado = frontmatter.estado ?? "pendiente";
	const tags = frontmatter.tags ?? ["#obsidian", "#nota", "#pendiente"];

	const updatedYaml = buildFrontmatterYaml({
		tipo: newTipo,
		fecha_creacion: nowDisplay,
		fecha_atencion: fechaAtencion,
		estado,
		tags,
	});

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
	const tags = fields.tags ?? [];
	const tagLines = tags.map((tag) => `  - ${tag}`).join("\n");
	return `---\ntipo: ${fields.tipo ?? "diarias"}\nfecha_creacion: ${fields.fecha_creacion ?? formatNowDateTime()}\nfecha_atencion: ${fields.fecha_atencion ?? formatTodayDate()}\nestado: ${fields.estado ?? "pendiente"}\ntags:\n${tagLines}\n---`;
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

export function formatTimestampForFilename(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const h = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	return `${y}-${m}-${day}_${h}${min}${s}`;
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
