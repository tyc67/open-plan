// Document (x, y) in mm maps to Three.js (x, z) in metres.
export const wx = x => (x - 6000) / 1000;
export const wz = y => (y - 5300) / 1000;
export const mm = value => value / 1000;
export const planPoint = point => ({ cx: Math.round((point.x * 1000 + 6000) / 10) * 10, cy: Math.round((point.z * 1000 + 5300) / 10) * 10 });
