// Muted cloth bindings, on-palette. Chosen per item by a stable hash of its id
// so the library has variety but a given item always looks the same. Each entry:
// [cloth/spine colour, cover colour, ink colour for text on that cloth].
// Used as the cover background for items without a real cover image, and as the
// spine-strip colour in the list view.

export const BINDINGS: ReadonlyArray<readonly [string, string, string]> = [
  ["#1f3a34", "#16302b", "#f0e9d8"], // deep green
  ["#6f241a", "#561a12", "#f3e2cf"], // oxblood
  ["#2b2b30", "#1f1f24", "#ead9c2"], // charcoal
  ["#34503f", "#264031", "#eef0e2"], // forest
  ["#3a2f28", "#2a211c", "#ece7da"], // espresso (house)
  ["#21384d", "#182a3a", "#eaf0f6"], // slate blue
  ["#e6dcc4", "#d8ccae", "#2a3340"], // bone (dark ink)
];

export function bindingFor(id: string): readonly [string, string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BINDINGS[h % BINDINGS.length];
}
