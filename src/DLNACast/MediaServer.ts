import {Buffer} from 'buffer';
import Udp from 'react-native-udp';
import {XMLBuilder, XMLParser} from 'fast-xml-parser';
import TcpSocket from 'react-native-tcp-socket';
import uuid from 'react-native-uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {initTranslate} from '../localization/translate';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto'; // For stable file hashing
import {SERVER_FILE_DIRECTORY, SERVER_PORT, UPNP_PORT} from '../constants/Values';

// Constants
const MULTICAST_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const DEVICE_TYPE = 'urn:schemas-upnp-org:device:MediaServer:1';

/**
 * Interface for media items
 */
interface MediaItem {
    id: string;
    title: string;
    url: string;
    mimeType: string;
    upnpClass: string;
    protocolInfo: string;
    size?: number;
    date?: string;
    resolution?: string;
    duration?: number;
}

/**
 * UPnP/DLNA MediaServer compatible with Kodi
 */
export class MediaServer {
    private i18n = initTranslate();
    private socket: any = null; // UDP socket for SSDP
    private httpServer: any = null; // TCP server for UPnP
    private deviceUuid = ''; // Will be set in loadPersistentUuid
    private serverIp: string = '';
    private xmlParser = new XMLParser();
    private xmlBuilder = new XMLBuilder({
        ignoreAttributes: false,
        format: true,
        attributeNamePrefix: '@_',
        suppressBooleanAttributes: false // Ensure boolean attributes include explicit values
    });
    private ssdpInterval: NodeJS.Timeout | null = null;

    // Cache for media items (to avoid re-reading FS on every request)
    private cachedMediaItems: MediaItem[] | null = null;
    private cacheTimestamp = 0;
    private CACHE_DURATION = 30000; // 30 seconds

    constructor(
        private httpPort: number = UPNP_PORT,
        private friendlyName: string = 'CastLab'
    ) {
        // Load persistent UUID asynchronously
        this.loadPersistentUuid();
    }

    /**
     * Loads or generates a persistent UUID using AsyncStorage
     */
    private async loadPersistentUuid(): Promise<void> {
        try {
            const storedUuid = await AsyncStorage.getItem('MediaServerUuid');
            if (storedUuid) {
                this.deviceUuid = `uuid:${storedUuid}`;
            } else {
                const newUuid = uuid.v4();
                await AsyncStorage.setItem('MediaServerUuid', newUuid);
                this.deviceUuid = `uuid:${newUuid}`;
            }
        } catch (err) {
            console.error('Error loading/storing UUID:', (err as Error).message);
            // Fallback: generate a new one without storing
            this.deviceUuid = `uuid:${uuid.v4()}`;
        }
    }

    /**
     * Starts the UPnP MediaServer
     * @param ip - Local IP address of the device
     */
    async start(ip: string): Promise<void> {
        // Ensure UUID is loaded before starting (small delay if needed)
        while (!this.deviceUuid) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        this.serverIp = ip;
        await this.startSsdp();
        await this.startHttpServer();
    }

    /**
     * Stops the MediaServer
     */
    async stop(): Promise<void> {
        if (this.socket) {
            const notifications = [
                {nt: DEVICE_TYPE, usn: `${this.deviceUuid}::${DEVICE_TYPE}`},
                {nt: this.deviceUuid, usn: this.deviceUuid},
                {
                    nt: 'urn:schemas-upnp-org:service:ContentDirectory:1',
                    usn: `${this.deviceUuid}::urn:schemas-upnp-org:service:ContentDirectory:1`
                },
                {
                    nt: 'urn:schemas-upnp-org:service:ConnectionManager:1',
                    usn: `${this.deviceUuid}::urn:schemas-upnp-org:service:ConnectionManager:1`
                }
            ];
            for (const {nt, usn} of notifications) {
                const message = Buffer.from(
                    `NOTIFY * HTTP/1.1\r\n` +
                    `HOST: ${MULTICAST_ADDRESS}:${SSDP_PORT}\r\n` +
                    `NT: ${nt}\r\n` +
                    `NTS: ssdp:byebye\r\n` +
                    `USN: ${usn}\r\n\r\n`
                );
                try {
                    this.socket.send(message, 0, message.length, SSDP_PORT, MULTICAST_ADDRESS);
                } catch (err) {
                    console.error('Error sending SSDP byebye:', (err as Error).message);
                }
            }
        }
        if (this.ssdpInterval) {
            clearInterval(this.ssdpInterval);
            this.ssdpInterval = null;
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = null;
        }
        this.cachedMediaItems = null; // Clear cache
    }

