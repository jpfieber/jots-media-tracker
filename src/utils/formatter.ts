// src/utils/formatter.ts

/**
 * Formats a viewing entry for insertion into an Obsidian journal.
 * @param title - The title of the movie or TV show.
 * @param date - The date of viewing.
 * @param type - The type of content (movie or TV show).
 * @returns A formatted string for the journal entry.
 */
export function formatViewingEntry(title: string, date: string, type: 'movie' | 'tv'): string {
    return `${type === 'movie' ? '🎬' : '📺'} ${title} - Watched on ${date}`;
}

/**
 * Formats a list of viewing entries for insertion into an Obsidian journal.
 * @param entries - An array of viewing entries.
 * @returns A formatted string for the journal entries.
 */
export function formatViewingEntries(entries: Array<{ title: string; date: string; type: 'movie' | 'tv' }>): string {
    return entries.map(entry => formatViewingEntry(entry.title, entry.date, entry.type)).join('\n');
}