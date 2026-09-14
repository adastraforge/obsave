import type { App } from "obsidian";
import { Notice, setIcon, setTooltip, TFile } from "obsidian";
import {
	firstStatus,
	resolveStatus,
	statusIcon,
	type NoteStatus,
	type ObSaveSettings,
} from "../settings";

type TimeBucketId = "overdue" | "today" | "week" | "attended";
type CategoryMode = "time" | "status";

interface NoteRef {
	path: string;
	title: string;
	folder: string;
	due: Date | null;
	status: NoteStatus;
	overdue: boolean;
}

interface FolderCount {
	folder: string;
	count: number;
}

interface TimeBucketDefinition {
	id: TimeBucketId;
	label: string;
	icon: string;
	color: string;
}

interface VaultMetrics {
	totalFolders: number;
	totalNotes: number;
	timeBuckets: Record<TimeBucketId, NoteRef[]>;
	statusBuckets: Record<string, NoteRef[]>;
	byFolder: FolderCount[];
	unscheduled: number;
	healthPercent: number;
	unclassified: number;
}

const TIME_BUCKETS: TimeBucketDefinition[] = [
	{ id: "overdue", label: "Vencidas", icon: "alert-triangle", color: "#EF4444" },
	{ id: "today", label: "Para hoy", icon: "clock", color: "#F97316" },
	{ id: "week", label: "Esta semana", icon: "calendar-days", color: "#3B82F6" },
	{ id: "attended", label: "Atendidas", icon: "check-circle-2", color: "#22C55E" },
];

const VISIBLE_NOTES_STEP = 15;
const VISIBLE_FOLDERS = 6;
/** Circunferencia exacta de 100 → `stroke-dasharray` se expresa en porcentaje. */
const DONUT_RADIUS = 15.9155;

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

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

function applyAccent(el: HTMLElement, color: string): void {
	el.style.setProperty("--obsave-accent", color);
}

/**
 * Salud: positivos suman 1, negativos restan 1 (2 si además está vencida),
 * neutrales no entran en el cociente.
 */
function computeHealth(notes: NoteRef[]): number {
	let positive = 0;
	let negative = 0;

	for (const note of notes) {
		if (note.status.healthImpact === "positive") {
			positive += 1;
		} else if (note.status.healthImpact === "negative") {
			negative += note.overdue ? 2 : 1;
		}
	}

	const weight = positive + negative;
	if (weight === 0) {
		return 100;
	}
	return Math.round((positive / weight) * 100);
}

function computeVaultMetrics(app: App, settings: ObSaveSettings): VaultMetrics {
	const today = startOfDay(new Date());
	const weekEnd = new Date(today);
	weekEnd.setDate(weekEnd.getDate() + 7);

	const fallback = firstStatus(settings);
	const timeBuckets: Record<TimeBucketId, NoteRef[]> = {
		overdue: [],
		today: [],
		week: [],
		attended: [],
	};
	const statusBuckets: Record<string, NoteRef[]> = {};
	for (const status of settings.statuses) {
		statusBuckets[status.id] = [];
	}

	const folderCounts = new Map<string, number>();
	const files = app.vault.getMarkdownFiles();
	const classified: NoteRef[] = [];
	let unscheduled = 0;
	let unclassified = 0;

	for (const file of files) {
		const folder = file.parent?.path || "/";
		folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);

		const cache = app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const status =
			resolveStatus(frontmatter?.estado, settings.statuses) ?? fallback;
		const due = toDateOnly(frontmatter?.fecha_atencion);
		const overdue = due !== null && due.getTime() < today.getTime();

		if (resolveStatus(frontmatter?.estado, settings.statuses) === null) {
			unclassified++;
		}

		const ref: NoteRef = {
			path: file.path,
			title: file.basename,
			folder,
			due,
			status,
			overdue,
		};
		classified.push(ref);
		statusBuckets[status.id]?.push(ref);

		if (status.healthImpact === "positive") {
			timeBuckets.attended.push(ref);
			continue;
		}
		if (!due) {
			unscheduled++;
			continue;
		}

		const time = due.getTime();
		if (time < today.getTime()) {
			timeBuckets.overdue.push(ref);
		} else if (time === today.getTime()) {
			timeBuckets.today.push(ref);
		} else if (time <= weekEnd.getTime()) {
			timeBuckets.week.push(ref);
		} else {
			unscheduled++;
		}
	}

	const byDueDate = (a: NoteRef, b: NoteRef): number =>
		(a.due?.getTime() ?? Number.POSITIVE_INFINITY) -
		(b.due?.getTime() ?? Number.POSITIVE_INFINITY);

	timeBuckets.overdue.sort(byDueDate);
	timeBuckets.today.sort(byDueDate);
	timeBuckets.week.sort(byDueDate);
	timeBuckets.attended.sort((a, b) => a.title.localeCompare(b.title));
	for (const status of settings.statuses) {
		statusBuckets[status.id].sort(byDueDate);
	}

	return {
		totalFolders: app.vault.getAllFolders().length,
		totalNotes: files.length,
		timeBuckets,
		statusBuckets,
		byFolder: [...folderCounts.entries()]
			.map(([folder, count]) => ({ folder, count }))
			.sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder)),
		unscheduled,
		healthPercent: computeHealth(classified),
		unclassified,
	};
}

