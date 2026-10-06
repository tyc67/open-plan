// The fixed set of screenshots. capture.mjs makes exactly these, and compare.mjs refuses any other set.
export const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }];
// 3D is captured at the lowest and the full cut height, so sills, lintels and wall tops are covered.
// The bearing-wall layer is not varied: it has no visible effect yet (review finding L16).
export const SCENES = [{ view: '2d' }, { view: '3d', cut: '0.9' }, { view: '3d', cut: '2.8' }];

export const shotName = (viewport, { view, cut }) => `${viewport.width}x${viewport.height}-${view}${cut ? `-cut-${cut}` : ''}`;
export const EXPECTED_SHOTS = VIEWPORTS.flatMap(viewport => SCENES.map(scene => shotName(viewport, scene)));
