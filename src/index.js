import { World, Edge, Vec2, Circle } from 'planck-js'
import planck, { random } from 'planck-js/dist/planck-with-testbed';
import Renderer, { Runner } from "planck-renderer";

import { Boltzmann } from './boltzmann.js'; 


import {Map} from './map.js';
import {Gust} from './gust.js';
import {Boat} from './boat.js';


const map_w = 100
const map_h = 100
const wind_angle = 90
const wind_speed = 7
const bm_resolution = 1.5;

const bm = new Boltzmann(map_w, map_h, bm_resolution, wind_angle, wind_speed);

let map = new Map(map_w, map_h, wind_angle, wind_speed, bm)
map.physics_model_init()

/*Data texture*/
var _side1 = map_w*bm_resolution; // power of two textures are better cause powers of two are required by some algorithms. Like ones that decide what color will pixel have if amount of pixels is less than amount of textels (see three.js console error when given non-power-of-two texture)
var _side2 = map_h*bm_resolution; // power of two textures are better cause powers of two are required by some algorithms. Like ones that decide what color will pixel have if amount of pixels is less than amount of textels (see three.js console error when given non-power-of-two texture)

var _amount = _side1*_side2*4; // you need 4 values for every pixel in side*side plane
var _data = new Uint8Array(_amount);

for (var i = 0; i < _amount; i++) {
  _data[i] = Math.random()*256; // generates random r,g,b,a values from 0 to 1
}

var _dataTex = new THREE.DataTexture(_data, _side1, _side2, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.UVMapping); // maybe RGBAIntegerFormat but that requires WebGL2 rendering context
var _dataTex2 = new THREE.DataTexture(_data, _side1, _side2, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.UVMapping);


_dataTex.magFilter = THREE.NearestFilter; // also check out THREE.LinearFilter just to see the results
_dataTex.needsUpdate = true; // somehow this line is required for this demo to work. I have not figured that out yet. 

var _planeMat = new THREE.MeshBasicMaterial({map: _dataTex, transparent: true });
_planeMat.needsUpdate = true;

map.bm.texture = _dataTex2




const range_map =  function (input, in_min, in_max, out_min, out_max) {
  let value = (input - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
  return value
}




let scenario_descriptor = {}
let players = []
let gusts = []

let physics_frame = 0;


const runner = new Runner(map.world, {
	// default settings
	speed: 1,
	fps: 60,
})


/*Data texture*/
var side1 = map.fluid.vectorField.areaWidth; // power of two textures are better cause powers of two are required by some algorithms. Like ones that decide what color will pixel have if amount of pixels is less than amount of textels (see three.js console error when given non-power-of-two texture)
var side2 = map.fluid.vectorField.areaHeight; // power of two textures are better cause powers of two are required by some algorithms. Like ones that decide what color will pixel have if amount of pixels is less than amount of textels (see three.js console error when given non-power-of-two texture)

var amount = side1*side2; // you need 4 values for every pixel in side*side plane
var data = new Uint8Array(amount);

for (var i = 0; i < amount; i++) {
  data[i] = Math.random()*256; // generates random r,g,b,a values from 0 to 1
}

var dataTex = new THREE.DataTexture(data, side1, side2, THREE.LuminanceFormat, THREE.UnsignedByteType);
var dataTex2 = new THREE.DataTexture(data, side1, side2, THREE.LuminanceFormat, THREE.UnsignedByteType);


dataTex.magFilter = THREE.NearestFilter; // also check out THREE.LinearFilter just to see the results
dataTex.needsUpdate = true; // somehow this line is required for this demo to work. I have not figured that out yet. 

var planeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: dataTex, transparent: true });
planeMat.needsUpdate = true;





let key_bind_list = []
let key_state = []

let keyboard_up = false;
let keyboard_down = false;
let keyboard_left = false;
let keyboard_right = false;

let polygons = [];

let arrows= [];



let guides= [];



document.onkeydown = checkKeyPress;
document.onkeyup = checkKeyRelease;

document.getElementById("camera_follow").checked = false
document.getElementById("show_forces").checked = true
document.getElementById("show_field").checked = false

document.getElementById("show_forces").addEventListener("change", e => {

  map.input_show_forces(document.getElementById("show_forces").checked)

}); 

document.getElementById("scenario_selector").addEventListener("change", e => {

  console.log(document.getElementById("scenario_selector").value)  
  scenario_start(scenarios[document.getElementById("scenario_selector").value])

}); 

document.getElementById("scenario_restart").addEventListener("click", e => {

  console.log("restart")
  scenario_start(scenarios[document.getElementById("scenario_selector").value])

}); 

