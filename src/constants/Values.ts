import * as FileSystem from "expo-file-system";

export const SERVER_PORT = 9125;
export const SERVER_ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS, HEAD";
export const SERVER_MAX_AGE = "151200";
export const USER_AGENT = "CastLab"
export const SERVER_DIRECTORY = FileSystem.cacheDirectory + "webroot/"