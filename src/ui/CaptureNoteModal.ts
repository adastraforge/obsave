import type { App, TextComponent } from "obsidian";
import { Modal, Setting } from "obsidian";
import { createCaptureNote, listDestinationFolders } from "../productivity/noteCapture";
import { firstStatus, firstType } from "../settings";
import { formatTodayDate } from "../utils/frontmatter";
import type ObSavePlugin from "../main";

export class CaptureNoteModal extends Modal {
	private title = "";
	private folder = "00_Diarias";
	private fechaAtencion = formatTodayDate();
	private tags = "";
	private tipoId = "";
	private estadoId = "";
	private titleInput: TextComponent | undefined;
	private alertEl: HTMLElement | undefined;

	constructor(
		app: App,
		private plugin: ObSavePlugin,
		private onCreated?: () => void,
	) {
		super(app);
		this.tipoId = firstType(plugin.settings).id;
		this.estadoId = firstStatus(plugin.settings).id;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		titleEl.setText("Nueva nota");

		this.alertEl = contentEl.createDiv({ cls: "obsave-alert hidden" });

		new Setting(contentEl)
			.setName("Título")
			.setTooltip("Si lo dejas vacío se genera un nombre con la fecha y la hora.")
			.addText((text) => {
				this.titleInput = text;
				text.setPlaceholder("Mi nota").onChange((v) => {
					this.title = v;
					this.clearError();
				});
			});

		const folders = listDestinationFolders(this.app);
		new Setting(contentEl)
			.setName("Carpeta destino")
			.addDropdown((dropdown) => {
				for (const folder of folders) {
					dropdown.addOption(folder, folder);
				}
				dropdown.setValue(this.folder).onChange((v) => {
					this.folder = v;
				});
			});

		new Setting(contentEl)
			.setName("Tipo")
			.addDropdown((dropdown) => {
				for (const type of this.plugin.settings.types) {
					dropdown.addOption(type.id, type.name);
				}
				dropdown.setValue(this.tipoId).onChange((v) => {
					this.tipoId = v;
				});
			});

		new Setting(contentEl)
			.setName("Estado")
			.addDropdown((dropdown) => {
				for (const status of this.plugin.settings.statuses) {
					dropdown.addOption(status.id, status.name);
				}
				dropdown.setValue(this.estadoId).onChange((v) => {
					this.estadoId = v;
				});
			});

		new Setting(contentEl)
			.setName("Fecha de atención")
			.addText((text) =>
				text
					.setValue(this.fechaAtencion)
					.setPlaceholder("YYYY-MM-DD")
					.onChange((v) => {
						this.fechaAtencion = v;
					}),
			);

		new Setting(contentEl)
			.setName("Tags adicionales")
			.setTooltip("Separados por coma. La almohadilla es opcional.")
			.addText((text) =>
				text.setPlaceholder("urgente, cliente").onChange((v) => {
					this.tags = v;
				}),
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Crear nota")
				.setCta()
				.onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText("Creando…");
					try {
						const extraTags = this.tags
							.split(",")
							.map((tag) => tag.trim())
							.filter(Boolean);
						await createCaptureNote(this.app, this.plugin.settings, {
							title: this.title,
							folder: this.folder,
							fechaAtencion: this.fechaAtencion,
							extraTags,
							tipoId: this.tipoId,
							estadoId: this.estadoId,
						});
						this.onCreated?.();
						this.close();
					} catch (error) {
						this.showError(
							error instanceof Error
								? error.message
								: "No se pudo crear la nota.",
						);
					} finally {
						btn.setDisabled(false);
						btn.setButtonText("Crear nota");
					}
				}),
		);
	}

	private showError(message: string): void {
		if (!this.alertEl) return;
		this.alertEl.empty();
		this.alertEl.removeClass("hidden");
		this.alertEl.createSpan({ text: message });
		this.titleInput?.inputEl.addClass("obsave-input-error");
		this.titleInput?.inputEl.focus();
	}

	private clearError(): void {
		this.alertEl?.empty();
		this.alertEl?.addClass("hidden");
		this.titleInput?.inputEl.removeClass("obsave-input-error");
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
