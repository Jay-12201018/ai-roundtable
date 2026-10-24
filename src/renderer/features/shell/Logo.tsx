/** The app mark: a ring with six seats around it (“围坐一桌”), one colour, no borrowed brand shapes. */
export function Logo({ size = 22 }: { size?: number }) {
  const seats = [0, 60, 120, 180, 240, 300].map(angle => {
    const radians = angle * Math.PI / 180;
    return <circle key={angle} cx={(12 + 8.6 * Math.cos(radians)).toFixed(2)} cy={(12 + 8.6 * Math.sin(radians)).toFixed(2)} r="1.7" fill="currentColor" stroke="none" />;
  });
  return <svg className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="4.2" />{seats}</svg>;
}
