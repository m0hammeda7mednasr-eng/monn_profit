const MOJIBAKE_PATTERN = /[ØÙÃÂ]/;

export const decodeMaybeMojibake = (value) => {
  if (typeof value !== "string" || !MOJIBAKE_PATTERN.test(value)) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    if (!decoded || decoded.includes("\uFFFD")) {
      return value;
    }

    return decoded;
  } catch {
    return value;
  }
};
