/**
 * Manages the lifetime of media files copied into the static server webroot.
 */

import {readDir, unlink} from "@dr.pogodin/react-native-fs";
import * as FileSystem from "expo-file-system/legacy";
import {LogService} from "./LogService";

const TAG = 'Webroot';

// Served by the server itself, never deleted
const PROTECTED_FILES = ['icon.png'];

// Applies to inactive copies, the file being cast is exempt
const RETAINED_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

// Free disk space preserved after copying the active file
const FREE_SPACE_MARGIN = 512 * 1024 * 1024; // 512 MB

// Lets in-flight range requests finish
const RELEASE_DELAY_MS = 10000; // 10 seconds

export class WebrootService {
    private static activeFile: string | null = null;
    private static pendingReleases = new Map<string, NodeJS.Timeout>();

    /**
     * Mark the file currently being cast so it is never deleted
     */
    static setActiveFile(fileName: string | null): void {
        this.activeFile = fileName;
        if (fileName) {
            this.cancelRelease(fileName);
        }
    }

    /**
     * Schedule deletion of a file that is no longer being cast
     */
    static releaseFile(dir: string, fileName: string): void {
        if (!fileName || fileName === this.activeFile || this.pendingReleases.has(fileName)) {
            return;
        }
        const timer = setTimeout(() => {
            this.pendingReleases.delete(fileName);
            if (fileName === this.activeFile) return;
            this.deleteFile(`${dir}/${fileName}`);
        }, RELEASE_DELAY_MS);
        this.pendingReleases.set(fileName, timer);
    }

    /**
     * Cancel a scheduled deletion, used when an asset is cast again
     */
    private static cancelRelease(fileName: string): void {
        const timer = this.pendingReleases.get(fileName);
        if (timer) {
            clearTimeout(timer);
            this.pendingReleases.delete(fileName);
        }
    }

    /**
     * Delete inactive copies to fit a new file, false when space is short
     */
    static async ensureSpaceFor(dir: string, requiredBytes: number): Promise<boolean> {
        await this.trimToLimit(dir);

        if (requiredBytes <= 0) return true;

        let free = await this.freeSpace();
        if (free === null) return true;
        if (free >= requiredBytes + FREE_SPACE_MARGIN) return true;

        // Not enough room, drop every inactive copy before giving up
        await this.deleteInactive(dir);

        free = await this.freeSpace();
        if (free === null) return true;

        const enough = free >= requiredBytes + FREE_SPACE_MARGIN;
        if (!enough) {
            LogService.warn(TAG, `Not enough free space for ${requiredBytes} bytes, ${free} bytes available`);
        }
        return enough;
    }

    /**
     * Delete inactive copies oldest first until the retention limit is met
     */
    private static async trimToLimit(dir: string): Promise<void> {
        const entries = await this.listInactive(dir);
        let retained = entries.reduce((total, entry) => total + entry.size, 0);
        if (retained <= RETAINED_MAX_BYTES) return;

        entries.sort((a, b) => a.mtime - b.mtime);
        for (const entry of entries) {
            if (retained <= RETAINED_MAX_BYTES) break;
            if (await this.deleteFile(entry.path)) {
                retained -= entry.size;
            }
        }
    }

    /**
     * Delete every copy except the active one
     */
    static async deleteInactive(dir: string): Promise<void> {
        const entries = await this.listInactive(dir);
        for (const entry of entries) {
            await this.deleteFile(entry.path);
        }
    }

    /**
     * Forget the active file and drop every scheduled deletion
     */
    static reset(): void {
        this.pendingReleases.forEach(timer => clearTimeout(timer));
        this.pendingReleases.clear();
        this.activeFile = null;
    }

    private static async listEntries(dir: string) {
        try {
            const items = await readDir(dir);
            return items
                .filter(item => item.isFile())
                .map(item => ({
                    name: item.name,
                    path: item.path,
                    size: item.size || 0,
                    mtime: item.mtime ? item.mtime.getTime() : 0,
                }));
        } catch (error) {
            LogService.warn(TAG, `Unable to read webroot: ${(error as Error).message}`);
            return [];
        }
    }

    private static async listInactive(dir: string) {
        const entries = await this.listEntries(dir);
        return entries.filter(entry =>
            entry.name !== this.activeFile && !PROTECTED_FILES.includes(entry.name)
        );
    }

    private static async freeSpace(): Promise<number | null> {
        try {
            return await FileSystem.getFreeDiskStorageAsync();
        } catch (error) {
            LogService.warn(TAG, `Unable to read free disk space: ${(error as Error).message}`);
            return null;
        }
    }

    private static async deleteFile(path: string): Promise<boolean> {
        try {
            await unlink(path);
            return true;
        } catch (error) {
            LogService.warn(TAG, `Failed to delete ${path}: ${(error as Error).message}`);
            return false;
        }
    }
}
