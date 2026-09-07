import { App, Modal, Notice, TFile } from "obsidian";
import { parseFrontmatter } from "../utils/frontmatter";

interface VaultMetrics {
	totalFolders: number;
	totalNotes: number;
	overdue: string[];
	today: string[];
	thisWeek: string[];
	attended: string[];
	byFolder: Map<string, number>;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateOnly(value: string | undefined): Date | null {
	if (!value) return null;
	const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return null;
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isTaskCompleted(body: string): boolean {
	return /- \[x\]/i.test(body);
}

async function computeVaultMetrics(app: App): Promise<VaultMetrics> {
	const today = startOfDay(new Date());
	const weekEnd = new Date(today);
	weekEnd.setDate(weekEnd.getDate() + 7);

	const metrics: VaultMetrics = {
		totalFolders: app.vault.getAllFolders().length,
		totalNotes: app.vault.getMarkdownFiles().length,
		overdue: [],
		today: [],
		thisWeek: [],
		attended: [],
		byFolder: new Map(),
	};

	for (const file of app.vault.getMarkdownFiles()) {
		const folder = file.parent?.path ?? "/";
		metrics.byFolder.set(folder, (metrics.byFolder.get(folder) ?? 0) + 1);

		const content = await app.vault.read(file);
		const { frontmatter, body } = parseFrontmatter(content);
		const estado = (frontmatter.estado ?? "").toLowerCase();
		const attended =
			estado === "atendido" || isTaskCompleted(body) || /✅/.test(body);

		if (attended) {
			metrics.attended.push(file.path);
			continue;
		}

		const due = parseDateOnly(frontmatter.fecha_atencion);
		if (!due) continue;

		if (due.getTime() < today.getTime()) {
			metrics.overdue.push(file.path);
		} else if (due.getTime() === today.getTime()) {
			metrics.today.push(file.path);
		} else if (due.getTime() <= weekEnd.getTime()) {
			metrics.thisWeek.push(file.path);
		}
	}

	return metrics;
}

export class VaultReportModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("obsave-vault-report-modal");
		titleEl.setText("Informe operativo de bóveda");

		contentEl.createEl("p", {
			text: "Calculando métricas…",
			cls: "setting-item-description",
		});

		void this.renderReport(contentEl);
	}

	onClose(): void {
		this.modalEl.removeClass("obsave-vault-report-modal");
		this.contentEl.empty();
	}

	private async renderReport(containerEl: HTMLElement): Promise<void> {
		try {
			const metrics = await computeVaultMetrics(this.app);
			containerEl.empty();

			this.renderCounters(containerEl, metrics);
			this.renderOperationalSection(containerEl, "🚨 Atrasadas / Vencidas", metrics.overdue);
			this.renderOperationalSection(containerEl, "📅 Para Hoy", metrics.today);
			this.renderOperationalSection(containerEl, "📆 Esta Semana", metrics.thisWeek);
			this.renderOperationalSection(containerEl, "✅ Atendidas", metrics.attended);
			this.renderFolderBreakdown(containerEl, metrics);
		} catch (error) {
			containerEl.empty();
			containerEl.createEl("p", {
				text:
					error instanceof Error
						? error.message
						: "No se pudo generar el informe.",
				cls: "obsave-alert",
			});
		}
	}

	private renderCounters(containerEl: HTMLElement, metrics: VaultMetrics): void {
		const card = containerEl.createDiv({ cls: "obsave-status-card" });
		card.createEl("h4", { text: "Contadores globales" });
		this.addRow(card, "Total de carpetas", String(metrics.totalFolders));
		this.addRow(card, "Total de notas .md", String(metrics.totalNotes));
	}

	private renderOperationalSection(
		containerEl: HTMLElement,
		title: string,
		paths: string[],
	): void {
		containerEl.createEl("h4", {
			text: `${title} (${paths.length})`,
			cls: "obsave-section-heading",
		});
		if (paths.length === 0) {
			containerEl.createEl("p", {
				text: "Sin registros.",
				cls: "setting-item-description",
			});
			return;
		}

		const list = containerEl.createEl("ul", { cls: "obsave-report-list" });
		for (const path of paths.slice(0, 50)) {
			const item = list.createEl("li");
			const link = item.createEl("a", { text: path, href: "#" });
			link.addEventListener("click", (event) => {
				event.preventDefault();
				void this.openNote(path);
			});
		}
		if (paths.length > 50) {
			containerEl.createEl("p", {
				text: `… y ${paths.length - 50} más.`,
				cls: "setting-item-description",
			});
		}
	}

	private renderFolderBreakdown(containerEl: HTMLElement, metrics: VaultMetrics): void {
		containerEl.createEl("h4", {
			text: "Desglose por carpetas",
			cls: "obsave-section-heading",
		});
		const list = containerEl.createEl("ul", { cls: "obsave-report-list" });
		const entries = [...metrics.byFolder.entries()].sort((a, b) =>
			a[0].localeCompare(b[0]),
		);
		for (const [folder, count] of entries) {
			list.createEl("li", { text: `${folder}: ${count} nota(s)` });
		}
	}

	private addRow(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv({ cls: "obsave-status-row" });
		row.createSpan({ cls: "obsave-status-label", text: label });
		row.createSpan({ cls: "obsave-status-value", text: value });
	}

	private async openNote(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`No se encontró ${path}`);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
