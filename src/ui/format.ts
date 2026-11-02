/** Unit formatting shared by the HUD, shot card, minimap and menus. */
import { YARD } from '../config';

export type Units = 'yards' | 'metres';

export function dist(m: number, u: Units, digits = 0): string {
  return (u === 'yards' ? m / YARD : m).toFixed(digits);
}
export function distUnit(u: Units) {
  return u === 'yards' ? 'yd' : 'm';
}
export function distStr(m: number, u: Units, digits = 0) {
  return `${dist(m, u, digits)} ${distUnit(u)}`;
}
/** Short heights (elevation): feet for imperial, metres otherwise. */
export function height(m: number, u: Units, digits = 0): string {
  return (u === 'yards' ? m * 3.28084 : m).toFixed(digits);
}
export function heightUnit(u: Units) {
  return u === 'yards' ? 'ft' : 'm';
}
/** Speeds in mph (imperial) or km/h. Input in mph. */
export function speedFromMph(mph: number, u: Units, digits = 0) {
  return (u === 'yards' ? mph : mph * 1.609344).toFixed(digits);
}
export function speedUnit(u: Units) {
  return u === 'yards' ? 'mph' : 'km/h';
}
/** Wind: input m/s. */
export function windStr(ms: number, u: Units) {
  return u === 'yards' ? `${(ms * 2.23694).toFixed(0)}` : `${(ms * 3.6).toFixed(0)}`;
}
export function signed(v: number, digits = 1) {
  const s = v.toFixed(digits);
  return v > 0 && Number(s) !== 0 ? `+${s}` : Number(s) === 0 ? (0).toFixed(digits) : s;
}
export function toParStr(n: number) {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
/** Left/right label for a signed degree value (+ = right/open). */
export function lr(v: number, pos: string, neg: string, digits = 1) {
  const a = Math.abs(v).toFixed(digits);
  if (Number(a) === 0) return `${(0).toFixed(digits)}°`;
  return `${a}° ${v > 0 ? pos : neg}`;
}
