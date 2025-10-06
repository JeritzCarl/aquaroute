declare module '@capacitor/geolocation' {
  export interface Coordinates {
    /**
     * Latitude in decimal degrees
     */
    latitude: number;
    /**
     * Longitude in decimal degrees
     */
    longitude: number;
    /**
     * Accuracy level of the latitude and longitude coordinates in meters
     */
    accuracy: number;
    /**
     * Height of the position in meters above the ellipsoid
     */
    altitude?: number | null;
    /**
     * Accuracy level of the altitude in meters
     */
    altitudeAccuracy?: number | null;
    /**
     * The direction of travel of the device in degrees counting clockwise
     * relative to the true north
     */
    heading?: number | null;
    /**
     * The velocity of the device in meters per second
     */
    speed?: number | null;
  }

  export interface Position {
    /**
     * The coordinates
     */
    coords: Coordinates;
    /**
     * Creation timestamp for coords
     */
    timestamp: number;
  }

  export interface PositionOptions {
    /**
     * High accuracy mode (might use more power or slow down response)
     */
    enableHighAccuracy?: boolean;
    /**
     * The maximum time (ms) allowed to return a position
     */
    timeout?: number;
    /**
     * The maximum age (ms) of a cached position that is acceptable to return
     */
    maximumAge?: number;
  }

  export interface WatchPositionCallback {
    (position: Position | null, err?: any): void;
  }

  export class Geolocation {
    /**
     * Get the current position of the device
     */
    static getCurrentPosition(
      options?: PositionOptions
    ): Promise<Position>;

    /**
     * Set up a watch that calls your callback whenever the device location changes
     */
    static watchPosition(
      options: PositionOptions,
      callback: WatchPositionCallback
    ): Promise<string>;

    /**
     * Clear a position watch by its id
     */
    static clearWatch(options: { id: string }): Promise<void>;
  }
}
