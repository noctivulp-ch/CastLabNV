import {int, integer, sqliteTable, text} from "drizzle-orm/sqlite-core";

export const playlistsTable = sqliteTable("playlists_table", {
    id: int().primaryKey({autoIncrement: true}),
    name: text().notNull().unique(),
    assets: text({mode: 'json'}),
    created_at: integer({mode: 'timestamp'}),
    updated_at: integer({mode: 'timestamp'})
});

/**
 * Table for storing video extraction history
 */
export const extractedVideosTable = sqliteTable("extracted_videos_table", {
    id: int().primaryKey({autoIncrement: true}),
    video_id: text().notNull(), // Unique ID from ExtractedVideo
    url: text().notNull(), // Video URL
    title: text().notNull(), // Video title
    thumbnail: text(), // Optional thumbnail URL
    format: text(), // Video format (e.g., "720p", "MP4")
    dlna_compat: text(), // DLNA compatibility: 'compatible' | 'unsupported' | null
    source: text().notNull(), // Source type: 'video-tag' | 'direct-link' | 'data-attribute' | 'm3u-playlist'
    source_url: text().notNull(), // Original webpage URL
    page_title: text(), // Original page title
    extracted_at: integer({mode: 'timestamp'}).notNull(), // When extraction happened
});