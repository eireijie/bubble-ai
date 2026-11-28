/**
 * The lens the liquid-glass buttons bend the page through (liquid-glass.css, `.lg`): a displacement map
 * that pushes what's behind outward toward the edges, one per button size. Rendered once at the root.
 */
const map = (n: number) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><defs><linearGradient id="x"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient><linearGradient id="y" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/></linearGradient><radialGradient id="m"><stop offset=".55" stop-color="#808000"/><stop offset="1" stop-color="#808000" stop-opacity="0"/></radialGradient></defs><rect width="${n}" height="${n}" fill="url(#x)"/><rect width="${n}" height="${n}" fill="url(#y)" style="mix-blend-mode:screen"/><rect width="${n}" height="${n}" fill="url(#m)"/></svg>`,
  );

function Lens({ id, size, scale }: { id: string; size: number; scale: number }) {
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage href={map(size)} x="0" y="0" width={size} height={size} result="m" />
      <feDisplacementMap in="SourceGraphic" in2="m" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

export function LensFilters() {
  return (
    <svg width="0" height="0" aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <Lens id="lens40" size={40} scale={-14} />
      <Lens id="lens32" size={32} scale={-11} />
    </svg>
  );
}
