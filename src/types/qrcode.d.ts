declare module "qrcode" {
  export function toDataURL(
    text: string,
    options?: {
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    }
  ): Promise<string>;

  const _default: {
    toDataURL: typeof toDataURL;
  };
  export default _default;
}