document.getElementById("show_field").addEventListener("change", e => {

  map.input_show_fields(document.getElementById("show_field").checked)

}); 


document.getElementById("camera_follow").addEventListener("change", e => {

  map.input_camera_follow(document.getElementById("camera_follow").checked)

}); 

document.getElementById("camera_zoom_in").addEventListener("click", e => {
  map.input_camera_zoom_relative(-2)
}); 

document.getElementById("camera_zoom_out").addEventListener("click", e => {
  map.input_camera_zoom_relative(+2)
}); 

document.getElementById("camera_move_left").addEventListener("click", e => {
  map.input_camera_move_relative(-5,0)
}); 
document.getElementById("camera_move_right").addEventListener("click", e => {
  map.input_camera_move_relative(5,0)
}); 
document.getElementById("camera_move_up").addEventListener("click", e => {
  map.input_camera_move_relative(0,5)
}); 
document.getElementById("camera_move_down").addEventListener("click", e => {
  map.input_camera_move_relative(0,-5)
}); 


var mouse_monitor = function(e) {
  var x = e.pageX;
  var y = e.pageY;
 // console.log(x, y);

  var vec = new THREE.Vector3(); // create once and reuse
  var pos = new THREE.Vector3(); // create once and reuse

  vec.set(
      ( e.clientX / window.innerWidth ) * 2 - 1,
      - ( e.clientY / window.innerHeight ) * 2 + 1,
      0.5 );

  vec.unproject( camera );

  vec.sub( camera.position ).normalize();

  var distance = - camera.position.z / vec.z;

  pos.copy( camera.position ).add( vec.multiplyScalar( distance ) );

  let wdir = map.get_wind_direction(pos.x, pos.y)
  let wspe = map.get_wind_speed(pos.x, pos.y)

  let vx = bm.get_field_velocity(pos.x, pos.y).x
  let vy = bm.get_field_velocity(pos.x, pos.y).y 

  wdir = Math.atan2(vy, vx)/Math.PI*180
  wspe = Math.sqrt(vx*vx + vy*vy)

 let color = range_map(wspe, 10, 13, 0, 300)

  document.getElementById("wind_info").innerHTML = "Speed: " +  Math.floor(wspe*1000)/10 + "<br>Direction: " + Math.floor(wdir*10)/10
  
}

document.addEventListener("mousemove", mouse_monitor); 






function checkKeyPress(e) {

  e = e || window.event;

  key_state[e.keyCode] = true

    
  key_bind_list.forEach(bind => {

    if (bind.type === "KEYDOWN" && key_state[bind.activation_key] && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)){

      bind.object[bind.input_handler]()

    }


  });

}


function checkKeyRelease(e) {

  e = e || window.event;

  key_state[e.keyCode] = false

}





function scenario_clear(){

  scenario_descriptor = {};
  key_bind_list = [];

  players.forEach(player => {
    player.physics_model_deinit()
  });
  players = [];
  physics_frame = 0;
  
}

function scenario_start(param){

  scenario_clear()

  scenario_descriptor = param
  
}

function autokeybind(players){

  key_bind_list = [];
  
  if (players[0] !== undefined){
    key_bind_list.push({type: "PRESSED", activation_key: 37, prohibition_key: 39, object: players[0], input_handler: players[0].input_rudder_left.name})   // Left
    key_bind_list.push({type: "PRESSED", activation_key: 39, prohibition_key: 37, object: players[0], input_handler: players[0].input_rudder_right.name})  // Right
    key_bind_list.push({type: "PRESSED", activation_key: 40, prohibition_key: 38, object: players[0], input_handler: players[0].input_autopilot_heading_increase.name})
    key_bind_list.push({type: "PRESSED", activation_key: 38, prohibition_key: 40, object: players[0], input_handler: players[0].input_autopilot_heading_decrease.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 32, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_enabled_toggle.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 13, prohibition_key: -1, object: players[0], input_handler: players[0].input_autopilot_tack_toggle.name})
  }

  if (players[1] !== undefined){
    key_bind_list.push({type: "PRESSED", activation_key: 65, prohibition_key: 68, object: players[1], input_handler: players[1].input_rudder_left.name})
    key_bind_list.push({type: "PRESSED", activation_key: 68, prohibition_key: 65, object: players[1], input_handler: players[1].input_rudder_right.name})
    key_bind_list.push({type: "PRESSED", activation_key: 83, prohibition_key: 87, object: players[1], input_handler: players[1].input_autopilot_heading_increase.name})
    key_bind_list.push({type: "PRESSED", activation_key: 87, prohibition_key: 83, object: players[1], input_handler: players[1].input_autopilot_heading_decrease.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 17, prohibition_key: -1, object: players[1], input_handler: players[0].input_autopilot_enabled_toggle.name})
    key_bind_list.push({type: "KEYDOWN", activation_key: 16, prohibition_key: -1, object: players[1], input_handler: players[0].input_autopilot_tack_toggle.name})
  }


}

