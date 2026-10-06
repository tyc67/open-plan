// Room polygons exclude the bearing-wall projections inherited from the reference.
export const LAUNDRY_POLYGON=[[0,3610],[1580,3610],[1580,3825],[2180,3825],[2180,4950],[0,4950]];
export const CHILD_POLYGON=[[6600,3610],[10270,3610],[10270,6370],[6323,6370],[6323,3707],[6600,3707]];
const corrections=[
  {id:'laundry',original:[[0,3610],[2180,3610],[2180,4950],[0,4950]],poly:LAUNDRY_POLYGON,wall:[1580,3370,2420,3825]},
  {id:'child',original:[[6323,3610],[10270,3610],[10270,6370],[6323,6370]],poly:CHILD_POLYGON,wall:[6083,3370,6600,3707]},
];
export function migrateGeometry(doc) {
  return {...doc,rooms:doc.rooms.map(room=>{
    const correction=corrections.find(c=>c.id===room.id&&JSON.stringify(room.poly)===JSON.stringify(c.original)&&doc.walls.some(w=>w.type==='b'&&JSON.stringify(w.rect)===JSON.stringify(c.wall)));
    return correction?{...room,poly:structuredClone(correction.poly)}:room;
  })};
}
