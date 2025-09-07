declare module "jsqr" {
  export interface Point {
    x: number;
    y: number;
  }

  export interface QRLocation {
    topLeftCorner: Point;
    topRightCorner: Point;
    bottomLeftCorner: Point;
    bottomRightCorner: Point;
    // present in jsQR but not always used
    topLeftFinderPattern?: Point;
    topRightFinderPattern?: Point;
    bottomLeftFinderPattern?: Point;
  }

  export interface QRCode {
    data: string;
    location: QRLocation;
    binaryData?: Uint8ClampedArray;
    version?: number;
  }

  export type InversionAttempts =
    | "dontInvert"
    | "onlyInvert"
    | "attemptBoth"
    | "invertFirst";

  export interface Options {
    inversionAttempts?: InversionAttempts;
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: Options
  ): QRCode | null;
}
