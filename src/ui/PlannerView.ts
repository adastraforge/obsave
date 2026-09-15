import type { App } from "obsidian";
import { Notice, setIcon, setTooltip, TFile } from "obsidian";
import {
	addComment,
	deleteComment,
	parseComments,
	updateComment,
	type NoteComment,
} from "../productivity/commentManager";
import {
	firstStatus,
	firstType,
	readableInk,
	resolvePriority,
	resolveStatus,
	resolveType,
	type NotePriority,
	type NoteStatus,
	type NoteType,
	type ObSaveSettings,
} from "../settings";
import { extractDetallePreview } from "../utils/frontmatter";
import { appendPriorityIcon } from "./priorityIcon";

const PRIORITY_RANK: Record<string, number> = {
	urgente: 0,
	alta: 1,
	normal: 2,
	baja: 3,
};

interface PlannerCard {
	file: TFile;
	title: string;
	folder: string;
	status: NoteStatus;
	tipo: NoteType;
	priority: NotePriority;
	dueLabel: string;
	preview: string;
	comments: NoteComment[];
}

interface PlannerGroup {
	folder: string;
	cards: PlannerCard[];
}

function folderLabel(path: string): string {
	return path === "/" || path === "" ? "Raíz" : path;
}

/**
 * Vista de tarjetas agrupadas por carpeta: estado, tipo, fecha, detalle y comentarios.
 */
export class PlannerView {
	private renderGen = 0;
	private expanded = new Set<string>();
	private collapsedFolders = new Set<string>();
	private drafts = new Map<string, string>();
	private editing = new Map<string, string>();

	constructor(
		private app: App,
		private containerEl: HTMLElement,
		private settings: ObSaveSettings,
	) {}

	render(): void {
		void this.renderAsync();
	}

	private async renderAsync(): Promise<void> {
		const gen = ++this.renderGen;
		const groups = await this.collect();
		if (gen !== this.renderGen) {
			return;
		}
		this.paint(groups);
	}

	private async collect(): Promise<PlannerGroup[]> {
		const fallbackStatus = firstStatus(this.settings);
		const fallbackType = firstType(this.settings);
		const byFolder = new Map<string, PlannerCard[]>();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const folder = file.parent?.path || "/";
			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;
			let preview = "";
			try {
				const content = await this.app.vault.cachedRead(file);
				preview = extractDetallePreview(content);
			} catch {
				preview = "";
			}

			const card: PlannerCard = {
				file,
				title: file.basename,
				folder,
				status:
					resolveStatus(frontmatter?.estado, this.settings.statuses) ??
					fallbackStatus,
				tipo:
					resolveType(frontmatter?.tipo, this.settings.types) ?? fallbackType,
				priority: resolvePriority(frontmatter?.prioridad),
				dueLabel:
					typeof frontmatter?.fecha_atencion === "string"
						? frontmatter.fecha_atencion.trim()
						: "",
				preview,
				comments: parseComments(frontmatter?.comentarios),
			};

			const list = byFolder.get(folder) ?? [];
			list.push(card);
			byFolder.set(folder, list);
		}

