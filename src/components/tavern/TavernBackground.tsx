// Full-bleed candlelit-tavern backdrop shared by every redesigned page.
// CSS-only gradient by default; once real background art lands
// (public/images/tavern-bg.*), swap the style prop here in one place.

export function TavernBackground() {
  return (
    <div className="fixed inset-0 -z-10 bg-tavern-950">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(220,174,71,0.08),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(139,58,58,0.10),transparent_55%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-tavern-900/40 via-tavern-950 to-black" />
    </div>
  )
}