    /**
     * Starts SSDP announcements
     */
    private async startSsdp(): Promise<void> {
        this.socket = Udp.createSocket({type: 'udp4'});
        this.socket.on('error', (err: Error) => {
            console.error('UDP socket error:', err.message);
        });

        this.socket.on('message', (msg: Buffer, rinfo: any) => {
            if (msg.toString().includes('M-SEARCH')) {
                this.handleSsdpSearch(msg.toString(), rinfo);
            }
        });

        try {
            await new Promise<void>((resolve, reject) => {
                this.socket.bind(SSDP_PORT, () => {
                    try {
                        this.socket.addMembership(MULTICAST_ADDRESS);
                        this.ssdpInterval = setInterval(() => this.sendSsdpNotify(), 5000);
                        this.sendSsdpNotify();
                        resolve();
                    } catch (err) {
                        console.error('Error binding multicast:', (err as Error).message);
                        reject(err);
                    }
                });
            });
        } catch (err) {
            console.error('Failed to bind SSDP socket:', (err as Error).message);
            throw err;
        }
    }

    /**
     * Sends SSDP NOTIFY messages for device and services
     */
    private sendSsdpNotify(): void {
        if (!this.socket) {
            console.warn('Cannot send SSDP NOTIFY: socket is null');
            return;
        }
        const notifications = [
            {nt: DEVICE_TYPE, usn: `${this.deviceUuid}::${DEVICE_TYPE}`},
            {nt: this.deviceUuid, usn: this.deviceUuid},
            {
                nt: 'urn:schemas-upnp-org:service:ContentDirectory:1',
                usn: `${this.deviceUuid}::urn:schemas-upnp-org:service:ContentDirectory:1`
            },
            {
                nt: 'urn:schemas-upnp-org:service:ConnectionManager:1',
                usn: `${this.deviceUuid}::urn:schemas-upnp-org:service:ConnectionManager:1`
            }
        ];

        for (const {nt, usn} of notifications) {
            const message = Buffer.from(
                `NOTIFY * HTTP/1.1\r\n` +
                `HOST: ${MULTICAST_ADDRESS}:${SSDP_PORT}\r\n` +
                `CACHE-CONTROL: max-age=100\r\n` +
                `LOCATION: http://${this.serverIp}:${this.httpPort}/device.xml\r\n` +
                `SERVER: MyApp/1.0 UPnP/1.0 DLNA/1.0\r\n` +
                `NT: ${nt}\r\n` +
                `NTS: ssdp:alive\r\n` +
                `USN: ${usn}\r\n\r\n`
            );
            try {
                this.socket.send(message, 0, message.length, SSDP_PORT, MULTICAST_ADDRESS, (err: Error | null) => {
                    if (err) {
                        console.error('Error sending SSDP notify:', err.message);
                    }
                });
            } catch (err) {
                console.error('Error sending SSDP notify:', (err as Error).message);
            }
        }
    }

    /**
     * Handles SSDP M-SEARCH requests
     * @param msg - Incoming SSDP message
     * @param rinfo - Remote info
     */
    private handleSsdpSearch(msg: string, rinfo: any): void {
        if (!this.socket) {
            console.warn('Cannot handle SSDP M-SEARCH: socket is null');
            return;
        }
        const headers = this.parseHeaders(msg);
        if (headers['ST'] === 'ssdp:all' || headers['ST'] === DEVICE_TYPE) {
            const response = Buffer.from(
                `HTTP/1.1 200 OK\r\n` +
                `CACHE-CONTROL: max-age=100\r\n` +
                `EXT:\r\n` +
                `LOCATION: http://${this.serverIp}:${this.httpPort}/device.xml\r\n` +
                `SERVER: MyApp/1.0 UPnP/1.0 DLNA/1.0\r\n` +
                `ST: ${DEVICE_TYPE}\r\n` +
                `USN: ${this.deviceUuid}::${DEVICE_TYPE}\r\n\r\n`
            );
            try {
                this.socket.send(response, 0, response.length, SSDP_PORT, rinfo.address, (err: Error | null) => {
                    if (err) {
                        console.error('Error sending SSDP search response:', err.message);
                    }
                });
            } catch (err) {
                console.error('Error sending SSDP search response:', (err as Error).message);
            }
        }
    }

