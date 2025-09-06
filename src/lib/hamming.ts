export function hammingHex(a: string, b: string): number {
  const A = BigInt("0x" + a);
  const B = BigInt("0x" + b);
  let x = A ^ B;
  let c = 0;
  while (x) {
    x &= x - BigInt(1);
    c++;
  }
  return c;
}
