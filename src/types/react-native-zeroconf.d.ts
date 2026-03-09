/**
 * Type declarations for react-native-zeroconf.
 *
 * mDNS (Multicast DNS) / DNS-SD service discovery library for React Native.
 * Used to auto-detect network services (e.g. FCast receivers via _fcast._tcp)
 * without requiring manual IP configuration.
 *
 * Wraps NsdManager on Android and NSNetServiceBrowser on iOS.
 */
declare module 'react-native-zeroconf' {
    import {EventEmitter} from 'events';

    /** A resolved mDNS service with its network details. */
    interface ZeroconfService {
        name: string;
        fullName: string;
        addresses: string[];
        host: string;
        port: number;
        txt: Record<string, string>;
    }

    /** mDNS service scanner. */
    class Zeroconf extends EventEmitter {
        /** Start scanning for services. E.g. scan('fcast', 'tcp') for _fcast._tcp. */
        scan(type?: string, protocol?: string, domain?: string): void;
        stop(): void;
        getServices(): Record<string, ZeroconfService>;

        on(event: 'resolved', listener: (service: ZeroconfService) => void): this;
        on(event: 'found', listener: (name: string) => void): this;
        on(event: 'remove', listener: (name: string) => void): this;
        on(event: 'error', listener: (err: Error) => void): this;
        on(event: 'start', listener: () => void): this;
        on(event: 'stop', listener: () => void): this;
        on(event: 'update', listener: () => void): this;
    }

    export default Zeroconf;
}