    /**
     * Starts the HTTP server for UPnP services
     * @returns {Promise<void>} Resolves when the server starts successfully
     */
    private async startHttpServer(): Promise<void> {
        this.httpServer = TcpSocket.createServer((socket: any) => {
            let fullRequest = ''; // Buffer to accumulate data if it comes in chunks
            socket.on('data', (data: Buffer) => {
                fullRequest += data.toString();
                // Parse only if end of request (double \r\n)
                if (fullRequest.includes('\r\n\r\n')) {
                    const request = fullRequest;
                    const [method, path] = request.split('\r\n')[0].split(' ');

                    if (method === 'GET' && path === '/device.xml') {
                        this.serveDeviceXml(socket);
                    } else if (method === 'GET' && path === '/cds/scpd.xml') {
                        this.serveScpdXml(socket);
                    } else if (method === 'GET' && path === '/cm/scpd.xml') {
                        this.serveConnectionManagerScpd(socket);
                    } else if (method === 'POST' && path === '/cds/control') {
                        const bodyStart = request.indexOf('\r\n\r\n') + 4;
                        const body = request.substring(bodyStart);
                        const parsedBody = this.xmlParser.parse(body);
                        const actionName = Object.keys(parsedBody['s:Envelope']?.['s:Body'] || {})[0];
                        if (actionName === 'u:Browse') {
                            this.handleContentDirectory(socket, request);
                        } else if (actionName === 'u:GetSystemUpdateID') {
                            this.handleGetSystemUpdateID(socket);
                        } else if (actionName === 'u:GetSearchCapabilities') {
                            this.handleGetSearchCapabilities(socket);
                        } else if (actionName === 'u:GetSortCapabilities') {
                            this.handleGetSortCapabilities(socket);
                        } else {
                            console.error(`Unsupported SOAP action: ${actionName}`);
                            socket.write('HTTP/1.1 401 Invalid Action\r\nContent-Length: 0\r\n\r\n');
                        }
                    } else if (method === 'POST' && path === '/cm/control') {
                        this.handleConnectionManager(request, socket);
                    } else {
                        socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
                    }
                    fullRequest = ''; // Reset for next request
                }
            });
            socket.on('error', (err: Error) => {
                console.error('HTTP socket error:', err.message);
            });
            socket.on('close', () => {
            });
            socket.setTimeout(30000); // 30s timeout to avoid hangs
        });

        try {
            await new Promise<void>((resolve, reject) => {
                this.httpServer.listen(this.httpPort, this.serverIp, () => {
                    resolve();
                });
                this.httpServer.on('error', (err: Error) => {
                    console.error('HTTP server error:', err.message);
                    reject(err);
                });
            });
        } catch (err) {
            console.error('Failed to start HTTP server:', (err as Error).message);
            throw err;
        }
    }

    /**
     * Serves the UPnP device description XML
     * @param socket - TCP socket for communication
     */
    private serveDeviceXml(socket: any): void {
        const xml = this.xmlBuilder.build({
            root: {
                '@_xmlns': 'urn:schemas-upnp-org:device-1-0',
                specVersion: {
                    major: 1,
                    minor: 0
                },
                device: {
                    deviceType: DEVICE_TYPE,
                    friendlyName: this.friendlyName,
                    manufacturer: 'CastLab',
                    modelName: 'DLNA Caster',
                    UDN: this.deviceUuid,
                    iconList: {
                        icon: {
                            mimetype: 'image/png',
                            width: 48,
                            height: 48,
                            depth: 24,
                            url: `http://${this.serverIp}:${SERVER_PORT}/icon.png`
                        }
                    },
                    serviceList: {
                        service: [
                            {
                                serviceType: 'urn:schemas-upnp-org:service:ContentDirectory:1',
                                serviceId: 'urn:upnp-org:serviceId:ContentDirectory',
                                SCPDURL: '/cds/scpd.xml',
                                controlURL: '/cds/control',
                                eventSubURL: '/cds/event'
                            },
                            {
                                serviceType: 'urn:schemas-upnp-org:service:ConnectionManager:1',
                                serviceId: 'urn:upnp-org:serviceId:ConnectionManager',
                                SCPDURL: '/cm/scpd.xml',
                                controlURL: '/cm/control',
                                eventSubURL: '/cm/event'
                            }
                        ]
                    }
                }
            }
        });

        const xmlWithHeader = `<?xml version="1.0" encoding="utf-8"?>${xml}`;
        const response = [
            'HTTP/1.1 200 OK',
            'Content-Type: text/xml; charset="utf-8"',
            `Content-Length: ${Buffer.byteLength(xmlWithHeader)}`,
            'Connection: close', // Force close after response
            '',
            xmlWithHeader
        ].join('\r\n');

        socket.write(response);
    }

