import { App, PluginSettingTab, setIcon, setTooltip } from "obsidian";
import { CaptureNoteModal } from "./CaptureNoteModal";
import { openObSaveHub } from "./ObSaveSidebarView";
import {
	generateVaultTemplateFolders,
	VAULT_TEMPLATE_FOLDERS,
} from "../productivity/vaultStructure";
import { createQuickDailyNote } from "../productivity/noteCapture";
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
					() => void createQuickDailyNote(this.app),
				);
				this.renderActionButton(
					section,
					"Nueva nota",
					"file-plus",
					"Elige carpeta, fecha de atención y etiquetas antes de crear la nota.",
					() => new CaptureNoteModal(this.app).open(),
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
