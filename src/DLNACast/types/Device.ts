// Defines the common device interface for DLNA
export interface Device {
    id: string; // Unique identifier (USN for DLNA)
    name: string; // Friendly name
    location: string; // URL to device description
    ip: string; // IP address
    port: number; // Port
    services?: Record<string, string>; // Service URLs for DLNA
}