    /**
     * Serves the ContentDirectory service description XML
     * @param socket - TCP socket for communication
     */
    private serveScpdXml(socket: any): void {
        const xml = this.xmlBuilder.build({
            scpd: {
                '@_xmlns': 'urn:schemas-upnp-org:service-1-0',
                specVersion: {major: 1, minor: 0},
                actionList: {
                    action: [
                        {
                            name: 'Browse',
                            argumentList: {
                                argument: [
                                    {name: 'ObjectID', direction: 'in', relatedStateVariable: 'A_ARG_TYPE_ObjectID'},
                                    {
                                        name: 'BrowseFlag',
                                        direction: 'in',
                                        relatedStateVariable: 'A_ARG_TYPE_BrowseFlag'
                                    },
                                    {name: 'Filter', direction: 'in', relatedStateVariable: 'A_ARG_TYPE_Filter'},
                                    {name: 'StartingIndex', direction: 'in', relatedStateVariable: 'A_ARG_TYPE_Index'},
                                    {name: 'RequestedCount', direction: 'in', relatedStateVariable: 'A_ARG_TYPE_Count'},
                                    {
                                        name: 'SortCriteria',
                                        direction: 'in',
                                        relatedStateVariable: 'A_ARG_TYPE_SortCriteria'
                                    },
                                    {name: 'Result', direction: 'out', relatedStateVariable: 'A_ARG_TYPE_Result'},
                                    {
                                        name: 'NumberReturned',
                                        direction: 'out',
                                        relatedStateVariable: 'A_ARG_TYPE_Count'
                                    },
                                    {name: 'TotalMatches', direction: 'out', relatedStateVariable: 'A_ARG_TYPE_Count'},
                                    {name: 'UpdateID', direction: 'out', relatedStateVariable: 'SystemUpdateID'}
                                ]
                            }
                        },
                        {
                            name: 'GetSystemUpdateID',
                            argumentList: {
                                argument: [
                                    {name: 'Id', direction: 'out', relatedStateVariable: 'SystemUpdateID'}
                                ]
                            }
                        },
                        {
                            name: 'GetSearchCapabilities',
                            argumentList: {
                                argument: [
                                    {name: 'SearchCaps', direction: 'out', relatedStateVariable: 'SearchCapabilities'}
                                ]
                            }
                        },
                        {
                            name: 'GetSortCapabilities',
                            argumentList: {
                                argument: [
                                    {name: 'SortCaps', direction: 'out', relatedStateVariable: 'SortCapabilities'}
                                ]
                            }
                        }
                    ]
                },
                serviceStateTable: {
                    stateVariable: [
                        {name: 'A_ARG_TYPE_ObjectID', sendEvents: 'no', dataType: 'string'},
                        {
                            name: 'A_ARG_TYPE_BrowseFlag',
                            sendEvents: 'no',
                            dataType: 'string',
                            allowedValueList: {allowedValue: ['BrowseMetadata', 'BrowseDirectChildren']}
                        },
                        {name: 'A_ARG_TYPE_Filter', sendEvents: 'no', dataType: 'string'},
                        {name: 'A_ARG_TYPE_SortCriteria', sendEvents: 'no', dataType: 'string'},
                        {name: 'A_ARG_TYPE_Index', sendEvents: 'no', dataType: 'ui4'},
                        {name: 'A_ARG_TYPE_Count', sendEvents: 'no', dataType: 'ui4'},
                        {name: 'A_ARG_TYPE_Result', sendEvents: 'no', dataType: 'string'},
                        {name: 'SystemUpdateID', sendEvents: 'yes', dataType: 'ui4'},
                        {name: 'SearchCapabilities', sendEvents: 'no', dataType: 'string'},
                        {name: 'SortCapabilities', sendEvents: 'no', dataType: 'string'}
                    ]
                }
            }
        });

        const xmlWithHeader = `<?xml version="1.0" encoding="utf-8"?>${xml}`;
        const response = [
            'HTTP/1.1 200 OK',
            'Content-Type: text/xml; charset="utf-8"',
            `Content-Length: ${Buffer.byteLength(xmlWithHeader)}`,
            'Connection: close',
            '',
            xmlWithHeader
        ].join('\r\n');

        socket.write(response);
    }

    /**
     * Serves the ConnectionManager service description XML
     * @param socket - TCP socket for communication
     */
    private serveConnectionManagerScpd(socket: any): void {
        const xml = this.xmlBuilder.build({
            scpd: {
                '@_xmlns': 'urn:schemas-upnp-org:service-1-0',
                specVersion: {major: 1, minor: 0},
                actionList: {
                    action: [
                        {
                            name: 'GetProtocolInfo',
                            argumentList: {
                                argument: [
                                    {name: 'Source', direction: 'out', relatedStateVariable: 'SourceProtocolInfo'},
                                    {name: 'Sink', direction: 'out', relatedStateVariable: 'SinkProtocolInfo'}
                                ]
                            }
                        }
                    ]
                },
                serviceStateTable: {
                    stateVariable: [
                        {name: 'SourceProtocolInfo', sendEvents: 'yes', dataType: 'string'},
                        {name: 'SinkProtocolInfo', sendEvents: 'yes', dataType: 'string'}
                    ]
                }
            }
        });

        const xmlWithHeader = `<?xml version="1.0" encoding="utf-8"?>${xml}`;
        const response = [
            'HTTP/1.1 200 OK',
            'Content-Type: text/xml; charset="utf-8"',
            `Content-Length: ${Buffer.byteLength(xmlWithHeader)}`,
            'Connection: close',
            '',
            xmlWithHeader
        ].join('\r\n');
        socket.write(response);
    }

