import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createModelFactory } from './models.js';
import { formatLength } from '../units.js';
import { snapFurniture } from '../wallSnapping.js';
import { cameraPose, createViewFrame, groundSize, roomArea, shadowBox } from 'open-plan-core';
import { wx, wz, planX, planY, setFrame } from './coordinates.js';

function disposeGeometry(group) {
  group.traverse(o => o.geometry?.dispose());
  group.removeFromParent();
}
export function createViewer(host, callbacks) {
  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-label','Interactive 3D apartment');
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style,{position:'absolute',inset:'0',pointerEvents:'none'});
  host.appendChild(labels.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f2eee7');
  const camera = new THREE.PerspectiveCamera(45,1,.05,300);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * .495;
  controls.minDistance = 1.5; controls.maxDistance = 60;
  const hemi = new THREE.HemisphereLight(0xfff8ee,0xb9a88f,1.4);
  const sun = new THREE.DirectionalLight(0xfff1dd,2.6);
  sun.castShadow = true; sun.shadow.mapSize.setScalar(2048);
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#f2eee7',roughness:1}));
  ground.rotation.x = -Math.PI/2; ground.position.y = -.02; ground.receiveShadow = true;
  scene.add(hemi,sun,sun.target,ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const environment = pmrem.fromScene(roomEnvironment,.04);
  roomEnvironment.dispose(); pmrem.dispose();
  scene.environment = environment.texture;
  const factory = createModelFactory(renderer,environment.texture);
  const furniture = new THREE.Group(), roomLabels = new THREE.Group();
  scene.add(furniture,roomLabels);
  const models = new Map();
  let architecture = null, archSignature = '', selectedId = null, selectedRoomId = null, selectedWallId = null, roomPolygons = [], selection = null;
  let currentDoc=null,lastOptions=null,snapEnabled=true,furnitureLocked=false,currentUnit='mm',snapGuide=null;
  // The 3D frame (origin, camera, ground and shadow box) comes from the plan's physical bounds. It is set when a plan
  // is first shown or replaced and on 重設視角, never during a gesture, so edits do not move the scene.
  // The frame is set again when the plan key changes: a different plan, or the same plan loaded again (roadmap B3).
  let viewFrame=null,frameKey=null;
  function applyFrame(doc,key=frameKey) {
    viewFrame=createViewFrame(doc); frameKey=key; setFrame(viewFrame);
    renderer.domElement.dataset.frameOrigin=viewFrame.origin.join(',');   // read by tools/checks/bounds.mjs
    const size=groundSize(viewFrame); ground.scale.set(size/100,size/100,1);
    const shadow=shadowBox(viewFrame); sun.position.set(...shadow.sunPosition);
    Object.assign(sun.shadow.camera,{left:-shadow.half,right:shadow.half,top:shadow.half,bottom:-shadow.half,near:shadow.near,far:shadow.far});
    sun.shadow.camera.updateProjectionMatrix();
    const pose=cameraPose(viewFrame,camera.fov,camera.aspect);
    camera.position.set(...pose.position); controls.target.set(...pose.target); controls.maxDistance=pose.maxDistance;
    camera.far=pose.far; camera.updateProjectionMatrix(); controls.update();
    archSignature='';
  }
  function resetCamera() { if(currentDoc&&!drag){ applyFrame(currentDoc); sync(currentDoc,lastOptions); } }
  function clearSnapGuide(){if(snapGuide){snapGuide.traverse(o=>{o.geometry?.dispose();o.material?.dispose();o.element?.remove();});snapGuide.removeFromParent();snapGuide=null;}}
  let disposed = false, frame = 0, pointerStart = null, drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0,1,0),0);
  function rayAt(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(ndc,camera);
  }
  function pick(e) {
    rayAt(e);
    const hit = ray.intersectObjects([...(furniture.visible?[furniture]:[]),...(architecture?[architecture]:[])],true)
      .find(h => {for(let o=h.object;o;o=o.parent)if(!o.visible)return false;return !(h.object.material?.transparent && h.object.material.opacity < .4);});
    for(let o=hit?.object;o;o=o.parent) {if(o.userData.fid)return furnitureLocked?null:{kind:'furniture',id:o.userData.fid};if(o.userData.wall)return {kind:'wall',id:o.userData.wall};if(o.userData.room)return {kind:'room',id:o.userData.room};}
    return null;
  }
  function groundAt(e) { rayAt(e); return ray.ray.intersectPlane(floor,new THREE.Vector3()); }
  function updateSelection() {
    if(selection) { selection.geometry.dispose(); selection.material.dispose(); selection.removeFromParent(); selection=null; }
    const model = models.get(selectedId)?.group;
    if(selectedWallId&&architecture){let wallMesh;architecture.traverse(o=>{if(o.userData.wall===selectedWallId)wallMesh=o;});if(wallMesh){selection=new THREE.BoxHelper(wallMesh,0xf59e0b);selection.material.depthTest=false;selection.renderOrder=10;scene.add(selection);}}
    const room=roomPolygons.find(r=>r.id===selectedRoomId);
    if(room) {
      const points=room.poly.map(([x,y])=>new THREE.Vector3(wx(x),.035,wz(y)));points.push(points[0].clone());
      selection=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:0x0d9488,dashSize:.18,gapSize:.10,depthTest:false}));selection.computeLineDistances();selection.renderOrder=10;scene.add(selection);
    }
    if(model && model.visible && furniture.visible) { selection = new THREE.BoxHelper(model,0x2563eb); selection.material.depthTest=false; selection.renderOrder=10; scene.add(selection); }
  }
  function select(id,roomId,wallId) { selectedId=id; selectedRoomId=roomId;selectedWallId=wallId; updateSelection(); }
  function sync(doc, options) {
    // A different plan (replacement, restore, undo across one) ends a 3D drag: the same item ID can exist in both plans.
    if(drag&&(options.frameKey!==frameKey||options.furnitureLocked||!options.furniture||!doc.furniture.some(f=>f.id===drag.id)))cancelDrag();
    if(!drag&&(!viewFrame||options.frameKey!==frameKey)) applyFrame(doc,options.frameKey);
    roomPolygons=doc.rooms;currentDoc=doc;lastOptions=options;snapEnabled=options.wallSnap;furnitureLocked=options.furnitureLocked;currentUnit=options.unit||'mm';
    const signature = JSON.stringify([doc.rooms,doc.walls,doc.openings,doc.ceilingHeight,options.cut,options.bearing]);
    if(signature !== archSignature) {
      archSignature = signature;
      if(architecture) disposeGeometry(architecture);
      architecture = factory.architecture(doc,options.cut,options.bearing); scene.add(architecture);
      for(const label of [...roomLabels.children]) { label.element.remove(); roomLabels.remove(label); }
      for(const room of doc.rooms.filter(r=>r.at)) {
        const el=document.createElement('div'); el.className='room-label';
        const name=document.createElement('span'); name.textContent=room.name;
        const area=document.createElement('small'); area.textContent=`${roomArea(room.poly).toFixed(1)} m²`;
        el.append(name,area);
        const label=new CSS2DObject(el); label.position.set(wx(room.at[0]),.12,wz(room.at[1])); roomLabels.add(label);
      }
    }
    const ids=new Set(doc.furniture.map(f=>f.id));
    for(const [id,entry] of models) if(!ids.has(id)) { disposeGeometry(entry.group); models.delete(id); }
    for(const f of doc.furniture) {
      // Position and rotation update without rebuilding detailed meshes.
      const signature=JSON.stringify([f.type,f.w,f.d,f.color]);
      let entry=models.get(f.id);
      if(!entry || entry.signature!==signature) {
        if(entry) disposeGeometry(entry.group);
        const group=factory.furniture(f); furniture.add(group);
        entry={group,signature}; models.set(f.id,entry);
      }
      if(drag?.id!==f.id) entry.group.position.set(wx(f.cx),0,wz(f.cy));
      entry.group.rotation.y=-f.rot*Math.PI/180;
    }
    furniture.visible=options.furniture;
    for(const label of roomLabels.children) {label.visible=options.roomNames||options.areas;label.element.querySelector('span').style.display=options.roomNames?'':'none';label.element.querySelector('small').style.display=options.areas?'':'none';}
    updateSelection();
  }
  function pointerDown(e) {
    if(!e.isPrimary || e.button!==0 || drag) return;
    pointerStart={id:e.pointerId,x:e.clientX,y:e.clientY};
    const hit=pick(e),id=hit?.kind==='furniture'?hit.id:null, point=groundAt(e);
    // First click selects. Dragging a selected model moves it rather than orbiting.
    if(!furnitureLocked && id && id===selectedId && point) {
      const model=models.get(id).group;
      drag={id,token:callbacks.dragToken?.(),pid:e.pointerId,start:model.position.clone(),offset:point.clone().sub(model.position),moved:false};
      controls.enabled=false; renderer.domElement.setPointerCapture(e.pointerId);
    }
  }
  function pointerMove(e) {
    if(!drag || drag.pid!==e.pointerId)return;
    const point=groundAt(e); if(!point)return;
    if(!drag.moved && Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<4)return;
    drag.moved=true;
    const sample=groundAt({...e,clientX:e.clientX+1,clientY:e.clientY});
    const mmPerPixel=sample?sample.distanceTo(point)*1000:20;
    const target=point.clone().sub(drag.offset),f=currentDoc.furniture.find(f=>f.id===drag.id);
    const snapped=snapFurniture(f,planX(target.x),planY(target.z),currentDoc,10*mmPerPixel,snapEnabled&&!e.altKey,!e.altKey);
    drag.position={cx:snapped.cx,cy:snapped.cy};
    models.get(drag.id)?.group.position.set(wx(snapped.cx),0,wz(snapped.cy));
    clearSnapGuide();
    if(snapped.guides.length){
      snapGuide=new THREE.Group();
      for(const guide of snapped.guides){const points=[new THREE.Vector3(wx(guide.a.x),.04,wz(guide.a.y)),new THREE.Vector3(wx(guide.b.x),.04,wz(guide.b.y))];
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:guide.kind==='spacing'?0x0891b2:guide.kind==='center'?0xc026d3:0xe11d48,dashSize:guide.kind==='center'?0.08:0.15,gapSize:.1,depthTest:false}));line.computeLineDistances();line.renderOrder=11;snapGuide.add(line);
        if(guide.kind==='spacing'){const el=document.createElement('div');el.className='spacing-guide-label';el.textContent=`${formatLength(guide.distance,currentUnit)} ${currentUnit}`;
          const label=new CSS2DObject(el);label.position.set(wx((guide.a.x+guide.b.x)/2),.12,wz((guide.a.y+guide.b.y)/2));snapGuide.add(label);}
      }
      scene.add(snapGuide);
    }
    renderer.domElement.style.cursor='grabbing'; selection?.update?.();
  }
  function pointerEnd(e) {
    if(pointerStart?.id!==e.pointerId)return;
    const cancel=e.type==='pointercancel';
    if(drag) {
      const g=drag, model=models.get(g.id)?.group; drag=null;clearSnapGuide(); controls.enabled=true;
      renderer.domElement.style.cursor='';
      if(renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
      if(model && cancel) model.position.copy(g.start);
      else if(model && g.moved) callbacks.onMove(g.id,g.position,g.token);
      selection?.update?.();
    } else if(!cancel && Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<4) {const hit=pick(e);if(hit?.kind==='room')callbacks.onSelectRoom(hit.id);else if(hit?.kind==='wall')callbacks.onSelectWall(hit.id);else callbacks.onSelect(hit?.id??null);}
    pointerStart=null;
  }
  // Ends a drag without saving: Escape, focus loss, a locked furniture layer or a removed item.
  function cancelDrag() {
    if(!drag)return;
    const g=drag,model=models.get(g.id)?.group;drag=null;pointerStart=null;clearSnapGuide();controls.enabled=true;
    renderer.domElement.style.cursor='';
    if(renderer.domElement.hasPointerCapture(g.pid))renderer.domElement.releasePointerCapture(g.pid);
    if(model)model.position.copy(g.start);
    selection?.update?.();
  }
  const cancelOnEscape=e=>{if(e.key==='Escape')cancelDrag();};
  window.addEventListener('keydown',cancelOnEscape);window.addEventListener('blur',cancelDrag);
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',pointerDown,true);
  canvas.addEventListener('pointermove',pointerMove);
  canvas.addEventListener('pointerup',pointerEnd);
  canvas.addEventListener('pointercancel',pointerEnd);
  function contextLost(e) { e.preventDefault(); callbacks.onError('The 3D graphics context was lost. Switch to 2D, then reopen 3D.'); }
  canvas.addEventListener('webglcontextlost',contextLost);
  function resize() {
    const width=Math.max(host.clientWidth,1),height=Math.max(host.clientHeight,1);
    renderer.setSize(width,height); labels.setSize(width,height);
    camera.aspect=width/height; camera.updateProjectionMatrix();
  }
  const observer=new ResizeObserver(resize); observer.observe(host); resize();
  function render() {
    if(disposed)return;
    if(!drag) controls.update(); renderer.render(scene,camera); labels.render(scene,camera);
    frame=requestAnimationFrame(render);
  }
  render();
  return {sync,select,resetCamera,cancelDrag,dispose() {
    clearSnapGuide();disposed=true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
    canvas.removeEventListener('pointerdown',pointerDown,true);
    canvas.removeEventListener('pointermove',pointerMove);
    canvas.removeEventListener('pointerup',pointerEnd);
    canvas.removeEventListener('pointercancel',pointerEnd);
    canvas.removeEventListener('webglcontextlost',contextLost);
    window.removeEventListener('keydown',cancelOnEscape);window.removeEventListener('blur',cancelDrag);
    if(selection) { selection.geometry.dispose(); selection.material.dispose(); }
    scene.traverse(o=>o.geometry?.dispose());
    for(const label of roomLabels.children) label.element.remove();
    factory.dispose(); ground.material.dispose(); sun.shadow.dispose(); environment.dispose();
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); labels.domElement.remove();
  }};
}
