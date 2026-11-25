/**
 * Puts a space between Chinese characters and Latin letters or digits, the way
 * Chinese typesetting sets a name like "Marta Vey" or a figure like 15 inside a
 * sentence.
 */
export function spaceMixed(s: string): string {
  return s.replace(/([㐀-鿿])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([㐀-鿿])/g, '$1 $2');
}
