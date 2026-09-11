import type { App } from "obsidian";
import { Modal, Notice, setIcon, setTooltip, TFile } from "obsidian";

type BucketId = "overdue" | "today" | "week" | "attended";

interface NoteRef {
	path: string;
	title: string;
	folder: string;
	due: Date | null;
}

interface FolderCount {
	folder: string;
	count: number;
}

interface VaultMetrics {
	totalFolders: number;
	totalNotes: number;
	buckets: Record<BucketId, NoteRef[]>;
	byFolder: FolderCount[];
	unscheduled: number;
}

interface BucketDefinition {
	id: BucketId;
	label: string;
	icon: string;
	modifier: string;
}

const BUCKETS: BucketDefinition[] = [
	{ id: "overdue", label: "Vencidas", icon: "alert-triangle", modifier: "is-overdue" },
	{ id: "today", label: "Para hoy", icon: "clock", modifier: "is-today" },
	{ id: "week", label: "Esta semana", icon: "calendar-days", modifier: "is-week" },
	{ id: "attended", label: "Atendidas", icon: "check-circle-2", modifier: "is-attended" },
];

const VISIBLE_NOTES_STEP = 15;
const VISIBLE_FOLDERS = 6;
/** Circunferencia exacta de 100 → `stroke-dasharray` se expresa en porcentaje. */
const DONUT_RADIUS = 15.9155;

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** El frontmatter cacheado puede entregar la fecha como texto o como `Date`. */
function toDateOnly(value: unknown): Date | null {
	if (value instanceof Date) {
		return startOfDay(value);
	}
	if (typeof value !== "string") {
		return null;
	}
	const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) {
		return null;
	}
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatRelativeDue(due: Date | null, today: Date): string {
	if (!due) {
		return "";
	}
	const days = Math.round((due.getTime() - today.getTime()) / 86400000);
	if (days === 0) return "hoy";
	if (days === 1) return "mañana";
	if (days === -1) return "ayer";
	return days < 0 ? `hace ${Math.abs(days)} días` : `en ${days} días`;
}

/**
 * Métricas desde `metadataCache`: cero lecturas de disco. El frontmatter y el
 * estado de las casillas ya están indexados en memoria por Obsidian.
 */
function computeVaultMetrics(app: App): VaultMetrics {
	const today = startOfDay(new Date());
	const weekEnd = new Date(today);
	weekEnd.setDate(weekEnd.getDate() + 7);

	const buckets: Record<BucketId, NoteRef[]> = {
		overdue: [],
		today: [],
		week: [],
		attended: [],
	};
	const folderCounts = new Map<string, number>();
	const files = app.vault.getMarkdownFiles();
	let unscheduled = 0;

	for (const file of files) {
		const folder = file.parent?.path || "/";
		folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);

		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const estado = String(frontmatter?.estado ?? "").toLowerCase();
		const hasCompletedTask =
			cache?.listItems?.some((item) => item.task?.toLowerCase() === "x") === true;

		const ref: NoteRef = {
			path: file.path,
			title: file.basename,
			folder,
			due: toDateOnly(frontmatter?.fecha_atencion),
		};

		if (estado === "atendido" || hasCompletedTask) {
			buckets.attended.push(ref);
			continue;
		}
		if (!ref.due) {
			unscheduled++;
			continue;
		}

		const time = ref.due.getTime();
		if (time < today.getTime()) {
			buckets.overdue.push(ref);
		} else if (time === today.getTime()) {
			buckets.today.push(ref);
		} else if (time <= weekEnd.getTime()) {
			buckets.week.push(ref);
		} else {
			unscheduled++;
		}
	}

	const byDueDate = (a: NoteRef, b: NoteRef): number =>
		(a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0);
	buckets.overdue.sort(byDueDate);
	buckets.today.sort(byDueDate);
	buckets.week.sort(byDueDate);
	buckets.attended.sort((a, b) => a.title.localeCompare(b.title));

	return {
		totalFolders: app.vault.getAllFolders().length,
		totalNotes: files.length,
		buckets,
		byFolder: [...folderCounts.entries()]
			.map(([folder, count]) => ({ folder, count }))
			.sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder)),
		unscheduled,
	};
}

