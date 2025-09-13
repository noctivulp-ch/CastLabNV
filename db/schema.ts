import {int, integer, sqliteTable, text} from "drizzle-orm/sqlite-core";

export const playlistsTable = sqliteTable("playlists_table", {
    id: int().primaryKey({autoIncrement: true}),
    name: text().notNull().unique(),
    assets: text({mode: 'json'}),
    created_at: integer({mode: 'timestamp'}),
    updated_at: integer({mode: 'timestamp'})
});