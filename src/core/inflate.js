/**
 * Raw DEFLATE decoder (RFC 1951), enough to read compressed draw.io pages
 * without zlib, so the importer also runs in the browser. Pure and synchronous;
 * modelled on zlib's "puff" reference decoder (clarity over speed).
 *
 *   inflateRaw(Uint8Array) -> Uint8Array
 */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Canonical Huffman table: code counts per length and symbols in code order. */
function huffman(lengths) {
  const count = new Uint16Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const offs = new Uint16Array(16);
  for (let l = 1; l < 15; l++) offs[l + 1] = offs[l] + count[l];
  const symbol = new Uint16Array(lengths.length);
  lengths.forEach((l, s) => {
    if (l) symbol[offs[l]++] = s;
  });
  return { count, symbol };
}

let FIXED = null;
function fixedTables() {
  if (!FIXED) {
    const lit = new Array(288).fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288);
    FIXED = { lit: huffman(lit), dist: huffman(new Array(30).fill(5)) };
  }
  return FIXED;
}

export function inflateRaw(input) {
  const src = input instanceof Uint8Array ? input : Uint8Array.from(input);
  let pos = 0;
  let buf = 0;
  let cnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let len = 0;

  const need = (n) => {
    if (len + n <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, len + n));
    next.set(out.subarray(0, len));
    out = next;
  };
  const bits = (n) => {
    while (cnt < n) {
      if (pos >= src.length) throw new Error('compressed data ends early');
      buf |= src[pos++] << cnt;
      cnt += 8;
    }
    const v = buf & ((1 << n) - 1);
    buf >>>= n;
    cnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let l = 1; l < 16; l++) {
      code |= bits(1);
      const c = h.count[l];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('invalid Huffman code');
  };

  const codes = (lit, dist) => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) {
        need(1);
        out[len++] = sym;
      } else if (sym === 256) return;
      else {
        sym -= 257;
        if (sym >= 29) throw new Error('invalid length code');
        const n = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
        const d = decode(dist);
        if (d >= 30) throw new Error('invalid distance code');
        const back = DIST_BASE[d] + bits(DIST_EXTRA[d]);
        if (back > len) throw new Error('distance too far back');
        need(n);
        for (let i = 0; i < n; i++, len++) out[len] = out[len - back];
      }
    }
  };

  const dynamic = () => {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    const cl = new Array(19).fill(0);
    for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
    const clh = huffman(cl);
    const lengths = [];
    while (lengths.length < nlen + ndist) {
      const sym = decode(clh);
      if (sym < 16) lengths.push(sym);
      else {
        let rep = 0;
        let n;
        if (sym === 16) {
          if (!lengths.length) throw new Error('repeat with no previous length');
          rep = lengths[lengths.length - 1];
          n = 3 + bits(2);
        } else n = sym === 17 ? 3 + bits(3) : 11 + bits(7);
        for (let i = 0; i < n; i++) lengths.push(rep);
      }
    }
    if (lengths.length > nlen + ndist) throw new Error('too many code lengths');
    codes(huffman(lengths.slice(0, nlen)), huffman(lengths.slice(nlen)));
  };

  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      buf = 0;
      cnt = 0;
      if (pos + 4 > src.length) throw new Error('compressed data ends early');
      const n = src[pos] | (src[pos + 1] << 8);
      if ((n ^ 0xffff) !== (src[pos + 2] | (src[pos + 3] << 8))) throw new Error('stored block length mismatch');
      pos += 4;
      if (pos + n > src.length) throw new Error('compressed data ends early');
      need(n);
      out.set(src.subarray(pos, pos + n), len);
      len += n;
      pos += n;
    } else if (type === 1) codes(fixedTables().lit, fixedTables().dist);
    else if (type === 2) dynamic();
    else throw new Error('invalid block type');
  }
  return out.slice(0, len);
}
