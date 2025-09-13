import {Asset} from "expo-media-library";

export default class PlayList {
    public id: number | undefined;
    public name: string | undefined;
    public assets: Array<Asset> | undefined;
    public created_at: Date | undefined | null;
    public updated_at: Date | undefined | null;

}