let scenarios = []

scenarios[0] = []
scenarios[0] [0] = () => {players.push(new Boat(map, 10, -9, 5*Math.PI/4));}
scenarios[0] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle();}
scenarios[0] [2] = () => {autokeybind(players);}

scenarios[1] = []
scenarios[1] [0] = () => {players.push(new Boat(map, 12, -6, 5*Math.PI/4)); players.push(new Boat(map, 15, -11.5, 5*Math.PI/4)); }
scenarios[1] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle();}
scenarios[1] [2] = () => {autokeybind(players);}
//scenarios[1] [2000] = () => {scenario_clear()}

scenarios[2] = []
scenarios[2] [0] = () => {players.push(new Boat(map, -10, -6, 3*Math.PI/4)); players.push(new Boat(map, 15, -11.5, 5*Math.PI/4)); }
scenarios[2] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle();}
scenarios[2] [2] = () => {autokeybind(players);}
scenarios[2] [2000] = () => {scenario_clear()}

scenarios[3] = []
scenarios[3] [0] = () => {players.push(new Boat(map, -3, -3, 3*Math.PI/4)); players.push(new Boat(map, 18, -11.5, 5*Math.PI/4)); }
scenarios[3] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle();}
scenarios[3] [2] = () => {autokeybind(players);}
scenarios[3] [350] = () => {players[0].input_autopilot_tack_toggle()}
scenarios[3] [2000] = () => {scenario_clear()}

scenarios[4] = []
scenarios[4] [0] = () => {players.push(new Boat(map, -3, -4, 3*Math.PI/4)); players.push(new Boat(map, 18, -11.5, 5*Math.PI/4)); }
scenarios[4] [1] = () => {console.log(1); players[0].input_autopilot_enabled_toggle(); players[1].input_autopilot_enabled_toggle();}
scenarios[4] [2] = () => {autokeybind(players);}
scenarios[4] [300] = () => {players[0].input_autopilot_tack_toggle()}
scenarios[4] [700] = () => {players[1].input_autopilot_heading_decrease()}
scenarios[4] [701] = () => {players[1].input_autopilot_heading_decrease()}
scenarios[4] [702] = () => {players[1].input_autopilot_heading_decrease()}
scenarios[4] [2000] = () => {scenario_clear()}


scenarios[5] = []
scenarios[5] [0] = () => {gusts = []}
scenarios[5] [1] = () => {gusts.push(new Gust(map))}

scenario_start(scenarios[document.getElementById("scenario_selector").value]);


function HSVtoRGB(h, s, v) {
  var r, g, b, i, f, p, q, t;
  if (arguments.length === 1) {
      s = h.s, v = h.v, h = h.h;
  }
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);
  switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
  }
  return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
  };
}