/**
 * Dashboard de métricas: colores de estado unificados en KPI, pestañas y dona.
 */
export class VaultReportDashboard {
	private metrics: VaultMetrics | null = null;
	private initialized = false;
	private categoryMode: CategoryMode = "time";
	private activeTimeTab: TimeBucketId = "overdue";
	private activeStatusId = "";
	private visibleNotes = VISIBLE_NOTES_STEP;
	private showAllFolders = false;
	private filter = "";
	private listEl: HTMLElement | null = null;
	private tabEls = new Map<string, HTMLElement>();
	private kpiEls = new Map<string, HTMLElement>();

	constructor(
		private app: App,
		private containerEl: HTMLElement,
		private settings: ObSaveSettings,
	) {}

	render(): void {
		const contentEl = this.containerEl;
		contentEl.empty();
		this.tabEls.clear();
		this.kpiEls.clear();

		try {
			this.metrics = computeVaultMetrics(this.app, this.settings);
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
			this.activeStatusId = this.settings.statuses[0]?.id ?? "";
			this.activeTimeTab = this.defaultTimeTab(metrics);
			this.initialized = true;
		}
		if (!this.settings.statuses.some((status) => status.id === this.activeStatusId)) {
			this.activeStatusId = this.settings.statuses[0]?.id ?? "";
		}
		this.visibleNotes = VISIBLE_NOTES_STEP;

		this.renderSummaryBar(contentEl, metrics);
		this.renderKpiGrid(contentEl, metrics);
		this.renderCharts(contentEl, metrics);
		this.renderTabs(contentEl, metrics);

		this.listEl = contentEl.createDiv({ cls: "obsave-report-panel" });
		this.renderList();
	}

	private defaultTimeTab(metrics: VaultMetrics): TimeBucketId {
		for (const bucket of TIME_BUCKETS) {
			if (metrics.timeBuckets[bucket.id].length > 0) {
				return bucket.id;
			}
		}
		return "overdue";
	}

	/** «Atendidas» hereda el color del primer estado positivo configurado. */
	private timeColor(bucket: TimeBucketDefinition): string {
		if (bucket.id !== "attended") {
			return bucket.color;
		}
		return (
			this.settings.statuses.find(
				(status) => status.healthImpact === "positive",
			)?.color ?? bucket.color
		);
	}

	private renderSummaryBar(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const bar = containerEl.createDiv({ cls: "obsave-report-summary" });
		const extra =
			metrics.unclassified > 0
				? ` · ${metrics.unclassified} sin estado conocido`
				: "";
		bar.createSpan({
			cls: "obsave-report-summary-text",
			text: `${metrics.totalNotes} notas · ${metrics.totalFolders} carpetas · ${metrics.unscheduled} sin programar${extra}`,
		});

		const actions = bar.createDiv({ cls: "obsave-report-summary-actions" });

		const modes = actions.createDiv({ cls: "obsave-cat-toggle" });
		this.renderModeButton(modes, "time", "Tiempo");
		this.renderModeButton(modes, "status", "Estado");

		const refresh = actions.createEl("button", { cls: "obsave-icon-button" });
		setIcon(refresh, "refresh-cw");
		setTooltip(refresh, "Recalcular métricas");
		refresh.setAttribute("aria-label", "Recalcular métricas");
		refresh.addEventListener("click", () => this.render());
	}

