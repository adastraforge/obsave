import { Platform } from "obsidian";

/** Convierte `Mod+Alt+N` → `Cmd+Alt+N` (macOS) o `Ctrl+Alt+N` (Windows/Linux). */
export function formatShortcutLabel(shortcut: string): string {
	const mod = Platform.isMacOS ? "Cmd" : "Ctrl";
	return shortcut.replace(/\bMod\b/g, mod);
}