runner.start(() => {

  // clear the array of displayed graphic elements
  guides = [];


  if (scenario_descriptor !== undefined){
    if (scenario_descriptor[physics_frame] !== undefined){
      console.log("Frame ", physics_frame)
      scenario_descriptor[physics_frame]()
    }
  
  }

  key_bind_list.forEach(bind => {

    if (bind.type === "PRESSED" && key_state[bind.activation_key] === true && (key_state[bind.prohibition_key] === false || key_state[bind.prohibition_key] === undefined)){

      bind.object[bind.input_handler]()
    }

  });


  map.set_camera_follow_target(players[0])
  map.physics_model_step();

  gusts.forEach(gust => {

      gust.physics_model_step();

  });

  players.forEach(player => {

    player.physics_model_step();
    guides = [...guides, ...player.graphics_model_render()];


    let p = {}

    let wind_angle = (player.awa)/180*Math.PI + player.hull_angle - Math.PI/2
    p.x = player.x + Math.cos(wind_angle)*(-1.8)   
    p.y = player.y + Math.sin(wind_angle)*(-1.8)   

    // map.fluid.apply_energy(p.x, p.y, player.power_direction, player.power/50)


    let ux=Math.cos(player.power_direction/180*Math.PI)*player.power/10000
    let uy=Math.sin(player.power_direction/180*Math.PI)*player.power/10000

    

    p.x0 = player.x + Math.cos(wind_angle)*(-2)   
    p.y0 = player.y + Math.sin(wind_angle)*(-2)   
    

    map.bm.apply_energy(p.x0, p.y0, player.power_direction, player.power/10000)


   
    //map.bm.apply_energy(0, 0,  parseInt(document.getElementById("mirrorSlider").value))



    //map.bm.apply_force_to_cell(0,0, 0, 10);

    //map.bm.apply_energy(20, 0, 180)


    document.getElementById("info").innerHTML += "Phys Time: " + bm.t_delta + "<br>"
   
   
  });

  

  if (physics_frame%1==0){



    map.bm.physics_model_step();
   // map.bm.physics_model_step();

  }


  physics_frame++

  // map.fluid.loop()



  var field = map.fluid.vectorField.field;

  const data = dataTex2.image.data

  for (let x=0; x<map.fluid.vectorField.areaWidth; x++){

    for (let y=0; y<map.fluid.vectorField.areaHeight; y++){

      let velocity = field[x][y].velocity

      let val = 256-range_map(velocity, 10, 15, 0, 256)

      data[y*map.fluid.vectorField.areaWidth + x] = val

    }


  }




  let position={}

  position.x = 0
  position.y = 0
  
  renderer.copyTextureToTexture( position, dataTex2, dataTex );

  if (bm.step_ready){

    renderer.copyTextureToTexture( position, _dataTex2, _dataTex );
    bm.step_ready = false;
  }


  if (map.show_fields){
    
    // render some particle

  }




},
() => {



}


) // start rendering world






import * as THREE from '../node_modules/three/build/three.module.js';

let camera, scene, renderer, mesh;
let uniforms = {};



function vertexShader() {
  return `
    varying vec3 vUv; 

    void main() {
      vUv = position; 

      vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewPosition; 
    }
  `
}

function fragmentShader() {
  return `
    uniform vec3 colorA; 
    uniform vec3 colorB; 
    uniform float time; 

    uniform float testarray[900]; 

    varying vec3 vUv;



    void main() {


      /*
      float windangle = 60.0; 

      float angle = (windangle/180.0)*3.141592;
    
      float distance =  sqrt(vUv.x*vUv.x + vUv.y*vUv.y);
    
      float alpha = atan(vUv.y, vUv.x);
    
      float phase = cos((angle - alpha))*distance;
    
      float d = 0.25*sin((phase/1.0+time/1.0));

      gl_FragColor = vec4(0.5+d, 0.5+d, 0.5+d, 1);

      */
      //float red = floor(vUv.x/10)%4*4 + floor(vUv.y/10)%4;


      float x = vUv.x + 15.0;
      float y = vUv.y + 15.0;

      int index_x = 0;
      if (x>0.0 && x<30.0){
        index_x = int(floor(x));
      }

      int index_y = 0;
      if (y>0.0 && y<30.0){
        index_y = int(floor(y));
      }

      int index = index_x*30 + index_y;


      float red = 0.0;

      for (int i=0; i<900; i++) {
        if (i == index) red = testarray[i];
      }


      gl_FragColor = vec4(red, red, red, 1);


    }
    `
}


let frame = 0;




init();


function init() {

	camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 85 );
	camera.position.z = 60;
	camera.position.y = 20;
	scene = new THREE.Scene();

 
  
  uniforms = {
    colorB: {type: 'vec3', value: new THREE.Color(0x665555)},
    colorA: {type: 'vec3', value: new THREE.Color(0x555566)},
    'time': {value: 1.0}
  }



  const geometry = new THREE.PlaneGeometry( map.width, map.height );

  //needsUpdate

  let plane = new THREE.Mesh( geometry, _planeMat );

  plane.position.x = 0
  plane.position.y = 0
  plane.position.z = -0.01
  scene.add( plane);



	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setAnimationLoop( animation );
	document.body.appendChild( renderer.domElement );

}

let isFirstFrame = true;