		return [...byFolder.entries()]
			.sort(([a], [b]) => folderLabel(a).localeCompare(folderLabel(b)))
			.map(([folder, cards]) => ({
				folder,
				cards: cards.sort((a, b) => {
					const rank =
						(PRIORITY_RANK[a.priority.id] ?? 9) -
						(PRIORITY_RANK[b.priority.id] ?? 9);
					if (rank !== 0) {
						return rank;
					}
					return a.title.localeCompare(b.title);
				}),
			}));
	}

	private paint(groups: PlannerGroup[]): void {
		const root = this.containerEl;
		root.empty();
		root.addClass("obsave-planner");

		if (groups.length === 0) {
			root.createEl("p", {
				cls: "setting-item-description",
				text: "No hay notas en la bóveda.",
			});
			return;
		}

		for (const group of groups) {
			this.paintGroup(root, group);
		}
	}

	private paintGroup(root: HTMLElement, group: PlannerGroup): void {
		const collapsed = this.collapsedFolders.has(group.folder);
		const section = root.createDiv({ cls: "obsave-planner-group" });
		const header = section.createEl("button", { cls: "obsave-planner-group-header" });
		header.toggleClass("is-collapsed", collapsed);
		header.setAttribute("aria-expanded", String(!collapsed));
		const chevron = header.createSpan({ cls: "obsave-planner-group-chevron" });
		setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");
		header.createSpan({
			cls: "obsave-planner-group-title",
			text: folderLabel(group.folder),
		});
		header.createSpan({
			cls: "obsave-planner-group-count",
			text: String(group.cards.length),
		});
		header.addEventListener("click", () => {
			if (this.collapsedFolders.has(group.folder)) {
				this.collapsedFolders.delete(group.folder);
			} else {
				this.collapsedFolders.add(group.folder);
			}
			this.render();
		});

		if (collapsed) {
			return;
		}

		const list = section.createDiv({ cls: "obsave-planner-cards" });
		for (const card of group.cards) {
			this.paintCard(list, card);
		}
	}

	private paintCard(containerEl: HTMLElement, card: PlannerCard): void {
		const el = containerEl.createDiv({ cls: "obsave-planner-card" });
		el.style.setProperty("--obsave-accent", card.status.color);
		if (this.expanded.has(card.file.path)) {
			el.addClass("is-expanded");
		}
		el.setAttribute("role", "button");
		el.setAttribute("tabindex", "0");
		setTooltip(el, card.file.path);
		el.addEventListener("click", () => void this.openNote(card.file));
		el.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				void this.openNote(card.file);
			}
		});

		const header = el.createDiv({ cls: "obsave-planner-card-header" });
		header.createSpan({
			cls: "obsave-planner-card-title",
			text: card.title,
		});
		appendPriorityIcon(header, card.priority);

		const badges = el.createDiv({ cls: "obsave-planner-badges" });
		this.statusPill(badges, card.status);
		this.badge(badges, card.tipo.name);
		if (card.dueLabel) {
			this.badge(badges, card.dueLabel);
		}

		el.createDiv({
			cls: "obsave-planner-preview",
			text: card.preview || "Sin detalle.",
		});

		this.paintComments(el, card);
	}

	private statusPill(parent: HTMLElement, status: NoteStatus): void {
		const badge = parent.createSpan({
			cls: "obsave-planner-badge is-status",
			text: status.name,
		});
		badge.style.setProperty("--obsave-accent", status.color);
		badge.style.backgroundColor = status.color;
		badge.style.color = readableInk(status.color);
	}

	private badge(parent: HTMLElement, label: string): void {
		parent.createSpan({ cls: "obsave-planner-badge", text: label });
	}

	private paintComments(cardEl: HTMLElement, card: PlannerCard): void {
		const path = card.file.path;
		const open = this.expanded.has(path);
		const footer = cardEl.createDiv({ cls: "obsave-planner-card-footer" });
		this.isolate(footer);

		const toggle = footer.createEl("button", {
			cls: "obsave-planner-comments-toggle",
		});
		const icon = toggle.createSpan({ cls: "obsave-planner-comments-icon" });
		setIcon(icon, "message-circle");
		toggle.createSpan({
			cls: "obsave-planner-comments-count",
			text: String(card.comments.length),
		});
		toggle.setAttribute("aria-expanded", String(open));
		setTooltip(toggle, "Comentarios");
		toggle.addEventListener("click", (event) => {
			event.stopPropagation();
			if (this.expanded.has(path)) {
				this.expanded.delete(path);
			} else {
				this.expanded.add(path);
			}
			this.render();
		});

		if (!open) {
			return;
		}

		const body = cardEl.createDiv({ cls: "obsave-planner-comments-body" });
		this.isolate(body);
		if (card.comments.length === 0) {
			body.createDiv({
				cls: "obsave-planner-comments-empty",
				text: "Sin comentarios.",
			});
		}

		for (const comment of card.comments) {
			this.paintComment(body, card, comment);
		}

		const composer = body.createDiv({ cls: "obsave-planner-composer" });
		const input = composer.createEl("input", {
			cls: "obsave-planner-composer-input",
			attr: {
				type: "text",
				placeholder: "Escribe un comentario…",
			},
		});
		input.value = this.drafts.get(path) ?? "";
		input.addEventListener("input", () => {
			this.drafts.set(path, input.value);
		});
		const send = composer.createEl("button", {
			cls: "obsave-planner-composer-send",
			attr: { "aria-label": "Enviar comentario" },
		});
		setIcon(send, "send");
		setTooltip(send, "Enviar");
		send.addEventListener("click", (event) => {
			event.stopPropagation();
			void this.onAdd(card.file, input);
		});
		input.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (event.key === "Enter") {
				event.preventDefault();
				void this.onAdd(card.file, input);
			}
		});
	}

	private paintComment(
		parent: HTMLElement,
		card: PlannerCard,
		comment: NoteComment,
	): void {
		const row = parent.createDiv({ cls: "obsave-planner-comment" });
		this.isolate(row);
		const editing = this.editing.get(card.file.path) === comment.id;

		if (editing) {
			const composer = row.createDiv({ cls: "obsave-planner-composer" });
			const input = composer.createEl("input", {
				cls: "obsave-planner-composer-input",
				attr: { type: "text" },
			});
			input.value = comment.texto;
			const actions = row.createDiv({ cls: "obsave-planner-comment-actions" });
			const save = actions.createEl("button", { cls: "obsave-planner-comment-action" });
			setIcon(save, "check");
			setTooltip(save, "Guardar");
			save.addEventListener("click", (event) => {
				event.stopPropagation();
				void this.onUpdate(card.file, comment.id, input.value);
			});
			const cancel = actions.createEl("button", { cls: "obsave-planner-comment-action" });
			setIcon(cancel, "x");
			setTooltip(cancel, "Cancelar");
			cancel.addEventListener("click", (event) => {
				event.stopPropagation();
				this.editing.delete(card.file.path);
				this.render();
			});
			return;
		}

		const copy = row.createDiv({ cls: "obsave-planner-comment-copy" });
		copy.createDiv({ cls: "obsave-planner-comment-meta", text: comment.fecha });
		copy.createDiv({ cls: "obsave-planner-comment-text", text: comment.texto });
		const actions = row.createDiv({ cls: "obsave-planner-comment-actions" });
		const edit = actions.createEl("button", { cls: "obsave-planner-comment-action" });
		setIcon(edit, "pencil");
		setTooltip(edit, "Editar comentario");
		edit.addEventListener("click", (event) => {
			event.stopPropagation();
			this.editing.set(card.file.path, comment.id);
			this.render();
		});
		const remove = actions.createEl("button", {
			cls: "obsave-planner-comment-action is-danger",
		});
		setIcon(remove, "trash-2");
		setTooltip(remove, "Eliminar comentario");
		remove.addEventListener("click", (event) => {
			event.stopPropagation();
			void this.onDelete(card.file, comment.id);
		});
	}

	private isolate(el: HTMLElement): void {
		el.addEventListener("click", (event) => event.stopPropagation());
		el.addEventListener("keydown", (event) => event.stopPropagation());
		el.addEventListener("pointerdown", (event) => event.stopPropagation());
	}

	private async onAdd(file: TFile, input: HTMLInputElement): Promise<void> {
		const created = await addComment(this.app, file, input.value);
		if (!created) {
			return;
		}
		this.drafts.delete(file.path);
		this.expanded.add(file.path);
		this.render();
	}

	private async onUpdate(file: TFile, id: string, texto: string): Promise<void> {
		await updateComment(this.app, file, id, texto);
		this.editing.delete(file.path);
		this.render();
	}

	private async onDelete(file: TFile, id: string): Promise<void> {
		await deleteComment(this.app, file, id);
		this.render();
	}

	private async openNote(file: TFile): Promise<void> {
		const leaf =
			this.app.workspace.getMostRecentLeaf() ??
			this.app.workspace.getLeaf("tab");
		if (!leaf) {
			new Notice(`No se encontró ${file.path}`);
			return;
		}
		await leaf.openFile(file);
	}
}
