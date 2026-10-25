import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NODES } from './simulation.js';
import { createDisasterEffects, makeSurfaceTextures } from './effects.js';

const NODE_POSITIONS = {
  seawall: [40, 350], substations: [-440, -100], fuel_terminal: [330, -780],
  water_pump: [-650, -660], comms: [-330, 455], bridge_approach: [500, -865],
  ferry_terminal: [25, 0], evac_roads: [-700, -280]
};
const COLOR = { background: 0x071723, water: 0x0b3444, land: 0x112b37, road: 0x55b6c1, major: 0xf09972, low: 0x79dce0, high: 0xff784f };

function polyline(points, material, parent) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, material);
  parent.add(line);
  return line;
}

export async function createScene(container, data) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR.background);
  scene.fog = new THREE.FogExp2(COLOR.background, 0.00027);
  const camera = new THREE.PerspectiveCamera(49, 1, 2, 9000);
  const homePosition = new THREE.Vector3(1370, 1070, 1690);
  const homeTarget = new THREE.Vector3(-140, 0, 65);
  camera.position.copy(homePosition);
  let renderer, mode = 'WEBGL';
  try {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    renderer = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
    await renderer.init();
    mode = 'WEBGPU';
  } catch (error) {
    if (renderer?.dispose) renderer.dispose();
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.8));
  renderer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 180;
  controls.maxDistance = 4300;
  controls.maxPolarAngle = Math.PI / 2.02;
  controls.target.copy(homeTarget);
  scene.add(new THREE.HemisphereLight(0x83cdd4, 0x081522, 2.2));
  const sun = new THREE.DirectionalLight(0xd4eaf0, 2.3);
  sun.position.set(-550, 1300, -700);
  scene.add(sun);
  const warmth = new THREE.DirectionalLight(0xfb8d69, 1.3);
  warmth.position.set(1000, 460, 850);
  scene.add(warmth);
  const surfaces = makeSurfaceTextures();

  // The coastline is a schematic envelope; city buildings and streets below use actual DataSF coordinates.
  const coast = [[-1700,1800],[-1350,1400],[-910,1000],[-520,650],[-200,360],[90,0],[245,-300],[445,-700],[490,-1100],[555,-1800]];
  const landShape = new THREE.Shape();
  landShape.moveTo(-3300,1800);
  for (const [x,n] of coast) landShape.lineTo(x,n);
  landShape.lineTo(-3300,-1800);
  landShape.closePath();
  const landGeo = new THREE.ExtrudeGeometry(landShape,{depth:5,bevelEnabled:false});
  landGeo.rotateX(-Math.PI/2);
  const land = new THREE.Mesh(landGeo,new THREE.MeshStandardMaterial({map:surfaces.land,color:0xb8c9ca,roughness:.96,metalness:.04}));
  scene.add(land);
  const shorePoints = coast.map(([x,n])=>new THREE.Vector3(x,5.5,-n));
  polyline(shorePoints,new THREE.LineBasicMaterial({color:0x7cddd9,transparent:true,opacity:.83}),scene);
  const waterGeometry = new THREE.PlaneGeometry(6500,6500,42,42);
  waterGeometry.rotateX(-Math.PI/2);
  const waterPositions = waterGeometry.attributes.position;
  const water = new THREE.Mesh(waterGeometry,new THREE.MeshStandardMaterial({map:surfaces.sea,color:0x79b9cf,emissive:0x082534,roughness:.32,metalness:.54,transparent:true,opacity:.95,side:THREE.DoubleSide}));
  water.position.y=-4;
  scene.add(water);
  const grid = new THREE.GridHelper(5200,46,0x235768,0x1b4554);
  grid.position.y=-2.5;
  grid.material.transparent=true;
  grid.material.opacity=.28;
  scene.add(grid);
  const boundary=[];
  for(let i=0;i<=120;i++){const a=i/120*Math.PI*2;boundary.push(new THREE.Vector3(Math.cos(a)*1609,7,-Math.sin(a)*1609));}
  polyline(boundary,new THREE.LineBasicMaterial({color:0x69d3dc,transparent:true,opacity:.65}),scene);

  // Gemini-designed height buckets batch thousands of real footprints into a small number of meshes.
  const heightGroups = new Map();
  for(const [ring,rawHeight] of data.buildings || []){
    if(!ring || ring.length<4)continue;
    const height=Math.max(4,Math.min(220,Number(rawHeight)||12));
    const bucket=Math.max(5,Math.round(height/5)*5);
    const shape=new THREE.Shape();
    shape.moveTo(ring[0][0],ring[0][1]);
    for(let j=1;j<ring.length;j++)shape.lineTo(ring[j][0],ring[j][1]);
    shape.closePath();
    if(!heightGroups.has(bucket))heightGroups.set(bucket,[]);
    heightGroups.get(bucket).push(shape);
  }
  const buildingMaterials=[0x638b99,0x79a7b2,0x89b9c5,0xa4cbd3].map(color=>new THREE.MeshStandardMaterial({map:surfaces.facade,color,emissive:color,emissiveIntensity:.08,roughness:.58,metalness:.22}));
  for(const [height,shapes] of heightGroups){
    for(let i=0;i<shapes.length;i+=260){
      try{
        const geo=new THREE.ExtrudeGeometry(shapes.slice(i,i+260),{depth:height,bevelEnabled:false,curveSegments:1});
        geo.rotateX(-Math.PI/2);
        const material=buildingMaterials[height<20?0:height<55?1:height<110?2:3];
        const mesh=new THREE.Mesh(geo,material);
        mesh.position.y=5;
        scene.add(mesh);
      }catch(error){console.warn('Skipped malformed building polygon group',error);}
    }
  }

  const minor=[],major=[];
  for(const [points,rawClass,name] of data.roads || []){
    if(!points || points.length<2)continue;
    const isMajor=Number(rawClass)<=3 || /embarcadero|market|harrison|howard|fremont/i.test(name||'');
    const target=isMajor?major:minor;
    const y=isMajor?6.7:6.2;
    for(let i=0;i<points.length-1;i++)target.push(points[i][0],y,-points[i][1],points[i+1][0],y,-points[i+1][1]);
  }
  for(const [positions,color,opacity] of [[minor,COLOR.road,.42],[major,COLOR.major,.83]]){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    scene.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false})));
  }

  // Graphic landmark hints, intentionally distinct from the georeferenced footprint layer.
  const markerMaterial=new THREE.MeshStandardMaterial({color:0xe0a586,emissive:0xcc6c4f,emissiveIntensity:.35,metalness:.55,roughness:.35});
  const tower=new THREE.Mesh(new THREE.BoxGeometry(14,65,14),markerMaterial);
  tower.position.set(-12,42,0);
  scene.add(tower);
  const towerCap=new THREE.Mesh(new THREE.ConeGeometry(12,20,4),markerMaterial);
  towerCap.position.set(-12,84,0);towerCap.rotation.y=Math.PI/4;scene.add(towerCap);
  const bridge=new THREE.Group();scene.add(bridge);
  const a=new THREE.Vector3(335,52,860),b=new THREE.Vector3(2130,52,930);
  const bridgeVector=b.clone().sub(a), bridgeLength=bridgeVector.length();
  const deck=new THREE.Mesh(new THREE.BoxGeometry(31,4,bridgeLength),new THREE.MeshStandardMaterial({color:0x598997,emissive:0x163b4a,metalness:.66,roughness:.4}));
  deck.position.copy(a).addScaledVector(bridgeVector,.5);
  deck.rotation.y=Math.atan2(bridgeVector.x,bridgeVector.z);
  bridge.add(deck);
  const bridgeTowers=[];
  for(const f of [.28,.65]){
    const p=a.clone().addScaledVector(bridgeVector,f);bridgeTowers.push(p);
    const g=new THREE.Group();g.position.set(p.x,0,p.z);g.rotation.y=deck.rotation.y;
    for(const x of [-17,17]){const leg=new THREE.Mesh(new THREE.BoxGeometry(6,128,6),markerMaterial);leg.position.set(x,92,0);g.add(leg);}
    for(const y of [76,129,151]){const bar=new THREE.Mesh(new THREE.BoxGeometry(40,4,5),markerMaterial);bar.position.y=y;g.add(bar);}
    bridge.add(g);
  }
  const cablePoints=[a.clone(),new THREE.Vector3(bridgeTowers[0].x,154,bridgeTowers[0].z),new THREE.Vector3((bridgeTowers[0].x+bridgeTowers[1].x)/2,83,(bridgeTowers[0].z+bridgeTowers[1].z)/2),new THREE.Vector3(bridgeTowers[1].x,154,bridgeTowers[1].z),b.clone()];
  const cableGeometry=new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(cablePoints).getPoints(95));
  const cableMaterial=new THREE.LineBasicMaterial({color:0xa3d5d4,transparent:true,opacity:.8});
  for(const side of [-14,14]){const cable=new THREE.Line(cableGeometry,cableMaterial);cable.position.x=side;bridge.add(cable);}

  const nodes=new Map();
  const nodeGeometry=new THREE.OctahedronGeometry(12,0);
  const haloGeometry=new THREE.RingGeometry(20,23,40);
  haloGeometry.rotateX(-Math.PI/2);
  for(const [id,[x,north]] of Object.entries(NODE_POSITIONS)){
    const position=new THREE.Vector3(x,37,-north);
    const group=new THREE.Group();group.position.copy(position);scene.add(group);
    const material=new THREE.MeshStandardMaterial({color:COLOR.low,emissive:COLOR.low,emissiveIntensity:1.1,metalness:.5,roughness:.2});
    const core=new THREE.Mesh(nodeGeometry,material);group.add(core);
    const wire=new THREE.Mesh(new THREE.OctahedronGeometry(17,0),new THREE.MeshBasicMaterial({color:0xdff8f7,wireframe:true,transparent:true,opacity:.58}));group.add(wire);
    const stem=polyline([new THREE.Vector3(0,-28,0),new THREE.Vector3(0,0,0)],new THREE.LineBasicMaterial({color:COLOR.low,transparent:true,opacity:.58}),group);
    const haloMaterial=new THREE.MeshBasicMaterial({color:COLOR.low,transparent:true,opacity:.54,side:THREE.DoubleSide,depthWrite:false});
    const halo=new THREE.Mesh(haloGeometry,haloMaterial);halo.position.y=-28;group.add(halo);
    nodes.set(id,{id,position,group,core,wire,stem,halo,prob:.1});
  }

  // Raised arcs make the model's dependency graph visible in the geographic scene.
  const cascadeLinks=[];
  for(const target of NODES){
    for(const [sourceId,weight] of Object.entries(target.deps)){
      const source=nodes.get(sourceId),destination=nodes.get(target.id);
      if(!source||!destination)continue;
      const midpoint=source.position.clone().add(destination.position).multiplyScalar(.5);
      midpoint.y+=40+weight*65;
      const points=new THREE.QuadraticBezierCurve3(source.position,midpoint,destination.position).getPoints(24);
      const material=new THREE.LineBasicMaterial({color:0xff9a72,transparent:true,opacity:.06,depthWrite:false});
      const line=polyline(points,material,scene);
      cascadeLinks.push({line,sourceId,weight,level:.06});
    }
  }
  const effects=createDisasterEffects({scene,coastline:coast,nodePositions:NODE_POSITIONS});

  let selectedId=null,selectionHandler=null,timelineHandler=null,cameraMove=null,disposed=false;
  let currentScenario={magnitude:7.2,surge:2.2},lastTimelineFrame=-1;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const onClick=(event)=>{
    const rect=renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects([...nodes.values()].map(n=>n.core))[0];
    if(hit){const node=[...nodes.values()].find(n=>n.core===hit.object);if(node){selectedId=node.id;selectionHandler?.(node.id);setRisk(currentRisk,node.id);}}
  };
  renderer.domElement.addEventListener('click',onClick);
  let currentRisk={};
  function setRisk(probabilities={},selected=selectedId){
    currentRisk=probabilities;selectedId=selected;
    effects.setScenario({...currentScenario,probabilities});
    for(const node of nodes.values()){
      node.prob=Math.max(0,Math.min(1,Number(probabilities[node.id])||0));
      const color=new THREE.Color().lerpColors(new THREE.Color(COLOR.low),new THREE.Color(COLOR.high),Math.sqrt(node.prob));
      node.core.material.color.copy(color);node.core.material.emissive.copy(color);
      node.core.material.emissiveIntensity=node.id===selected?2.2:1;
      node.halo.material.color.copy(color);node.stem.material.color.copy(color);
      node.wire.material.opacity=node.id===selected?.9:.5;
    }
    for(const link of cascadeLinks){
      const sourceRisk=Math.max(0,Number(probabilities[link.sourceId])||0);
      link.level=.05+Math.min(.65,sourceRisk*link.weight*1.5);
      link.line.material.color.setHex(sourceRisk>.35?0xff855d:0x65cad0);
    }
  }
  function setScenario({magnitude=7.2,surge=2.2}={}){
    currentScenario={magnitude,surge};
    effects.setScenario({...currentScenario,probabilities:currentRisk});
  }
  function replayDisaster(){effects.replay();}
  function pauseDisaster(){effects.pause();}
  function playDisaster(){effects.play();}
  function moveCamera(position,target){cameraMove={fromPosition:camera.position.clone(),toPosition:position,fromTarget:controls.target.clone(),toTarget:target,t:0};}
  function focusNode(id){const node=nodes.get(id);if(!node)return;selectedId=id;setRisk(currentRisk,id);moveCamera(node.position.clone().add(new THREE.Vector3(300,230,360)),node.position.clone().add(new THREE.Vector3(0,-25,0)));}
  function resetView(){moveCamera(homePosition.clone(),homeTarget.clone());}
  function zoom(factor){const offset=camera.position.clone().sub(controls.target).multiplyScalar(1/factor);if(offset.length()>controls.minDistance&&offset.length()<controls.maxDistance)camera.position.copy(controls.target).add(offset);}
  const onResize=()=>{const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);};
  const observer=new ResizeObserver(onResize);observer.observe(container);
  onResize();
  const clock=new THREE.Clock();
  function animate(){
    if(disposed)return;
    const delta=Math.min(clock.getDelta(),.08),elapsed=clock.elapsedTime;
    const effectFrame=effects.update(delta,elapsed);
    for(let i=0;i<waterPositions.count;i++)waterPositions.setY(i,Math.sin(waterPositions.getX(i)*.011+elapsed*.65)*1.7+Math.cos(waterPositions.getZ(i)*.009+elapsed*.82)*1.2);
    waterPositions.needsUpdate=true;
    surfaces.sea.offset.set((elapsed*.012)%1,(elapsed*.007)%1);
    for(const node of nodes.values()){
      node.core.rotation.y+=delta*(1+node.prob*3);
      node.wire.rotation.y-=delta*.7;
      const pulse=(elapsed*(.55+node.prob))%1;
      node.halo.scale.setScalar(1+pulse*(2+node.prob*2));
      node.halo.material.opacity=(1-pulse)*(.3+node.prob*.6);
      const scale=node.id===selectedId?1.25+Math.sin(elapsed*4)*.08:1;
      node.core.scale.setScalar(scale);node.wire.scale.setScalar(scale);
    }
    for(const link of cascadeLinks)link.line.material.opacity=link.level*(.82+.18*Math.sin(elapsed*2.5));
    if(cameraMove){cameraMove.t=Math.min(1,cameraMove.t+delta*1.55);const f=1-(1-cameraMove.t)**3;camera.position.lerpVectors(cameraMove.fromPosition,cameraMove.toPosition,f);controls.target.lerpVectors(cameraMove.fromTarget,cameraMove.toTarget,f);if(cameraMove.t>=1)cameraMove=null;}
    controls.update();
    const shake=effectFrame.cameraShake;
    if(shake){camera.position.x+=Math.sin(elapsed*67)*shake*.42;camera.position.y+=Math.cos(elapsed*73)*shake*.22;camera.position.z+=Math.sin(elapsed*79)*shake*.42;}
    renderer.render(scene,camera);
    if(shake){camera.position.x-=Math.sin(elapsed*67)*shake*.42;camera.position.y-=Math.cos(elapsed*73)*shake*.22;camera.position.z-=Math.sin(elapsed*79)*shake*.42;}
    const frame=Math.floor(effectFrame.timeline*10);
    if(frame!==lastTimelineFrame){lastTimelineFrame=frame;timelineHandler?.(effectFrame);}
  }
  renderer.setAnimationLoop(animate);
  function dispose(){disposed=true;renderer.setAnimationLoop(null);observer.disconnect();renderer.domElement.removeEventListener('click',onClick);controls.dispose();effects.dispose();scene.traverse(item=>{item.geometry?.dispose();if(item.material){(Array.isArray(item.material)?item.material:[item.material]).forEach(m=>m.dispose());}});Object.values(surfaces).forEach(texture=>texture.dispose());renderer.dispose();renderer.domElement.remove();}
  return {mode,setRisk,setScenario,replayDisaster,pauseDisaster,playDisaster,focusNode,resetView,zoom,dispose,onNodeSelect(handler){selectionHandler=handler;},onTimelineUpdate(handler){timelineHandler=handler;}};
}
