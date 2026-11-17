// `TextEncoder` and `TextDecoder` for QuickJS, which has neither. The Word half of the program
// (`quickjs-word.ts`) needs them for UTF-8 only, as `@redlines/word` and its libraries use them.

function encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    // A lone surrogate is U+FFFD, as in the browsers.
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return Uint8Array.from(out);
}

function decode(bytes: Uint8Array, fatal: boolean, ignoreBom: boolean): string {
  let out = '';
  let i = ignoreBom ? 0 : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const bad = () => {
    if (fatal) throw new TypeError('The data is not valid UTF-8');
    out += '\ufffd';
  };
  while (i < bytes.length) {
    const b = bytes[i++] as number;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      continue;
    }
    const need =
      b >= 0xf0 && b < 0xf5 ? 3 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xc2 && b < 0xe0 ? 1 : -1;
    if (need < 0) {
      bad();
      continue;
    }
    let c = b & (0x3f >> need);
    let k = 0;
    for (; k < need; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) break;
      c = (c << 6) | (next & 63);
    }
    i += k;
    const overlong = need === 2 ? c < 0x800 : need === 3 ? c < 0x10000 : false;
    if (k < need || overlong || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) bad();
    else out += String.fromCodePoint(c);
  }
  return out;
}

class Encoder {
  readonly encoding = 'utf-8';
  encode(text = ''): Uint8Array {
    return encode(String(text));
  }
}

class Decoder {
  readonly encoding = 'utf-8';
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  constructor(label = 'utf-8', options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
    if (!/^utf-?8$/i.test(label)) throw new RangeError(`The encoding ${label} is not supported`);
    this.fatal = options.fatal === true;
    this.ignoreBOM = options.ignoreBOM === true;
  }
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (input === undefined) return '';
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return decode(bytes, this.fatal, this.ignoreBOM);
  }
}

const scope = globalThis as Record<string, unknown>;
scope['TextEncoder'] ??= Encoder;
scope['TextDecoder'] ??= Decoder;
