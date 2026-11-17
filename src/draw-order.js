// Draw order of the overlays (renderer.js). The field plane is opaque and
// depth-tested (renderOrder 0, drawn first in three.js's opaque pass);
// overlays are transparent with the depth test off, so they always paint
// over the field, in this renderOrder (lowest first):
//   course    0.3  laylines, ladder lines, mark zone circles, boundary
//   tracers   0.5  flow tracers
//   trails    0.6  boat trail dots
//   hull fill 0.9, hulls / marks 1 (body outlines), row circles 1.15
//   guides    2    forces, rule guides, mark anchors, course lines, …
//   ribbons 3, abeam 4, contact 5, labels 6 / 7
// Course geometry sits under the tracers so the flow stays readable where it
// crosses a layline, a rung, a zone or the boundary.
export const ORDER_FIELD = 0;
export const ORDER_COURSE = 0.3;
export const ORDER_TRACERS = 0.5; // flow tracers: over the field, under the hulls
export const ORDER_TRAILS = 0.6; // boat trail dots: over the tracers, under the hulls
export const ORDER_HULL_FILL = 0.9; // boat colour fill: under the hull outline
export const ORDER_HULL = 1;
export const ORDER_ROW_CIRCLE = ORDER_HULL + 0.15;
export const ORDER_GUIDE = 2;
export const ORDER_RIBBON = 3;
export const ORDER_ABEAM = 4;
export const ORDER_CONTACT = 5;
export const ORDER_LABEL = 6;
export const ORDER_LABEL_FILL = 7;

// Guides ({ type: 'guide' | 'polyline', layer? }) tagged layer: 'course'
// (ladder-lines.js, course.js zone circles, boundary.js) draw under the
// tracers; every other guide keeps ORDER_GUIDE.
export const LAYER_COURSE = 'course';
export function guideOrder(r) {
  return r && r.layer === LAYER_COURSE ? ORDER_COURSE : ORDER_GUIDE;
}
