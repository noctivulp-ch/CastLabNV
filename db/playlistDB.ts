import {drizzle} from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';
import {eq} from "drizzle-orm/sql/expressions/conditions";
import {asc} from "drizzle-orm";
import PlayList from "../src/entities/PlayList";
import {playlistsTable} from "./schema";

const expo = SQLite.openDatabaseSync('db.db');
const db = drizzle(expo);

/**
 * Insert or Update a playlist in database
 * This methode is exported and has its own logic for inserting {@link insertPlayList} or updating {@link updatePlayList}
 * @param playlist {PlayList} - PlayList to store or update in db
 * @return id[]:number|null - the id of the inserted or updated element
 */
export const insertOrUpdatePlayList = async (playlist: PlayList) => {
    if (!playlist?.name) {
        return null;
    }
    const count = await db.$count(playlistsTable, eq(playlistsTable.name, playlist.name));
    if (count > 0) {
        return await updatePlayList(playlist);
    } else {
        return insertPlayList(playlist);
    }
}

/**
 * Insert a playlist in database
 * This methode is called by {@link insertOrUpdatePlayList}
 * @param playlist {PlayList} - PlayList to store or update in db
 * @return id[]:number - the id of the inserted element
 */
const insertPlayList = async (playlist: PlayList) => {
    if (!playlist?.name) {
        return null;
    }
    return db.insert(playlistsTable).values(
        {
            name: playlist.name,
            assets: JSON.stringify(playlist.assets),
            created_at: new Date(),
            updated_at: new Date(),
        }
    ).returning({id: playlistsTable.id});
}

/**
 * Update a playlist in database
 * This methode is called by {@link insertOrUpdatePlayList}
 * @param playList {PlayList} - PlayList to store or update in db
 * @return id[]:number - the id of the updated element
 */
export const updatePlayList = async (playList: PlayList) => {
    if (!playList?.id) {
        return null;
    }
    return db.update(playlistsTable).set(
        {
            name: playList.name,
            assets: JSON.stringify(playList.assets),
            updated_at: new Date(),
        }
    ).where(eq(playlistsTable.id, playList.id)).returning({id: playlistsTable.id});
}

/**
 * Delete a playlist from the database
 * @param playlist_id {number} - ID of the playlist
 */
export const deletePlaylist = async (playlist_id: number) => {
    return db.delete(playlistsTable).where(eq(playlistsTable.id, playlist_id));
}


/**
 * Returns all playlists in database
 */
export const getAllPlayLists = async (): Promise<PlayList[]> => {
    const playLists: PlayList[] = [];
    try {
        let results = await db.select().from(playlistsTable).orderBy(asc(playlistsTable.name));
        for (let playlistDB of results) {
            playLists.push({
                id: playlistDB.id,
                name: playlistDB.name,
                assets: playlistDB?.assets ? JSON.parse(playlistDB.assets as string) : null,
                created_at: playlistDB.created_at,
                updated_at: playlistDB.updated_at,
            });
        }
    } catch (err) {
        console.error(err);
    }
    return playLists;
}