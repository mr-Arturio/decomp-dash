// Compute 8x8 average hash from ImageData → 16-hex string
export function aHashFromImageData(img: ImageData): string {
  // Downscale to 8x8 by sampling grid
  const { width, height, data } = img;
  const gray: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sx = Math.floor((x + 0.5) * (width / 8));
      const sy = Math.floor((y + 0.5) * (height / 8));
      const i = (sy * width + sx) * 4;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      gray.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  const avg = gray.reduce((a, b) => a + b, 0) / 64;
  let bits = "";
  for (const v of gray) bits += v > avg ? "1" : "0";
  const hex = BigInt("0b" + bits)
    .toString(16)
    .padStart(16, "0");
  return hex;
}