function animation( time ) {




  camera.position.x = map.camera_position_x
  camera.position.y = map.camera_position_y
  camera.position.z = map.camera_zoom
  //console.log(angle, d)

  for (let element of polygons){
    scene.remove(element)
    element.geometry.dispose();
    element.material.dispose();
    element = undefined;

  }


  // arrows work differently, they don't need dispose
  for (let element of arrows){
    scene.remove(element)
    if (element.geometry.dispose !== undefined){
      element.geometry.dispose()
    }
    if (element.material.dispose !== undefined){
      element.material.dispose()
    }
    element = undefined;

  }  


  polygons = [];
  arrows= [];


  for (let body = map.world.getBodyList(); body; body = body.getNext()) {
    for (
      let fixture = body.getFixtureList();
      fixture;
      fixture = fixture.getNext()
    ) {

      if (body.render && body.render.hidden) {
        continue;
      }

      if (body.render && body.render.stroke) {
        //ctx.strokeStyle = body.render.stroke;
      } else if (body.isDynamic()) {
        //ctx.strokeStyle = options.strokeStyle.dynamic;
      } else if (body.isKinematic()) {
        //ctx.strokeStyle = options.strokeStyle.kinematic;
      } else if (body.isStatic()) {
        //ctx.strokeStyle = options.strokeStyle.static;
      }

      const type = fixture.getType();
      const shape = fixture.getShape();

      
      if (type === "circle") {
        
        const radius = shape.m_radius;
        const pos = body.getPosition();

        let points = []

        for (let i = 0; i<360; i+=10){

          let angle = i/180*Math.PI

          let x = radius*Math.cos(angle) + pos.x 
          let y = radius*Math.sin(angle) + pos.y


          points.push( new THREE.Vector3(x, y, 0) );


        }
        points.push(points[0])

        const geometry = new THREE.BufferGeometry().setFromPoints( points );
        const material = new THREE.LineBasicMaterial( { color: 0x00ff00 } );
        polygons.push(new THREE.Line( geometry, material ))
        scene.add( polygons[polygons.length -1]);



      }
      if (type === "edge") {

        
        let points = []
        const v1 = shape.m_vertex1;
        const v2 = shape.m_vertex2;

        let x1 = v1.x + body.m_xf.p.x
        let y1 = v1.y + body.m_xf.p.y       
        
        let x2 = v2.x + body.m_xf.p.x
        let y2 = v2.y + body.m_xf.p.y 

        points.push( new THREE.Vector3(x1, y1, 0) );
        points.push( new THREE.Vector3(x2, y2, 0) );


        const geometry = new THREE.BufferGeometry().setFromPoints( points );
        const material = new THREE.LineBasicMaterial( { color: 0xff0000 } );
        polygons.push(new THREE.Line( geometry, material ))
        scene.add( polygons[polygons.length -1]);

      }
      if (type === "polygon") {

        let vertices = shape.m_vertices;
        vertices.push(vertices[0]);

        let points = []

        for (const v of vertices) {
          //console.log(v.x, v.y)

          //let angle = fixture.getAngle()*180/Math.PI - 90;
          let angle = body.getAngle() + Math.PI;
          let com  = body.getLocalCenter()


         // o.x = v.x + com.x
         // o.y = v.y + com.y

          let x = (v.x+com.x)*Math.cos(angle) + (v.y-com.y)*Math.sin(angle);
          let y = (v.x+com.x)*Math.sin(angle) - (v.y-com.y)*Math.cos(angle);
          let z = 0;


          x += fixture.m_body.c_position.c.x
          y += fixture.m_body.c_position.c.y
          
          points.push( new THREE.Vector3(x,y,z) );
        }

        const geometry = new THREE.BufferGeometry().setFromPoints( points );
        const material = new THREE.LineBasicMaterial( { color: 0x0000ff } );
        polygons.push(new THREE.Line( geometry, material ))
        scene.add( polygons[polygons.length -1]);

        
      }
      if (type === 'chain') {
        
      }

    }
  }

  // for (let joint = this.world.getJointList(); joint; joint = joint.getNext()) {
  //   ctx.save();
  //   ctx.scale(this.options.scale, this.options.scale)
  //   this.drawJoint(joint)
  //   ctx.restore()
  // }

  // render forces

  // ARROW HELPER


  for (const r of guides){


    if (map.show_forces == false && r.type === "force"){

      continue;

    }


    let points = []
    
    points.push( new THREE.Vector3(r.x1, r.y1, 0) );
    points.push( new THREE.Vector3(r.x2, r.y2, 0) );


    const geometry = new THREE.BufferGeometry().setFromPoints( points );

    let color = r.color
    if (color === undefined){
      color = 0xff0000
    }

    let options;
    let opacity;
    let transparent;


    let  material

    if (r.opacity !== undefined){
      transparent = true,
      opacity = r.opacity    
      material = new THREE.LineBasicMaterial( { color: color, transparent: transparent, opacity: opacity } );
    }
    else{ 
      material = new THREE.LineBasicMaterial( { color: color } );
    }


    polygons.push(new THREE.Line( geometry, material ))
    scene.add( polygons[polygons.length -1]);


  }

  frame++;

  isFirstFrame = false;

	renderer.render( scene, camera );

}