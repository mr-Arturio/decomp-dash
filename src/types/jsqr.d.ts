declare module "jsqr" {
  export interface QRCode {
    data: string;
    location: any;
  }
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number
  ): QRCode | null;
}
