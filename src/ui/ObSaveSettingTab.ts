import { App, PluginSettingTab, Setting } from "obsidian";
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

		containerEl.createEl("h2", { text: "ObSave" });
		containerEl.createEl("p", {
			text: "Sincronización multi-repositorio — Ad Astra Forge",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Intervalo de sincronización")
			.setDesc("Minutos entre sincronizaciones automáticas (Fase 3).")
			.addText((text) =>
				text
					.setPlaceholder("15")
					.setValue(String(this.plugin.settings.syncIntervalMinutes))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0) {
							this.plugin.settings.syncIntervalMinutes = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Repositorio Master")
			.setDesc(
				this.plugin.settings.masterRepo
					? `${this.plugin.settings.masterRepo.label} (${this.plugin.settings.masterRepo.provider})`
					: "No configurado — Fase 2/3",
			)
			.setDisabled(true);

		new Setting(containerEl)
			.setName("Réplicas")
			.setDesc(`${this.plugin.settings.replicaRepos.length} configurada(s)`)
			.setDisabled(true);

		new Setting(containerEl)
			.setName("Última sincronización")
			.setDesc(this.plugin.settings.lastSyncAt ?? "Nunca")
			.setDisabled(true);

		new Setting(containerEl)
			.setName("Sincronizar ahora")
			.setDesc("Ejecuta un ciclo de sync manual (stub en Fase 1).")
			.addButton((btn) =>
				btn.setButtonText("Sincronizar").onClick(async () => {
					await this.plugin.runSync();
				}),
			);

		containerEl.createEl("hr");
		containerEl.createEl("p", {
			text: "Fase 1: MVP Git Core Simplificado",
			cls: "setting-item-description",
		});
	}
}
