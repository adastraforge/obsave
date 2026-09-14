import { App, Notice, PluginSettingTab, Setting, setIcon, setTooltip } from "obsidian";
import { CaptureNoteModal } from "./CaptureNoteModal";
import { openObSaveHub } from "./ObSaveSidebarView";
import {
	generateVaultTemplateFolders,
	VAULT_TEMPLATE_FOLDERS,
} from "../productivity/vaultStructure";
import { createQuickDailyNote } from "../productivity/noteCapture";
import {
	HEALTH_IMPACT_OPTIONS,
	STATUS_COLOR_PALETTE,
	uniqueEntityId,
	type HealthImpact,
	type NoteStatus,
	type NoteType,
} from "../settings";
import type ObSavePlugin from "../main";

export class ObSaveSettingTab extends PluginSettingTab {
	plugin: ObSavePlugin;

	constructor(app: App, plugin: ObSavePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("obsave-settings");

		this.renderHeader(containerEl);
		this.renderHomeView(containerEl);
		this.renderFooter(containerEl);
	}

	openMainPanel(): void {
		this.display();
	}

	private renderHeader(containerEl: HTMLElement): void {
		const header = containerEl.createDiv({ cls: "obsave-header" });
		header.createEl("h2", { text: "ObSave", cls: "obsave-header-title" });
		header.createSpan({
			cls: "obsave-version-chip",
			text: `v${this.plugin.manifest.version}`,
		});
	}