export class VaultReportModal extends Modal {
	private metrics: VaultMetrics | null = null;
	private initialized = false;
	private activeTab: BucketId = "overdue";
	private visibleNotes = VISIBLE_NOTES_STEP;
	private showAllFolders = false;
	private filter = "";
	private listEl: HTMLElement | null = null;
	private tabEls = new Map<BucketId, HTMLElement>();
	private kpiEls = new Map<BucketId, HTMLElement>();

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("obsave-vault-report-modal");
		this.titleEl.setText("Informe operativo de bóveda");
		this.render();
	}

	onClose(): void {
		this.modalEl.removeClass("obsave-vault-report-modal");
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.tabEls.clear();
		this.kpiEls.clear();

		try {
			this.metrics = computeVaultMetrics(this.app);
		} catch (error) {
			contentEl.createEl("p", {
				cls: "obsave-alert",
				text:
					error instanceof Error
						? error.message
						: "No se pudo generar el informe.",
			});
			return;
		}

		const metrics = this.metrics;
		if (!this.initialized) {
			this.activeTab = this.defaultTab(metrics);
			this.initialized = true;
		}
		this.visibleNotes = VISIBLE_NOTES_STEP;

		this.renderSummaryBar(contentEl, metrics);
		this.renderKpiGrid(contentEl, metrics);
		this.renderCharts(contentEl, metrics);
		this.renderTabs(contentEl, metrics);

		this.listEl = contentEl.createDiv({ cls: "obsave-report-panel" });
		this.renderList();
	}

	/** El informe abre en lo que exige acción, no en el primer bucket del array. */
	private defaultTab(metrics: VaultMetrics): BucketId {
		for (const bucket of BUCKETS) {
			if (metrics.buckets[bucket.id].length > 0) {
				return bucket.id;
			}
		}
		return "overdue";
	}

	private renderSummaryBar(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const bar = containerEl.createDiv({ cls: "obsave-report-summary" });
		bar.createSpan({
			cls: "obsave-report-summary-text",
			text: `${metrics.totalNotes} notas · ${metrics.totalFolders} carpetas · ${metrics.unscheduled} sin programar`,
		});

		const refresh = bar.createEl("button", { cls: "obsave-icon-button" });
		setIcon(refresh, "refresh-cw");
		setTooltip(refresh, "Recalcular métricas");
		refresh.setAttribute("aria-label", "Recalcular métricas");
		refresh.addEventListener("click", () => this.render());
	}

	private renderKpiGrid(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const grid = containerEl.createDiv({ cls: "obsave-kpi-grid" });

		for (const bucket of BUCKETS) {
			const count = metrics.buckets[bucket.id].length;
			const card = grid.createDiv({
				cls: `obsave-kpi-card ${bucket.modifier}`,
			});
			card.setAttribute("role", "button");
			card.setAttribute("tabindex", "0");
			card.setAttribute("aria-label", `${bucket.label}: ${count} notas`);
			setTooltip(card, `Ver ${bucket.label.toLowerCase()}`);

			const iconEl = card.createDiv({ cls: "obsave-kpi-icon" });
			setIcon(iconEl, bucket.icon);
			card.createDiv({ cls: "obsave-kpi-value", text: String(count) });
			card.createDiv({ cls: "obsave-kpi-label", text: bucket.label });

			const activate = (): void => this.setActiveTab(bucket.id);
			card.addEventListener("click", activate);
			card.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					activate();
				}
			});

			this.kpiEls.set(bucket.id, card);
		}

		this.syncActiveStyles();
	}

	private renderCharts(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const row = containerEl.createDiv({ cls: "obsave-report-charts" });
		this.renderHealthDonut(row, metrics);
		this.renderFolderBars(row, metrics);
	}

	private renderHealthDonut(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const panel = containerEl.createDiv({ cls: "obsave-chart-panel" });
		panel.createDiv({ cls: "obsave-chart-title", text: "Salud de la bóveda" });

		const attended = metrics.buckets.attended.length;
		const pending =
			metrics.buckets.overdue.length +
			metrics.buckets.today.length +
			metrics.buckets.week.length;
		const tracked = attended + pending;
		const percent = tracked === 0 ? 100 : Math.round((attended / tracked) * 100);

		const svg = panel.createSvg("svg", {
			cls: "obsave-donut",
			attr: { viewBox: "0 0 42 42", role: "img" },
		});
		svg.setAttribute("aria-label", `${percent} % de notas atendidas`);

		svg.createSvg("circle", {
			cls: "obsave-donut-track",
			attr: { cx: "21", cy: "21", r: String(DONUT_RADIUS) },
		});
		svg.createSvg("circle", {
			cls: "obsave-donut-value",
			attr: {
				cx: "21",
				cy: "21",
				r: String(DONUT_RADIUS),
				"stroke-dasharray": `${percent} ${100 - percent}`,
				"stroke-dashoffset": "25",
			},
		});
		const label = svg.createSvg("text", {
			cls: "obsave-donut-text",
			attr: { x: "21", y: "22.5" },
		});
		label.textContent = `${percent} %`;

		const legend = panel.createDiv({ cls: "obsave-donut-legend" });
		this.addLegendItem(legend, "is-attended", `${attended} atendidas`);
		this.addLegendItem(legend, "is-pending", `${pending} pendientes`);
	}

	private addLegendItem(
		containerEl: HTMLElement,
		modifier: string,
		text: string,
	): void {
		const item = containerEl.createDiv({ cls: "obsave-legend-item" });
		item.createSpan({ cls: `obsave-legend-dot ${modifier}` });
		item.createSpan({ text });
	}

	private renderFolderBars(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const panel = containerEl.createDiv({ cls: "obsave-chart-panel is-wide" });
		panel.createDiv({
			cls: "obsave-chart-title",
			text: "Distribución por carpeta",
		});

		if (metrics.byFolder.length === 0) {
			panel.createEl("p", {
				cls: "setting-item-description",
				text: "No hay notas todavía.",
			});
			return;
		}

		const max = metrics.byFolder[0].count;
		const visible = this.showAllFolders
			? metrics.byFolder
			: metrics.byFolder.slice(0, VISIBLE_FOLDERS);

		for (const entry of visible) {
			const row = panel.createDiv({ cls: "obsave-bar-row" });
			row.createSpan({ cls: "obsave-bar-label", text: entry.folder });

			const track = row.createDiv({ cls: "obsave-bar" });
			track.style.setProperty(
				"--obsave-bar-width",
				`${Math.max((entry.count / max) * 100, 2)}%`,
			);

			row.createSpan({ cls: "obsave-bar-value", text: String(entry.count) });
		}

		const hidden = metrics.byFolder.length - visible.length;
		if (hidden > 0 || this.showAllFolders) {
			const toggle = panel.createEl("button", {
				cls: "obsave-link-button",
				text: this.showAllFolders
					? "Mostrar solo las principales"
					: `Ver las ${hidden} carpetas restantes`,
			});
			toggle.addEventListener("click", () => {
				this.showAllFolders = !this.showAllFolders;
				this.render();
			});
		}
	}

	private renderTabs(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const bar = containerEl.createDiv({ cls: "obsave-report-tabbar" });
		const tabs = bar.createDiv({ cls: "obsave-report-tabs" });

		for (const bucket of BUCKETS) {
			const count = metrics.buckets[bucket.id].length;
			const tab = tabs.createEl("button", { cls: "obsave-report-tab" });
			tab.createSpan({ text: bucket.label });
			tab.createSpan({
				cls: `obsave-tab-badge ${bucket.modifier}`,
				text: String(count),
			});
			tab.addEventListener("click", () => this.setActiveTab(bucket.id));
			this.tabEls.set(bucket.id, tab);
		}

		const search = bar.createEl("input", {
			cls: "obsave-report-filter",
			attr: { type: "search", placeholder: "Filtrar…" },
		});
		search.value = this.filter;
		search.addEventListener("input", () => {
			this.filter = search.value;
			this.visibleNotes = VISIBLE_NOTES_STEP;
			this.renderList();
		});

		this.syncActiveStyles();
	}

	private setActiveTab(id: BucketId): void {
		if (this.activeTab === id) {
			return;
		}
		this.activeTab = id;
		this.visibleNotes = VISIBLE_NOTES_STEP;
		this.syncActiveStyles();
		this.renderList();
	}

	private syncActiveStyles(): void {
		for (const [id, el] of this.tabEls) {
			el.toggleClass("is-active", id === this.activeTab);
		}
		for (const [id, el] of this.kpiEls) {
			el.toggleClass("is-active", id === this.activeTab);
		}
	}

	private renderList(): void {
		const container = this.listEl;
		const metrics = this.metrics;
		if (!container || !metrics) {
			return;
		}

		container.empty();

		const needle = this.filter.trim().toLowerCase();
		const all = metrics.buckets[this.activeTab];
		const notes = needle
			? all.filter(
					(note) =>
						note.title.toLowerCase().includes(needle) ||
						note.folder.toLowerCase().includes(needle),
				)
			: all;

		if (notes.length === 0) {
			container.createEl("p", {
				cls: "setting-item-description",
				text: needle
					? "Ningún resultado para ese filtro."
					: "Sin registros en esta categoría.",
			});
			return;
		}

		const today = startOfDay(new Date());
		const bucket = BUCKETS.find((b) => b.id === this.activeTab);

		for (const note of notes.slice(0, this.visibleNotes)) {
			const row = container.createDiv({
				cls: `obsave-note-row ${bucket?.modifier ?? ""}`,
			});
			row.setAttribute("role", "button");
			row.setAttribute("tabindex", "0");
			setTooltip(row, note.path);

			const icon = row.createDiv({ cls: "obsave-note-icon" });
			setIcon(icon, bucket?.icon ?? "file-text");

			row.createSpan({ cls: "obsave-note-title", text: note.title });
			row.createSpan({
				cls: "obsave-note-due",
				text: formatRelativeDue(note.due, today),
			});
			row.createSpan({ cls: "obsave-note-folder", text: note.folder });

			const open = (): void => void this.openNote(note.path);
			row.addEventListener("click", open);
			row.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					open();
				}
			});
		}

		const remaining = notes.length - Math.min(this.visibleNotes, notes.length);
		if (remaining > 0) {
			const more = container.createEl("button", {
				cls: "obsave-link-button",
				text: `Mostrar ${Math.min(remaining, VISIBLE_NOTES_STEP)} más de ${remaining}`,
			});
			more.addEventListener("click", () => {
				this.visibleNotes += VISIBLE_NOTES_STEP;
				this.renderList();
			});
		}
	}

	private async openNote(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`No se encontró ${path}`);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
		this.close();
	}
}