    /**
     * Handles SOAP requests for the ConnectionManager service
     * @param request - Incoming HTTP request string
     * @param socket - TCP socket for communication
     */
    private handleConnectionManager(request: string, socket: any): void {
        const body = this.xmlParser.parse(request.split('\r\n\r\n')[1]);
        const action = body['s:Envelope']?.['s:Body']?.['u:GetProtocolInfo'];
        if (!action) {
            socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
            return;
        }

        // ProtocolInfo consistent: no OP for images, with for video/audio
        const responseXml = this.xmlBuilder.build({
            's:Envelope': {
                '@_xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
                '@_s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
                's:Body': {
                    'u:GetProtocolInfoResponse': {
                        '@_xmlns:u': 'urn:schemas-upnp-org:service:ConnectionManager:1',
                        Source: 'http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000,http-get:*:image/png:DLNA.ORG_PN=PNG_LRG;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000,http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0,http-get:*:audio/mpeg:DLNA.ORG_OP=01;DLNA.ORG_CI=0',
                        Sink: ''
                    }
                }
            }
        });

        const response = [
            'HTTP/1.1 200 OK',
            'Content-Type: text/xml; charset="utf-8"',
            `Content-Length: ${Buffer.byteLength(responseXml)}`,
            'Connection: close',
            '',
            responseXml
        ].join('\r\n');
        socket.write(response);
    }

    /**
     * Handles SOAP requests for the ContentDirectory service
     * @param socket - TCP socket for communication
     * @param request - Incoming HTTP request string
     */
    private async handleContentDirectory(socket: any, request: string): Promise<void> {
        try {
            const body = this.xmlParser.parse(request.split('\r\n\r\n')[1]);
            const action = body['s:Envelope']?.['s:Body'];
            if (!action) {
                console.warn('Invalid SOAP request: no s:Body found');
                socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
                return;
            }

            const actionName = Object.keys(action)[0];

            if (actionName === 'u:Browse') {
                const browseParams = action['u:Browse'];
                let result = '';
                let numberReturned = 0;
                let totalMatches = 0;
                let updateID = 1;

                const objectId = String(browseParams.ObjectID);
                const mediaItems = await this.getMediaItems();

                if (browseParams.BrowseFlag === 'BrowseMetadata') {
                    if (objectId === '0') {
                        result = this.buildRootMetadata(2); // 2 children: Pictures, Videos
                        numberReturned = 1;
                        totalMatches = 1;
                    } else if (objectId === '1') {
                        const pictureItems = mediaItems.filter(item => item.mimeType.includes('image'));
                        result = this.buildPicturesContainerMetadata(pictureItems.length);
                        numberReturned = 1;
                        totalMatches = 1;
                    } else if (objectId === '2') {
                        const videoItems = mediaItems.filter(item => item.mimeType.includes('video'));
                        result = this.buildVideosContainerMetadata(videoItems.length);
                        numberReturned = 1;
                        totalMatches = 1;
                    } else {
                        console.warn(`BrowseMetadata for unknown ObjectID=${objectId}`);
                        socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
                        return;
                    }
                } else if (browseParams.BrowseFlag === 'BrowseDirectChildren') {
                    if (objectId === '0') {
                        const startingIndex = parseInt(browseParams.StartingIndex) || 0;
                        const requestedCount = parseInt(browseParams.RequestedCount) || 0;
                        const containers = this.getRootContainers();
                        const filteredContainers = requestedCount > 0
                            ? containers.slice(startingIndex, startingIndex + requestedCount)
                            : containers.slice(startingIndex);
                        result = this.buildContainerItems(filteredContainers);
                        numberReturned = filteredContainers.length;
                        totalMatches = containers.length;
                    } else if (objectId === '1') {
                        const startingIndex = parseInt(browseParams.StartingIndex) || 0;
                        const requestedCount = parseInt(browseParams.RequestedCount) || 0;
                        const pictureItems = mediaItems.filter(item => item.mimeType.includes('image'));
                        const filteredItems = requestedCount > 0
                            ? pictureItems.slice(startingIndex, startingIndex + requestedCount)
                            : pictureItems.slice(startingIndex);
                        result = this.buildDIDLItems(filteredItems);
                        numberReturned = filteredItems.length;
                        totalMatches = pictureItems.length;
                    } else if (objectId === '2') {
                        const startingIndex = parseInt(browseParams.StartingIndex) || 0;
                        const requestedCount = parseInt(browseParams.RequestedCount) || 0;
                        const videoItems = mediaItems.filter(item => item.mimeType.includes('video'));
                        const filteredItems = requestedCount > 0
                            ? videoItems.slice(startingIndex, startingIndex + requestedCount)
                            : videoItems.slice(startingIndex);
                        result = this.buildDIDLItems(filteredItems);
                        numberReturned = filteredItems.length;
                        totalMatches = videoItems.length;
                    } else {
                        result = '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"></DIDL-Lite>';
                        numberReturned = 0;
                        totalMatches = 0;
                    }
                } else {
                    socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
                    return;
                }

                const responseXml = this.xmlBuilder.build({
                    's:Envelope': {
                        '@_xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
                        '@_s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
                        's:Body': {
                            'u:BrowseResponse': {
                                '@_xmlns:u': 'urn:schemas-upnp-org:service:ContentDirectory:1',
                                Result: result,
                                NumberReturned: numberReturned,
                                TotalMatches: totalMatches,
                                UpdateID: updateID
                            }
                        }
                    }
                });

                socket.write([
                    'HTTP/1.1 200 OK',
                    'Content-Type: text/xml; charset="utf-8"',
                    'transferMode.dlna.org: Streaming',
                    `Content-Length: ${Buffer.byteLength(responseXml)}`,
                    'Connection: close',
                    '',
                    responseXml
                ].join('\r\n'));
            } else {
                console.error(`Unsupported SOAP action: ${actionName}`);
                socket.write('HTTP/1.1 401 Invalid Action\r\nContent-Length: 0\r\n\r\n');
            }
        } catch (err) {
            console.error('Error handling ContentDirectory:', (err as Error).message);
            socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n');
        }
    }

