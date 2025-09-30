import {Asset} from 'expo-media-library';

/**
 * Class representing a playlist entity
 */
export default class PlayList {
    /** Unique identifier for the playlist */
    public id: number | undefined;

    /** Name of the playlist */
    public name: string | undefined;

    /** Array of media assets in the playlist */
    public assets: Array<Asset> | undefined;

    /** Creation timestamp */
    public created_at: Date | undefined | null;

    /** Last update timestamp */
    public updated_at: Date | undefined | null;

    constructor(
        name?: string,
        assets?: Array<Asset>,
        id?: number,
        created_at?: Date,
        updated_at?: Date
    ) {
        this.id = id;
        this.name = name;
        this.assets = assets;
        this.created_at = created_at;
        this.updated_at = updated_at;
    }
}