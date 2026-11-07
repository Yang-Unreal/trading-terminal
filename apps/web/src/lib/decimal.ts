const SCALE = 18;

function scaled(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const digits = `${integerPart || "0"}${fractionPart.padEnd(SCALE, "0").slice(0, SCALE)}`.replace(/^0+(?=\d)/, "");
  const result = BigInt(digits || "0");
  return negative ? -result : result;
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const text = unsigned.toString().padStart(SCALE + 1, "0");
  const integerPart = text.slice(0, text.length - SCALE) || "0";
  const fractionPart = text.slice(text.length - SCALE).replace(/0+$/, "");
  const result = fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
  return negative && result !== "0" ? `-${result}` : result;
}

export function addDecimal(a: string, b: string): string {
  return fromScaled(scaled(a) + scaled(b));
}

export function subtractDecimal(a: string, b: string): string {
  return fromScaled(scaled(a) - scaled(b));
}

export function multiplyDecimal(a: string, b: string): string {
  return fromScaled((scaled(a) * scaled(b)) / 10n ** BigInt(SCALE));
}

export function divideDecimal(a: string, b: string): string {
  if (scaled(b) === 0n) return "0";
  return fromScaled((scaled(a) * 10n ** BigInt(SCALE)) / scaled(b));
}

export function formatDecimal(value: string, maxFraction = 8): string {
  const [integerPart, fractionPart = ""] = value.split(".");
  if (!fractionPart) return integerPart;
  return `${integerPart}.${fractionPart.slice(0, maxFraction)}`;
}