	private renderFooter(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			text: "Ad Astra Forge — libre y de código abierto",
			cls: "obsave-footer",
		});
	}

	private renderHomeView(containerEl: HTMLElement): void {
		this.renderHomeSection(
			containerEl,
			"Estructura de bóveda",
			"obsave-home-section-structure",
			"folder-tree",
			null,
			(section) => {
				const chips = section.createDiv({ cls: "obsave-chip-row" });
				for (const folder of VAULT_TEMPLATE_FOLDERS) {
					chips.createSpan({ cls: "obsave-chip", text: folder });
				}
				this.renderActionButton(
					section,
					"Generar carpetas",
					"folder-plus",
					"Crea en disco las carpetas de plantilla que falten. Operación 100 % local.",
					() => void generateVaultTemplateFolders(this.app),
				);
			},
		);

		this.renderHomeSection(
			containerEl,
			"Configuración de propiedades",
			"obsave-home-section-properties",
			"tags",
			"Las notas nuevas usan el primer estado y el primer tipo de cada lista. Los colores se aplican en el Hub.",
			(section) => {
				this.renderStatusManager(section);
				this.renderTypeManager(section);
			},
		);

		this.renderHomeSection(
			containerEl,
			"Herramientas",
			"obsave-home-section-tools",
			"wrench",
			"Puedes asignar atajos de teclado a estas acciones desde Ajustes → Atajos.",
			(section) => {
				this.renderActionButton(
					section,
					"Nota rápida",
					"zap",
					"Crea una nota en 00_Diarias y abre el editor listo para escribir.",
					() => void createQuickDailyNote(this.app, this.plugin.settings),
				);
				this.renderActionButton(
					section,
					"Nueva nota",
					"file-plus",
					"Elige carpeta, fecha de atención y etiquetas antes de crear la nota.",
					() => new CaptureNoteModal(this.app, this.plugin).open(),
				);
				this.renderActionButton(
					section,
					"ObSave Hub",
					"layout-dashboard",
					"Abre el panel lateral con métricas y accesos de captura; sigue visible mientras editas.",
					() => {
						this.closeSettingsWindow();
						void openObSaveHub(this.app);
					},
				);
			},
		);
	}

	private renderStatusManager(containerEl: HTMLElement): void {
		containerEl.createEl("h4", {
			cls: "obsave-property-subtitle",
			text: "Gestor de estados",
		});

		const list = containerEl.createDiv({ cls: "obsave-property-list" });
		const statuses = this.plugin.settings.statuses;

		statuses.forEach((status, index) => {
			this.renderStatusRow(list, status, index, statuses.length);
		});

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Añadir estado").onClick(() => {
				const used = new Set(statuses.map((item) => item.color.toUpperCase()));
				const color =
					STATUS_COLOR_PALETTE.find((hex) => !used.has(hex)) ?? "#3B82F6";
				const name = "Nuevo estado";
				statuses.push({
					id: uniqueEntityId(name, statuses, "estado"),
					name,
					color,
					healthImpact: "neutral",
				});
				void this.plugin.saveSettings();
				this.display();
			}),
		);
	}

	private renderStatusRow(
		containerEl: HTMLElement,
		status: NoteStatus,
		index: number,
		total: number,
	): void {
		const row = containerEl.createDiv({ cls: "obsave-status-row" });

		const order = row.createDiv({ cls: "obsave-status-order" });
		this.iconAction(order, "chevron-up", "Subir", index === 0, () =>
			this.moveStatus(index, -1),
		);
		this.iconAction(order, "chevron-down", "Bajar", index === total - 1, () =>
			this.moveStatus(index, 1),
		);

		const fields = row.createDiv({ cls: "obsave-status-fields" });

		const nameInput = fields.createEl("input", {
			cls: "obsave-status-name",
			attr: { type: "text", "aria-label": "Nombre del estado" },
		});
		nameInput.value = status.name;
		nameInput.addEventListener("change", () => {
			const name = nameInput.value.trim();
			if (!name) {
				nameInput.value = status.name;
				return;
			}
			status.name = name;
			void this.plugin.saveSettings();
		});

		this.renderColorPicker(fields, status);

		const impact = fields.createEl("select", {
			cls: "dropdown obsave-status-impact",
			attr: { "aria-label": "Impacto en salud" },
		});
		for (const option of HEALTH_IMPACT_OPTIONS) {
			impact.createEl("option", {
				text: option.label,
				attr: { value: option.id },
			});
		}
		impact.value = status.healthImpact;
		impact.addEventListener("change", () => {
			status.healthImpact = impact.value as HealthImpact;
			void this.plugin.saveSettings();
		});

		this.iconAction(
			row,
			"trash-2",
			"Eliminar estado",
			total <= 1,
			() => {
				if (this.plugin.settings.statuses.length <= 1) {
					new Notice("ObSave: hace falta al menos un estado.");
					return;
				}
				this.plugin.settings.statuses.splice(index, 1);
				void this.plugin.saveSettings();
				this.display();
			},
			"is-danger",
		);
	}

	private renderColorPicker(containerEl: HTMLElement, status: NoteStatus): void {
		const picker = containerEl.createDiv({ cls: "obsave-color-picker" });

		const swatches = picker.createDiv({ cls: "obsave-color-palette" });
		for (const hex of STATUS_COLOR_PALETTE) {
			const swatch = swatches.createEl("button", {
				cls: "obsave-color-swatch",
				attr: { type: "button", "aria-label": hex },
			});
			swatch.style.setProperty("--obsave-swatch", hex);
			swatch.toggleClass("is-selected", status.color.toUpperCase() === hex);
			swatch.addEventListener("click", () => {
				status.color = hex;
				void this.plugin.saveSettings();
				this.display();
			});
		}

		const custom = picker.createEl("input", {
			cls: "obsave-color-native",
			attr: { type: "color", "aria-label": "Color personalizado" },
		});
		custom.value = status.color;
		custom.addEventListener("change", () => {
			status.color = custom.value.toUpperCase();
			void this.plugin.saveSettings();
			this.display();
		});
	}

	private renderTypeManager(containerEl: HTMLElement): void {
		containerEl.createEl("h4", {
			cls: "obsave-property-subtitle",
			text: "Gestor de tipos",
		});

		const list = containerEl.createDiv({ cls: "obsave-property-list" });
		const types = this.plugin.settings.types;

		types.forEach((type, index) => {
			this.renderTypeRow(list, type, index, types.length);
		});

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Añadir tipo").onClick(() => {
				const name = "Nuevo tipo";
				types.push({
					id: uniqueEntityId(name, types, "tipo"),
					name,
				});
				void this.plugin.saveSettings();
				this.display();
			}),
		);
	}

	private renderTypeRow(
		containerEl: HTMLElement,
		type: NoteType,
		index: number,
		total: number,
	): void {
		const row = containerEl.createDiv({ cls: "obsave-type-row" });

		const nameInput = row.createEl("input", {
			cls: "obsave-status-name",
			attr: { type: "text", "aria-label": "Nombre del tipo" },
		});
		nameInput.value = type.name;
		nameInput.addEventListener("change", () => {
			const name = nameInput.value.trim();
			if (!name) {
				nameInput.value = type.name;
				return;
			}
			type.name = name;
			void this.plugin.saveSettings();
		});

		this.iconAction(
			row,
			"trash-2",
			"Eliminar tipo",
			total <= 1,
			() => {
				if (this.plugin.settings.types.length <= 1) {
					new Notice("ObSave: hace falta al menos un tipo.");
					return;
				}
				this.plugin.settings.types.splice(index, 1);
				void this.plugin.saveSettings();
				this.display();
			},
			"is-danger",
		);
	}

	private moveStatus(index: number, delta: number): void {
		const statuses = this.plugin.settings.statuses;
		const target = index + delta;
		if (target < 0 || target >= statuses.length) {
			return;
		}
		const [item] = statuses.splice(index, 1);
		statuses.splice(target, 0, item);
		void this.plugin.saveSettings();
		this.display();
	}

	private iconAction(
		containerEl: HTMLElement,
		icon: string,
		tooltip: string,
		disabled: boolean,
		onClick: () => void,
		extraClass?: string,
	): void {
		const btn = containerEl.createEl("button", {
			cls: `obsave-icon-button${extraClass ? ` ${extraClass}` : ""}`,
			attr: { type: "button" },
		});
		setIcon(btn, icon);
		setTooltip(btn, tooltip);
		btn.setAttribute("aria-label", tooltip);
		btn.disabled = disabled;
		btn.addEventListener("click", onClick);
	}

	private renderHomeSection(
		containerEl: HTMLElement,
		title: string,
		cls: string,
		icon: string,
		help: string | null,
		renderBody: (section: HTMLElement) => void,
	): void {
		const card = containerEl.createDiv({ cls: `obsave-home-section ${cls}` });
		const header = card.createDiv({ cls: "obsave-home-section-header" });

		const iconEl = header.createSpan({ cls: "obsave-home-section-icon" });
		setIcon(iconEl, icon);
		header.createEl("h3", { text: title, cls: "obsave-home-section-title" });

		if (help) {
			const hint = header.createSpan({ cls: "obsave-help-icon" });
			setIcon(hint, "help-circle");
			setTooltip(hint, help);
			hint.setAttribute("aria-label", help);
		}

		renderBody(card);
	}

	private renderActionButton(
		containerEl: HTMLElement,
		label: string,
		icon: string | null,
		tooltip: string | null,
		onClick: () => void,
	): void {
		const row = containerEl.createDiv({ cls: "obsave-tool-row" });
		const btn = row.createEl("button", { cls: "mod-cta obsave-tool-button" });

		if (icon) {
			const iconEl = btn.createSpan({ cls: "obsave-tool-button-icon" });
			setIcon(iconEl, icon);
		}
		btn.createSpan({ text: label });

		if (tooltip) {
			setTooltip(btn, tooltip);
			btn.setAttribute("aria-label", tooltip);
		}

		btn.addEventListener("click", onClick);
	}

	private closeSettingsWindow(): void {
		const app = this.app as App & { setting?: { close?: () => void } };
		app.setting?.close?.();
	}
}
