import {drizzle} from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';
import {extractedVideosTable} from './schema';
import {ExtractedVideo} from '../src/services/VideoExtractorService';
import {desc, eq, like, or} from 'drizzle-orm';

const expo = SQLite.openDatabaseSync('db.db');
const db = drizzle(expo);

/**
 * Extended video with history metadata
 */
export interface ExtractedVideoWithHistory extends ExtractedVideo {
    historyId: number;
    sourceUrl: string;
    pageTitle?: string;
    extractedAt: Date;
}

/**
 * Service for managing video extraction history
 */
export class VideoHistoryService {
    /**
     * Save extraction result to history
     * @param videos - Array of extracted videos
     * @param sourceUrl - Original webpage URL
     * @param pageTitle - Optional page title
     */
    static async saveExtraction(
        videos: ExtractedVideo[],
        sourceUrl: string,
        pageTitle?: string
    ): Promise<void> {
        try {
            const now = new Date();

            // Insert all videos
            for (const video of videos) {
                await db.insert(extractedVideosTable).values({
                    video_id: video.id,
                    url: video.url,
                    title: video.title,
                    thumbnail: video.thumbnail,
                    format: video.format,
                    source: video.source,
                    source_url: sourceUrl,
                    page_title: pageTitle,
                    extracted_at: now,
                });
            }

            console.log(`Saved ${videos.length} videos to history`);
        } catch (error) {
            console.error('Failed to save extraction to history:', error);
            throw error;
        }
    }

    /**
     * Get all extraction history
     * @param limit - Maximum number of results (default: 100)
     * @returns Array of videos with history metadata
     */
    static async getHistory(limit: number = 100): Promise<ExtractedVideoWithHistory[]> {
        try {
            const results = await db
                .select()
                .from(extractedVideosTable)
                .orderBy(desc(extractedVideosTable.extracted_at))
                .limit(limit);

            return results.map(row => ({
                id: row.video_id,
                url: row.url,
                title: row.title,
                thumbnail: row.thumbnail || undefined,
                format: row.format || undefined,
                source: row.source as ExtractedVideo['source'],
                historyId: row.id,
                sourceUrl: row.source_url,
                pageTitle: row.page_title || undefined,
                extractedAt: row.extracted_at,
            }));
        } catch (error) {
            console.error('Failed to get history:', error);
            throw error;
        }
    }

    /**
     * Search history by title or page title
     * @param searchTerm - Search term
     * @param limit - Maximum number of results (default: 100)
     * @returns Filtered array of videos
     */
    static async searchHistory(
        searchTerm: string,
        limit: number = 100
    ): Promise<ExtractedVideoWithHistory[]> {
        try {
            const searchPattern = `%${searchTerm}%`;

            const results = await db
                .select()
                .from(extractedVideosTable)
                .where(
                    or(
                        like(extractedVideosTable.title, searchPattern),
                        like(extractedVideosTable.page_title, searchPattern)
                    )
                )
                .orderBy(desc(extractedVideosTable.extracted_at))
                .limit(limit);

            return results.map(row => ({
                id: row.video_id,
                url: row.url,
                title: row.title,
                thumbnail: row.thumbnail || undefined,
                format: row.format || undefined,
                source: row.source as ExtractedVideo['source'],
                historyId: row.id,
                sourceUrl: row.source_url,
                pageTitle: row.page_title || undefined,
                extractedAt: row.extracted_at,
            }));
        } catch (error) {
            console.error('Failed to search history:', error);
            throw error;
        }
    }

    /**
     * Delete a single video from history
     * @param historyId - History entry ID
     */
    static async deleteVideo(historyId: number): Promise<void> {
        try {
            await db
                .delete(extractedVideosTable)
                .where(eq(extractedVideosTable.id, historyId));

            console.log(`Deleted video with history ID: ${historyId}`);
        } catch (error) {
            console.error('Failed to delete video:', error);
            throw error;
        }
    }

    /**
     * Delete multiple videos from history
     * @param historyIds - Array of history entry IDs
     */
    static async deleteVideos(historyIds: number[]): Promise<void> {
        try {
            for (const id of historyIds) {
                await db
                    .delete(extractedVideosTable)
                    .where(eq(extractedVideosTable.id, id));
            }

            console.log(`Deleted ${historyIds.length} videos from history`);
        } catch (error) {
            console.error('Failed to delete videos:', error);
            throw error;
        }
    }

    /**
     * Clear all history
     */
    static async clearHistory(): Promise<void> {
        try {
            await db.delete(extractedVideosTable);
            console.log('Cleared all extraction history');
        } catch (error) {
            console.error('Failed to clear history:', error);
            throw error;
        }
    }

    /**
     * Get history count
     * @returns Total number of videos in history
     */
    static async getHistoryCount(): Promise<number> {
        try {
            const result = await db
                .select()
                .from(extractedVideosTable);

            return result.length;
        } catch (error) {
            console.error('Failed to get history count:', error);
            return 0;
        }
    }
}