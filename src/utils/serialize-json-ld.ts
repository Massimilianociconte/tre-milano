/** Serializes structured data without allowing user-controlled text to close the script element. */
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}