    /**
     * Builds DIDL-Lite XML for the Videos container metadata
     * @param childCount - Number of child items in Videos
     * @returns {string} DIDL-Lite XML string
     */
    private buildVideosContainerMetadata(childCount: number): string {
        const xml = this.xmlBuilder.build({
            'DIDL-Lite': {
                '@_xmlns': 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/',
                '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
                '@_xmlns:upnp': 'urn:schemas-upnp-org:metadata-1-0/upnp/',
                container: {
                    '@_id': '2',
                    '@_parentID': '0',
                    '@_restricted': true,
                    '@_childCount': childCount,
                    '@_searchable': false,
                    'dc:title': 'Videos',
                    'upnp:class': 'object.container'
                }
            }
        });
        return xml;
    }

    /**
     * Handles the GetSystemUpdateID SOAP action
     * @param socket - TCP socket for communication
     */
    private handleGetSystemUpdateID(socket: any): void {
        const responseXml = this.xmlBuilder.build({
            's:Envelope': {
                '@_xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
                '@_s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
                's:Body': {
                    'u:GetSystemUpdateIDResponse': {
                        '@_xmlns:u': 'urn:schemas-upnp-org:service:ContentDirectory:1',
                        Id: '1'
                    }
                }
            }
        });

        socket.write([
            'HTTP/1.1 200 OK',
            'Content-Type: text/xml; charset="utf-8"',
            `Content-Length: ${Buffer.byteLength(responseXml)}`,
            'Connection: close',
            '',
            responseXml
        ].join('\r\n'));
    }

    /**
     * Handles the GetSearchCapabilities SOAP action
     * @param socket - TCP socket for communication
     */
    private handleGetSearchCapabilities(socket: any): void {
        const responseXml = this.xmlBuilder.build({
            's:Envelope': {
                '@_xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
                '@_s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
                's:Body': {
                    'u:GetSearchCapabilitiesResponse': {
                        '@_xmlns:u': 'urn:schemas-upnp-org:service:ContentDirectory:1',
                        SearchCaps: 'dc:title,dc:creator,upnp:class,upnp:genre,upnp:album,upnp:artist'
                    }
                }
            }
        });

        socket.write([
            'HTTP/1.1 200 OK',
            'Content-Type: text/xml; charset="utf-8"',
            `Content-Length: ${Buffer.byteLength(responseXml)}`,
            'Connection: close',
            '',
            responseXml
        ].join('\r\n'));
    }

