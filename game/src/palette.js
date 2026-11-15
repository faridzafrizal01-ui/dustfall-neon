// The look plan, in one place. Night over a neon container dockyard: dark navy
// asphalt and steel, wet concrete, cyan neon for the Sentinels and magenta neon
// for the Raiders. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0b0f1c', // night sky / fog
  ground: '#161d2e', // wet asphalt
  surface: '#232c40', // dark concrete walls
  hairline: '#3a4a68', // crates, trim
  rust: '#6e2f52', // containers, tower (deep magenta steel)
  ink: '#e8f4ff', // readable text / light
  muted: '#8fa3c4', // secondary text
  accent: '#35e0ff', // cyan neon, site A markers
  pink: '#ff3d81', // magenta neon, site B markers
  us: '#35e0ff', // Sentinel cyan
  them: '#ff3d81', // Raider magenta
  good: '#3ddc84', // win / defuse
  bad: '#ff4d5e', // damage / danger
};

export function shade(name) {
  return PALETTE[name];
}
