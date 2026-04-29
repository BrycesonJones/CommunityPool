const BTC_BASE58 = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

const BECH32_CHAR_TO_VAL = new Map<string, number>(
  [...BECH32_CHARSET].map((c, i) => [c, i]),
);

function extractAddressPart(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!/^bitcoin:/i.test(trimmed)) return trimmed;

  let rest = trimmed.slice("bitcoin:".length);
  if (rest.startsWith("//")) {
    rest = rest.slice(2);
  }
  const queryStart = rest.indexOf("?");
  const addressPart = queryStart >= 0 ? rest.slice(0, queryStart) : rest;
  return addressPart.trim();
}

function hasMixedCase(s: string): boolean {
  return s !== s.toLowerCase() && s !== s.toUpperCase();
}

function hrpExpand(hrp: string): number[] {
  const values: number[] = [];
  for (const ch of hrp) values.push(ch.charCodeAt(0) >> 5);
  values.push(0);
  for (const ch of hrp) values.push(ch.charCodeAt(0) & 31);
  return values;
}

function polymod(values: number[]): number {
  const GENERATORS = [
    0x3b6a57b2,
    0x26508e6d,
    0x1ea119fa,
    0x3d4233dd,
    0x2a1462b3,
  ];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) chk ^= GENERATORS[i]!;
    }
  }
  return chk;
}

function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] | null {
  let acc = 0;
  let bits = 0;
  const maxv = (1 << toBits) - 1;
  const result: number[] = [];
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    return null;
  }
  return result;
}

function isValidSegwitBech32Address(address: string): boolean {
  if (address.length < 14 || address.length > 90) return false;
  if (hasMixedCase(address)) return false;

  const normalized = address.toLowerCase();
  const separator = normalized.lastIndexOf("1");
  if (separator <= 0 || separator + 7 > normalized.length) return false;

  const hrp = normalized.slice(0, separator);
  if (hrp !== "bc") return false;

  const dataChars = normalized.slice(separator + 1);
  const dataValues: number[] = [];
  for (const ch of dataChars) {
    const v = BECH32_CHAR_TO_VAL.get(ch);
    if (v == null) return false;
    dataValues.push(v);
  }
  if (dataValues.length < 7) return false;

  const witnessVersion = dataValues[0]!;
  if (witnessVersion < 0 || witnessVersion > 16) return false;

  const checksum = polymod([...hrpExpand(hrp), ...dataValues]);
  const encodingConst = witnessVersion === 0 ? BECH32_CONST : BECH32M_CONST;
  if (checksum !== encodingConst) return false;

  const program = convertBits(dataValues.slice(1, -6), 5, 8, false);
  if (!program) return false;
  if (program.length < 2 || program.length > 40) return false;
  if (witnessVersion === 0 && program.length !== 20 && program.length !== 32) {
    return false;
  }

  return true;
}

export function normalizeBitcoinAddressInput(raw: string): string | null {
  const candidate = extractAddressPart(raw);
  if (!candidate) return null;

  if (BTC_BASE58.test(candidate)) return candidate;
  if (isValidSegwitBech32Address(candidate)) return candidate.toLowerCase();

  return null;
}

export function isBitcoinAddressLike(raw: string): boolean {
  return normalizeBitcoinAddressInput(raw) != null;
}