    /**
     * Handles the GetSortCapabilities SOAP action
     * @param socket - TCP socket for communication
     */
    private handleGetSortCapabilities(socket: any): void {
        const responseXml = this.xmlBuilder.build({
            's:Envelope': {
                '@_xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
                '@_s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
                's:Body': {
                    'u:GetSortCapabilitiesResponse': {
                        '@_xmlns:u': 'urn:schemas-upnp-org:service:ContentDirectory:1',
                        SortCaps: 'dc:title,dc:date,upnp:class'
                    }
                }
            }
        });

        socket.write([
            'HTTP/1.1 200 OK',
            'Content-Type: text/xml; charset="utf-8"',
            `Content-Length: ${Buffer.byteLength(responseXml)}`,
            'Connection: close',
            '',
            responseXml
        ].join('\r\n'));
    }

    /**
     * Retrieves media items from the server file directory (cached)
     * @returns {Promise<MediaItem[]>} Array of media items
     */
    private async getMediaItems(): Promise<MediaItem[]> {
        const now = Date.now();
        if (this.cachedMediaItems && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
            return this.cachedMediaItems;
        }

        try {
            const info = await FileSystem.getInfoAsync(SERVER_FILE_DIRECTORY);
            if (!info.exists || !info.isDirectory) {
                console.warn(`Directory ${SERVER_FILE_DIRECTORY} does not exist or is not a directory`);
                return [];
            }
            const files = await FileSystem.readDirectoryAsync(SERVER_FILE_DIRECTORY);
            const filteredFiles = files.filter(file => file !== 'icon.png');
            const items = await Promise.all(
                filteredFiles.map(async (file) => {
                    const decodedFile = decodeURIComponent(file);
                    let mimeType: string;
                    let upnpClass: string;
                    let protocolInfo: string;
                    let resolution: string | undefined;
                    if (file.match(/\.(jpg|jpeg)$/i)) {
                        mimeType = 'image/jpeg';
                        upnpClass = 'object.item.imageItem.photo';
                        protocolInfo = 'http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000';
                        resolution = '1920x1080'; // Hardcoded for now; TODO: real resolution
                    } else if (file.match(/\.png$/i)) {
                        mimeType = 'image/png';
                        upnpClass = 'object.item.imageItem.photo';
                        protocolInfo = 'http-get:*:image/png:DLNA.ORG_PN=PNG_LRG;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=00D00000000000000000000000000000';
                        resolution = '1920x1080';
                    } else if (file.match(/\.mp4$/i)) {
                        mimeType = 'video/mp4';
                        upnpClass = 'object.item.videoItem';
                        protocolInfo = 'http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0';
                        resolution = '1920x1080';
                    } else if (file.match(/\.mp3$/i)) {
                        mimeType = 'audio/mpeg';
                        upnpClass = 'object.item.audioItem.musicTrack';
                        protocolInfo = 'http-get:*:audio/mpeg:DLNA.ORG_OP=01;DLNA.ORG_CI=0';
                    } else {
                        // Fallback for non-media files
                        mimeType = 'application/octet-stream';
                        upnpClass = 'object.item';
                        protocolInfo = 'http-get:*:application/octet-stream:DLNA.ORG_OP=00;DLNA.ORG_CI=0';
                    }
                    let size: number | undefined;
                    let date: string | undefined;
                    try {
                        const filePath = `${SERVER_FILE_DIRECTORY}/${file}`;
                        const fileInfo = await FileSystem.getInfoAsync(filePath);
                        if (!fileInfo.exists || fileInfo.isDirectory) {
                            console.warn(`Skipping file ${file}: does not exist or is a directory`);
                            return null;
                        }
                        size = fileInfo.size;
                        if (fileInfo.modificationTime) {
                            date = new Date(fileInfo.modificationTime * 1000).toISOString();
                        }
                    } catch (err) {
                        console.warn(`Failed to get metadata for ${file}:`, (err as Error).message);
                        return null;
                    }
                    const encodedFile = encodeURIComponent(file);
                    const url = `http://${this.serverIp}:${SERVER_PORT}/${encodedFile}`;
                    // Stable ID based on MD5 hash of filename
                    const itemId = (await Crypto.digestStringAsync(
                        Crypto.CryptoDigestAlgorithm.MD5,
                        file
                    )).substring(0, 8);
                    return {
                        id: itemId,
                        title: decodedFile,
                        url,
                        mimeType,
                        upnpClass,
                        protocolInfo,
                        size,
                        date,
                        resolution
                    } as MediaItem;
                })
            );
            this.cachedMediaItems = items.filter((item): item is MediaItem => item !== null);
            this.cacheTimestamp = now;
            return this.cachedMediaItems;
        } catch (err) {
            console.error('Error reading directory:', (err as Error).message);
            return [];
        }
    }

