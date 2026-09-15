import type { App, TFile } from "obsidian";
import { formatNowDateTime } from "../utils/frontmatter";

export interface NoteComment {
	id: string;
	fecha: string;
	texto: string;
}

function newCommentId(): string {
	return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
	return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

export function parseComments(raw: unknown): NoteComment[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const comments: NoteComment[] = [];
	for (const item of raw) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		const id = typeof record.id === "string" ? record.id.trim() : "";
		const fecha = typeof record.fecha === "string" ? record.fecha.trim() : "";
		const texto = typeof record.texto === "string" ? record.texto.trim() : "";
		if (!id || !texto) {
			continue;
		}
		comments.push({ id, fecha: fecha || formatNowDateTime(), texto });
	}
	return comments;
}

async function mutateComments(
	app: App,
	file: TFile,
	update: (current: NoteComment[]) => NoteComment[],
): Promise<NoteComment[]> {
	let next: NoteComment[] = [];
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		next = update(parseComments(frontmatter.comentarios));
		if (next.length === 0) {
			delete frontmatter.comentarios;
		} else {
			frontmatter.comentarios = next.map((comment) => ({
				id: comment.id,
				fecha: comment.fecha,
				texto: comment.texto,
			}));
		}
	});
	return next;
}

export async function addComment(
	app: App,
	file: TFile,
	texto: string,
): Promise<NoteComment | null> {
	const trimmed = texto.trim();
	if (!trimmed) {
		return null;
	}
	const created: NoteComment = {
		id: newCommentId(),
		fecha: formatNowDateTime(),
		texto: trimmed,
	};
	await mutateComments(app, file, (current) => [...current, created]);
	return created;
}

export async function updateComment(
	app: App,
	file: TFile,
	id: string,
	texto: string,
): Promise<void> {
	const trimmed = texto.trim();
	if (!trimmed) {
		return;
	}
	await mutateComments(app, file, (current) =>
		current.map((comment) =>
			comment.id === id ? { ...comment, texto: trimmed } : comment,
		),
	);
}

export async function deleteComment(
	app: App,
	file: TFile,
	id: string,
): Promise<void> {
	await mutateComments(app, file, (current) =>
		current.filter((comment) => comment.id !== id),
	);
}
