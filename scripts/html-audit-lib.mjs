export function hasAltAttribute(imageTag) {
  return /\salt(?:=(?:"[^"]*"|'[^']*'))?(?=\s|\/?\>)/.test(imageTag);
}
