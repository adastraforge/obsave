import { Platform } from "obsidian";

/**
 * Convierte atajos internos a etiquetas legibles:
 * macOS: `Mod+Alt+N` → `Cmd+Option+N`
 * Windows/Linux: `Mod+Alt+N` → `Ctrl+Alt+N`
 */
export function formatShortcutLabel(shortcut: string): string {
	if (Platform.isMacOS) {
		return shortcut.replace(/\bMod\b/g, "Cmd").replace(/\bAlt\b/g, "Option");
	}
	return shortcut.replace(/\bMod\b/g, "Ctrl");
}