	private renderKpiGrid(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const grid = containerEl.createDiv({ cls: "obsave-kpi-grid" });

		if (this.categoryMode === "time") {
			for (const bucket of TIME_BUCKETS) {
				this.renderKpiCard(grid, {
					key: `time:${bucket.id}`,
					label: bucket.label,
					icon: bucket.icon,
					color: this.timeColor(bucket),
					count: metrics.timeBuckets[bucket.id].length,
					onActivate: () => this.setActiveTime(bucket.id),
				});
			}
		} else {
			for (const status of this.settings.statuses) {
				this.renderKpiCard(grid, {
					key: `status:${status.id}`,
					label: status.name,
					icon: statusIcon(status.healthImpact),
					color: status.color,
					count: metrics.statusBuckets[status.id]?.length ?? 0,
					onActivate: () => this.setActiveStatus(status.id),
				});
			}
		}

		this.syncActiveStyles();
	}

	private renderKpiCard(
		containerEl: HTMLElement,
		spec: {
			key: string;
			label: string;
			icon: string;
			color: string;
			count: number;
			onActivate: () => void;
		},
	): void {
		const card = containerEl.createDiv({ cls: "obsave-kpi-card" });
		applyAccent(card, spec.color);
		card.setAttribute("role", "button");
		card.setAttribute("tabindex", "0");
		card.setAttribute("aria-label", `${spec.label}: ${spec.count} notas`);
		setTooltip(card, `Ver ${spec.label.toLowerCase()}`);

		const iconEl = card.createDiv({ cls: "obsave-kpi-icon" });
		setIcon(iconEl, spec.icon);
		card.createDiv({ cls: "obsave-kpi-value", text: String(spec.count) });
		card.createDiv({ cls: "obsave-kpi-label", text: spec.label });

		card.addEventListener("click", spec.onActivate);
		card.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				spec.onActivate();
			}
		});

		this.kpiEls.set(spec.key, card);
	}

	private renderCharts(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const row = containerEl.createDiv({ cls: "obsave-report-charts" });
		this.renderHealthDonut(row, metrics);
		this.renderFolderBars(row, metrics);
	}

	private renderHealthDonut(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const panel = containerEl.createDiv({ cls: "obsave-chart-panel" });
		panel.createDiv({ cls: "obsave-chart-title", text: "Salud de la bóveda" });

		const svg = panel.createSvg("svg", {
			cls: "obsave-donut",
			attr: { viewBox: "0 0 42 42", role: "img" },
		});
		svg.setAttribute(
			"aria-label",
			`Salud ${metrics.healthPercent} %`,
		);

		svg.createSvg("circle", {
			cls: "obsave-donut-track",
			attr: { cx: "21", cy: "21", r: String(DONUT_RADIUS) },
		});

		const total = Math.max(metrics.totalNotes, 1);
		let offset = 0;
		for (const status of this.settings.statuses) {
			const count = metrics.statusBuckets[status.id]?.length ?? 0;
			if (count === 0) {
				continue;
			}
			const pct = (count / total) * 100;
			svg.createSvg("circle", {
				cls: "obsave-donut-segment",
				attr: {
					cx: "21",
					cy: "21",
					r: String(DONUT_RADIUS),
					stroke: status.color,
					"stroke-dasharray": `${pct} ${100 - pct}`,
					"stroke-dashoffset": String(-offset),
				},
			});
			offset += pct;
		}

		const label = svg.createSvg("text", {
			cls: "obsave-donut-text",
			attr: { x: "21", y: "22.5" },
		});
		label.textContent = `${metrics.healthPercent} %`;

		const legend = panel.createDiv({ cls: "obsave-donut-legend" });
		for (const status of this.settings.statuses) {
			const count = metrics.statusBuckets[status.id]?.length ?? 0;
			const item = legend.createDiv({ cls: "obsave-legend-item" });
			const dot = item.createSpan({ cls: "obsave-legend-dot" });
			applyAccent(dot, status.color);
			item.createSpan({ text: `${status.name} · ${count}` });
		}
		legend.createDiv({
			cls: "obsave-donut-hint",
			text: "Positivos suman · negativos restan · vencidas negativas ×2",
		});
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

		if (this.categoryMode === "time") {
			for (const bucket of TIME_BUCKETS) {
				const count = metrics.timeBuckets[bucket.id].length;
				const color = this.timeColor(bucket);
				const tab = tabs.createEl("button", { cls: "obsave-report-tab" });
				applyAccent(tab, color);
				tab.createSpan({ text: bucket.label });
				const badge = tab.createSpan({
					cls: "obsave-tab-badge",
					text: String(count),
				});
				applyAccent(badge, color);
				tab.addEventListener("click", () => this.setActiveTime(bucket.id));
				this.tabEls.set(`time:${bucket.id}`, tab);
			}
		} else {
			for (const status of this.settings.statuses) {
				const count = metrics.statusBuckets[status.id]?.length ?? 0;
				const tab = tabs.createEl("button", { cls: "obsave-report-tab" });
				applyAccent(tab, status.color);
				tab.createSpan({ text: status.name });
				const badge = tab.createSpan({
					cls: "obsave-tab-badge",
					text: String(count),
				});
				applyAccent(badge, status.color);
				tab.addEventListener("click", () => this.setActiveStatus(status.id));
				this.tabEls.set(`status:${status.id}`, tab);
			}
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

	private renderModeButton(
		containerEl: HTMLElement,
		mode: CategoryMode,
		label: string,
	): void {
		const btn = containerEl.createEl("button", {
			cls: "obsave-cat-toggle-btn",
			text: label,
		});
		btn.toggleClass("is-active", this.categoryMode === mode);
		btn.addEventListener("click", () => {
			if (this.categoryMode === mode) {
				return;
			}
			this.categoryMode = mode;
			this.visibleNotes = VISIBLE_NOTES_STEP;
			this.render();
		});
	}

	private setActiveTime(id: TimeBucketId): void {
		this.activeTimeTab = id;
		this.visibleNotes = VISIBLE_NOTES_STEP;
		this.syncActiveStyles();
		this.renderList();
	}

	private setActiveStatus(id: string): void {
		this.activeStatusId = id;
		this.visibleNotes = VISIBLE_NOTES_STEP;
		this.syncActiveStyles();
		this.renderList();
	}

	private activeKey(): string {
		return this.categoryMode === "time"
			? `time:${this.activeTimeTab}`
			: `status:${this.activeStatusId}`;
	}

	private syncActiveStyles(): void {
		const activeKey = this.activeKey();

		for (const [key, el] of this.tabEls) {
			el.toggleClass("is-active", key === activeKey);
		}
		for (const [key, el] of this.kpiEls) {
			el.toggleClass("is-active", key === activeKey);
		}
	}

	private activeNotes(): NoteRef[] {
		const metrics = this.metrics;
		if (!metrics) {
			return [];
		}
		if (this.categoryMode === "time") {
			return metrics.timeBuckets[this.activeTimeTab];
		}
		return metrics.statusBuckets[this.activeStatusId] ?? [];
	}

	private renderList(): void {
		const container = this.listEl;
		const metrics = this.metrics;
		if (!container || !metrics) {
			return;
		}

		container.empty();

		const needle = this.filter.trim().toLowerCase();
		const all = this.activeNotes();
		const notes = needle
			? all.filter(
					(note) =>
						note.title.toLowerCase().includes(needle) ||
						note.folder.toLowerCase().includes(needle) ||
						note.status.name.toLowerCase().includes(needle),
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
		const timeBucket = TIME_BUCKETS.find((bucket) => bucket.id === this.activeTimeTab);

		for (const note of notes.slice(0, this.visibleNotes)) {
			const color =
				this.categoryMode === "status"
					? note.status.color
					: timeBucket
						? this.timeColor(timeBucket)
						: note.status.color;
			const iconName =
				this.categoryMode === "status"
					? statusIcon(note.status.healthImpact)
					: (timeBucket?.icon ?? "file-text");

			const row = container.createDiv({ cls: "obsave-note-row" });
			applyAccent(row, color);
			row.setAttribute("role", "button");
			row.setAttribute("tabindex", "0");
			setTooltip(row, note.path);

			const icon = row.createDiv({ cls: "obsave-note-icon" });
			setIcon(icon, iconName);

			row.createSpan({ cls: "obsave-note-title", text: note.title });
			row.createSpan({
				cls: "obsave-note-due",
				text: formatRelativeDue(note.due, today),
			});
			row.createSpan({
				cls: "obsave-note-folder",
				text:
					this.categoryMode === "time"
						? note.status.name
						: note.folder,
			});

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

		const leaf =
			this.app.workspace.getMostRecentLeaf() ??
			this.app.workspace.getLeaf("tab");
		await leaf.openFile(file);
	}
}