    /**
     * Gets the root containers (e.g., Pictures, Videos)
     * @returns Array of container objects
     */
    private getRootContainers(): Array<{id: string; title: string; childCount: number; upnpClass: string}> {
        const mediaItems = this.cachedMediaItems || [];
        const pictureItems = mediaItems.filter(item => item.mimeType.includes('image'));
        const videoItems = mediaItems.filter(item => item.mimeType.includes('video'));
        return [
            {
                id: '1',
                title: 'Pictures',
                childCount: pictureItems.length,
                upnpClass: 'object.container.album.photoAlbum'
            },
            {
                id: '2',
                title: 'Videos',
                childCount: videoItems.length,
                upnpClass: 'object.container'
            }
        ];
    }

    /**
     * Builds DIDL-Lite XML for the root container metadata
     * @param childCount - Number of child containers in the root
     * @returns {string} DIDL-Lite XML string
     */
    private buildRootMetadata(childCount: number): string {
        const xml = this.xmlBuilder.build({
            'DIDL-Lite': {
                '@_xmlns': 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/',
                '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
                '@_xmlns:upnp': 'urn:schemas-upnp-org:metadata-1-0/upnp/',
                container: {
                    '@_id': '0',
                    '@_parentID': '-1',
                    '@_restricted': true,
                    '@_childCount': childCount,
                    '@_searchable': true,
                    'dc:title': this.friendlyName,
                    'upnp:class': 'object.container',
                    'upnp:storageMedium': 'NETWORK'
                }
            }
        });
        return xml;
    }

    /**
     * Builds DIDL-Lite XML for the Pictures container metadata
     * @param childCount - Number of child items in Pictures
     * @returns {string} DIDL-Lite XML string
     */
    private buildPicturesContainerMetadata(childCount: number): string {
        const xml = this.xmlBuilder.build({
            'DIDL-Lite': {
                '@_xmlns': 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/',
                '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
                '@_xmlns:upnp': 'urn:schemas-upnp-org:metadata-1-0/upnp/',
                container: {
                    '@_id': '1',
                    '@_parentID': '0',
                    '@_restricted': true,
                    '@_childCount': childCount,
                    '@_searchable': false,
                    'dc:title': 'Pictures',
                    'upnp:class': 'object.container.album.photoAlbum'
                }
            }
        });
        return xml;
    }

    /**
     * Builds DIDL-Lite XML for container items (e.g., Pictures folder)
     * @param containers - Array of containers
     * @returns {string} DIDL-Lite XML string
     */
    private buildContainerItems(containers: Array<{id: string; title: string; childCount: number; upnpClass: string}>): string {
        const containerElements = containers.map(cont => ({
            container: {
                '@_id': cont.id,
                '@_parentID': '0',
                '@_restricted': true,
                '@_childCount': cont.childCount,
                'dc:title': cont.title,
                'upnp:class': cont.upnpClass
            }
        }));

        const xmlObj = {
            'DIDL-Lite': {
                '@_xmlns': 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/',
                '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
                '@_xmlns:upnp': 'urn:schemas-upnp-org:metadata-1-0/upnp/',
                container: containerElements.map(c => c.container)
            }
        };

        const xml = this.xmlBuilder.build(xmlObj);
        return xml;
    }

    /**
     * Builds DIDL-Lite XML for media items
     * @param items - Array of media items to include
     * @returns {string} DIDL-Lite XML string
     */
    private buildDIDLItems(items: MediaItem[]): string {
        if (items.length === 0) {
            console.warn('No items to build DIDL for');
            return '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"></DIDL-Lite>';
        }

        const didlItems = items.map(item => ({
            item: {
                '@_id': item.id,
                '@_parentID': '1', // Parent is the Pictures container
                '@_restricted': true,
                'dc:title': item.title,
                ...(item.date && {'dc:date': item.date}),
                'upnp:class': item.upnpClass,
                'res': {
                    '@_protocolInfo': item.protocolInfo,
                    ...(item.size && {'@_size': item.size}),
                    ...(item.resolution && {'@_resolution': item.resolution}),
                    ...(item.duration && {'@_duration': item.duration}),
                    '#text': item.url
                }
            }
        }));

        const xmlObj = {
            'DIDL-Lite': {
                '@_xmlns': 'urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/',
                '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
                '@_xmlns:upnp': 'urn:schemas-upnp-org:metadata-1-0/upnp/',
                item: didlItems.map(i => i.item)
            }
        };

        const xml = this.xmlBuilder.build(xmlObj);
        return xml;
    }

    /**
     * Parses HTTP headers from a request string
     * @param response - The HTTP request string
     * @returns {Record<string, string>} Parsed headers as a key-value object
     */
    private parseHeaders(response: string): Record<string, string> {
        const lines = response.split('\r\n');
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
            const [key, value] = lines[i].split(': ');
            if (key && value) headers[key.toUpperCase()] = value.trim();
        }
        return headers;
    }
}