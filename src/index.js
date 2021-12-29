import { World, Edge, Vec2, Circle } from 'planck-js'
import planck from 'planck-js/dist/planck-with-testbed';
import Renderer, { Runner } from "planck-renderer";
import './field.js';

let keyboard_up = false;
let keyboard_down = false;
let keyboard_left = false;
let keyboard_right = false;

let polygons = [];
let edges= [];
let circles= [];

let arrows= [];

let forces= [];
let impulses= [];


let rudders= [];
let sails= [];

let windangle = 90;  
let windspeed = 5;  

document.onkeydown = checkKeyPress;
document.onkeyup = checkKeyRelease;

function checkKeyPress(e) {

    e = e || window.event;

    if (e.keyCode == '38') {
        // up arrow
        keyboard_up = true;
    }
    else if (e.keyCode == '40') {
        // down arrow
        keyboard_down = true;
    }
    else if (e.keyCode == '37') {
       // left arrow
        keyboard_left = true;
    }
    else if (e.keyCode == '39') {
       // right arrow
        keyboard_right = true;
    }

}


function checkKeyRelease(e) {

  e = e || window.event;

  if (e.keyCode == '38') {
      // up arrow
      keyboard_up = false;
  }
  else if (e.keyCode == '40') {
      // down arrow
      keyboard_down = false;
  }
  else if (e.keyCode == '37') {
     // left arrow
      keyboard_left = false;
  }
  else if (e.keyCode == '39') {
     // right arrow
      keyboard_right = false;
  }

}


function setup_world(){

  let pl = planck, Vec2 = pl.Vec2;
  
  let world = new World(Vec2(0, 0));

  let ground = world.createBody(Vec2(0.0, 20.0));

  let wallFD = {
    density: 0.0,
    restitution: 0.4,
  };

  // Left vertical
  ground.createFixture(pl.Edge(Vec2(-20.0, -20.0), Vec2(-20.0, 20.0)), wallFD);

  // Right vertical
  ground.createFixture(pl.Edge(Vec2(20.0, -20.0), Vec2(20.0, 20.0)), wallFD);

  // Top horizontal
  ground.createFixture(pl.Edge(Vec2(-20.0, 20.0), Vec2(20.0, 20.0)), wallFD);

  // Bottom horizontal
  ground.createFixture(pl.Edge(Vec2(-20.0, -20.0), Vec2(20.0, -20.0)), wallFD);

  return world;
} 

function setup_boat(world){
  
  let pl = planck, Vec2 = pl.Vec2;
  
  var boat = world.createBody({
    type : 'dynamic',
    angularDamping : 0.5,
    linearDamping : 0.1,
    position : Vec2(0.0, 2.0),
    angle : Math.PI,
    allowSleep : false
  });

  let polyc = pl.Polygon([Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25),  Vec2(-0.75, 0.5),  Vec2(-0.5, 1.75), Vec2(0.5, 1.75),  Vec2(0.75, 0.5), Vec2(0.75, -0.25), Vec2(0.5, -1.25), Vec2(0, -2.25)])


  //boat.createFixture(poly1, 2.0);
  //boat.createFixture(poly2, 2.0);
  //boat.createFixture(polya, 2.0);
  //boat.createFixture(polyb, 2.0);
  boat.createFixture(polyc, 6.0);

  return boat
}


const canvas = document.querySelector('#test')

canvas.height = window.innerHeight;
canvas.width = window.innerWidth;

const ctx = canvas.getContext('2d')

ctx.translate(300, 0);


const options = {
  scale: 16,
  strokeStyle: {
    lineWidth:1/16,
    dynamic: 'white',
    static: 'white',
    kinematic: 'white',
  },
}

const world = setup_world();

console.log(world)

const boat = setup_boat(world);

const renderer = new Renderer(world, ctx, options)

console.log(renderer)

renderer.draw = (ctx) => {
  //ctx.strokeText(`FPS: ${runner.fps}`, 0, 10)
  ctx.strokeText(Date.now()/1000, 0, 10)

}



const runner = new Runner(world, {
	// default settings
	speed: 1,
	fps: 60,
})

// init world entities
world.createDynamicBody(Vec2(0.0, 14.5)).createFixture(Circle(0.5), 10.0);
world.createDynamicBody(Vec2(0.0, 20.0)).createFixture(Circle(5.0), 10.0);

console.log(boat)

let centerboard_AoA_last = 0;
let rudder_angle = 0;


runner.start(() => {

  forces = [];
  // render loop
  
  rudders = [];
  sails = [];
  
  var angle = boat.getAngle();
  var d_vector = boat.m_linearVelocity;
  var direction = Math.atan2(d_vector.y, d_vector.x)*180/Math.PI;
  

  let x = boat.c_position.c.x;
  let y = boat.c_position.c.y;

  x=0
  y=0

  while (angle < -Math.PI){
      angle+=2*Math.PI
  }

  while (angle > Math.PI){
      angle-=2*Math.PI;
  }

  // direct (forward) component of velocity vector
  var d = boat.m_linearVelocity.x*Math.cos(angle-Math.PI/2) + boat.m_linearVelocity.y*Math.sin(angle-Math.PI/2) 
  
  // quadrature (sideways) component of velocity vector
  var q = boat.m_linearVelocity.x*Math.cos(angle) + boat.m_linearVelocity.y*Math.sin(angle) 

  

  let centerboard_AoA_degrees = Math.atan2(q, Math.abs(d)) * 180 / Math.PI

  // centerboard_AoA_degrees = (centerboard_AoA_degrees*1 + centerboard_AoA_last*9)/10
  // centerboard_AoA_last = centerboard_AoA_degrees



  if (centerboard_AoA_degrees>90){
    centerboard_AoA_degrees -= 180
  }
  else if (centerboard_AoA_degrees<-90){
    centerboard_AoA_degrees += 180
  }

  let force = -centerboard_AoA_degrees * Math.abs(d)*Math.abs(d) *2;

  if (force>150){
    force = 150
  }
  else if (force<-150){
    force = -150
  }

  if (Math.abs(d)<0.5){
    //force = 0;
  }


  // console.log(angle, d, q);

  document.getElementById("info").innerHTML = "q/d: "+ centerboard_AoA_degrees + "°<br>"; 
  document.getElementById("info").innerHTML += "Arrays: "+ polygons.length + " " + edges.length +  " " + circles.length +  " " + arrows.length +  " " + forces.length +  " " + rudders.length +  " " + sails.length +   "<br>"; 


  document.getElementById("info").innerHTML += "BS: "+ d + "<br>"; 

  //var f = boat.getWorldVector(Vec2(-q*100, 0)); 
  var f = boat.getWorldVector(Vec2(force, 0));
  var p = boat.getWorldPoint(Vec2(0.0, 0));

  // centerboard
  boat.applyForce(f, p, true);   

  forces.push({name: "centerboard", vector: f, point: p})


  if (keyboard_up) {
    var f = boat.getWorldVector(Vec2(0.0, -0.3));
    var p = boat.getWorldPoint(Vec2(0.0, 2.0));
    boat.applyLinearImpulse(f, p, true);
  }  
  
  if (keyboard_down) {
    var f = boat.getWorldVector(Vec2(0.0, 0.3));
    var p = boat.getWorldPoint(Vec2(0.0, 2.0));
    boat.applyLinearImpulse(f, p, true);
  }


  let pumpfactor = 0;

  if (keyboard_right && !keyboard_left) {

    if (rudder_angle<60){
      rudder_angle +=0.5
      pumpfactor = 0.75
    }

  } else if (keyboard_left && !keyboard_right) {
    
    if (rudder_angle>-60){
      rudder_angle -=0.5
      pumpfactor = -0.75
    }

  }
  else{

    let dmod = d
    if (d>1){
      dmod = 1
    }
    if (d<-1){
      dmod = -1
    }

    rudder_angle = rudder_angle*(0.98-dmod/80)
    //pumpfactor = rudder_angle*-dmod/20

  }


  
  let p2 = boat.getWorldPoint(Vec2(0.0, 1.8))
  let f2 = {}

  let angular_velocity = boat.m_angularVelocity;

  let q_rot = angular_velocity*1.8;


  let water_angle = Math.atan2(q+q_rot, Math.abs(d)) /Math.PI*180

  let rudderforce = 0;
  if (d>0){
    rudderforce = d*(rudder_angle+water_angle)/5;
  }
  else{
    rudderforce = d*(rudder_angle-water_angle)/5; 
  }

  rudderforce += pumpfactor*4

  f2.x = Math.cos(angle +rudder_angle/180*Math.PI)* rudderforce;
  f2.y = Math.sin(angle +rudder_angle/180*Math.PI)* rudderforce;

  boat.applyForce(f2, p2, true); 
  
  forces.push({name: "rudder", vector: f2, point: p2})


  let r = {}

  r.x1 = boat.getWorldPoint(Vec2(0.0, 1.8)).x;
  r.y1 = boat.getWorldPoint(Vec2(0.0, 1.8)).y;
  r.x2 = r.x1+Math.cos(angle + Math.PI/2 +rudder_angle/180*Math.PI)*0.5;
  r.y2 = r.y1+Math.sin(angle + Math.PI/2 +rudder_angle/180*Math.PI)*0.5;

  rudders.push(r)

  let c = {}
  
  c.x1 = boat.getWorldPoint(Vec2(0.0, 0.3)).x;
  c.y1 = boat.getWorldPoint(Vec2(0.0, 0.3)).y;
  c.x2 = boat.getWorldPoint(Vec2(0.0, -0.3)).x;
  c.y2 = boat.getWorldPoint(Vec2(0.0, -0.3)).y;

  rudders.push(c)

  let twa = (windangle - angle/Math.PI*180 + 90 )




  let w = []

  w[0] = {};
  w[0].x = 0;
  w[0].y = 0;

  w[1] = {};
  w[1].x = boat.m_linearVelocity.x;
  w[1].y = boat.m_linearVelocity.y;
  
  w[2] = {};
  w[2].x = w[1].x + Math.cos(windangle /180*Math.PI) * windspeed;
  w[2].y = w[1].y  +Math.sin(windangle /180*Math.PI) * windspeed;

  let aw_vector = {}

  aw_vector.x = boat.m_linearVelocity.x + Math.cos(windangle /180*Math.PI) * windspeed;
  aw_vector.y = boat.m_linearVelocity.y + Math.sin(windangle /180*Math.PI) * windspeed;

  let awa = Math.atan2(aw_vector.y, aw_vector.x)/Math.PI*180 - angle/Math.PI*180 + 90 ;
  let aws = Math.sqrt(aw_vector.x*aw_vector.x + aw_vector.y*aw_vector.y)

  //sails.push(w)


  if (awa>180){
    awa-=360
  }
  if (awa<-180){
    awa+=360
  }

  if (twa>180){
    twa-=360
  }
  if (twa<-180){
    twa+=360
  }

  document.getElementById("info").innerHTML += "TWA: "+Math.floor(twa) + "<br>";
  document.getElementById("info").innerHTML += "TWS: "+Math.floor(windspeed) + "<br>";
  document.getElementById("info").innerHTML += "AWA: "+Math.floor(awa) + "<br>";
  document.getElementById("info").innerHTML += "AWS: "+Math.floor(aws*10)/10 + "<br>";


  // RENDER MAINSAIL SHAPE
  let mainsail_leading_edge_position = -0.8

  let mainsail_awa = awa;

  const mainsail_awa_max = 150;

  if (mainsail_awa>mainsail_awa_max) mainsail_awa = mainsail_awa_max;
  if (mainsail_awa<-mainsail_awa_max) mainsail_awa = -mainsail_awa_max;

  let mainsail_boom_length = 2.2
  let mainsail = []

  mainsail[0] = {};
  mainsail[0].x = boat.getWorldPoint(Vec2(0.0, mainsail_leading_edge_position)).x;
  mainsail[0].y = boat.getWorldPoint(Vec2(0.0, mainsail_leading_edge_position)).y;

  let mainsail_fat1 = (mainsail_boom_length*0.05*Math.abs(awa)/30 < mainsail_boom_length/10)?mainsail_boom_length*0.05*Math.abs(awa)/30 :mainsail_boom_length/10;
  mainsail[1] = {};
  mainsail[1].x = mainsail[0].x + Math.cos(angle + Math.PI/2 + mainsail_awa*0.5 /180*Math.PI) * mainsail_boom_length*0.25 +  Math.cos(angle + mainsail_awa*0.5 /180*Math.PI)*-mainsail_fat1*Math.sign(mainsail_awa);
  mainsail[1].y = mainsail[0].y  +Math.sin(angle + Math.PI/2 + mainsail_awa*0.5 /180*Math.PI) * mainsail_boom_length*0.25 +  Math.sin(angle + mainsail_awa*0.5 /180*Math.PI)*-mainsail_fat1*Math.sign(mainsail_awa);
  
  let mainsail_fat2 = mainsail_fat1;
  mainsail[2] = {};
  mainsail[2].x = mainsail[0].x + Math.cos(angle + Math.PI/2 + mainsail_awa*0.5 /180*Math.PI) * mainsail_boom_length*0.5 +  Math.cos(angle + mainsail_awa*0.5 /180*Math.PI)*-mainsail_fat2*Math.sign(mainsail_awa);
  mainsail[2].y = mainsail[0].y  +Math.sin(angle + Math.PI/2 + mainsail_awa*0.5 /180*Math.PI) * mainsail_boom_length*0.5 +  Math.sin(angle + mainsail_awa*0.5 /180*Math.PI)*-mainsail_fat2*Math.sign(mainsail_awa);

  mainsail[3] = {};
  mainsail[3].x = mainsail[0].x + Math.cos(angle + Math.PI/2 + mainsail_awa*0.5 /180*Math.PI) * mainsail_boom_length;
  mainsail[3].y = mainsail[0].y  +Math.sin(angle + Math.PI/2 + mainsail_awa*0.5 /180*Math.PI) * mainsail_boom_length;

  sails.push(mainsail)

  let bs = Math.sqrt(boat.m_linearVelocity.x*boat.m_linearVelocity.x + boat.m_linearVelocity.y*boat.m_linearVelocity.y)

  let mainsail_f = {};

  mainsail_f.x = -aw_vector.x - Math.cos(angle + Math.PI/2 )*aws*1.0
  mainsail_f.y = -aw_vector.y - Math.sin(angle + Math.PI/2 )*aws*1.0

  let normalize_factor = Math.sqrt(mainsail_f.x*mainsail_f.x + mainsail_f.y+mainsail_f.y)



  mainsail_f.x *= Math.sqrt(Math.abs(twa)/100)*2*aws
  mainsail_f.y *= Math.sqrt(Math.abs(twa)/100)*2*aws


  if (isNaN(mainsail_f.x)){
    mainsail_f.x = 0;
  }
  if (isNaN(mainsail_f.y)){
    mainsail_f.y = 0;
  }
  
  document.getElementById("info").innerHTML += "X2Y: "+ Math.floor(mainsail_f.x*10)/10 + " " + Math.floor(mainsail_f.y*10)/10 + "<br>";

  const center_of_lift = -0.025

  var mainsail_p = boat.getWorldPoint(Vec2(0.0, center_of_lift));
  // centerboard
  
  boat.applyForce(mainsail_f, mainsail_p, true);   
  forces.push({name: "mainsail", vector: mainsail_f, point: mainsail_p})


  // Calculate DRAG
  let boat_speed = Math.sqrt(boat.m_linearVelocity.x*boat.m_linearVelocity.x + boat.m_linearVelocity.y*boat.m_linearVelocity.y)

  var drag_f = {}
  drag_f.x = -(boat.m_linearVelocity.x)*boat_speed
  drag_f.y = -(boat.m_linearVelocity.y)*boat_speed


  var drag_p = boat.getWorldPoint(Vec2(0.0, -0.00));
  boat.applyForce(drag_f, drag_p, true);   
  forces.push({name: "drag", vector: drag_f, point: drag_p})


  // RENDER JIB SHAPE
  let jib_leading_edge_position = -2

  let jib_awa = awa;

  const jib_awa_max = 65;

  if (jib_awa>jib_awa_max) jib_awa = jib_awa_max;
  if (jib_awa<-jib_awa_max) jib_awa = -jib_awa_max;


  let jib_boom_length = 1.4
  let jib = []

  jib[0] = {};
  jib[0].x = boat.getWorldPoint(Vec2(0.0, jib_leading_edge_position)).x;
  jib[0].y = boat.getWorldPoint(Vec2(0.0, jib_leading_edge_position)).y;

  let jib_fat1 = (jib_boom_length*0.05*Math.abs(awa)/25 < jib_boom_length/3)?jib_boom_length*0.05*Math.abs(awa)/25 :jib_boom_length/3;
  jib[1] = {};
  jib[1].x = jib[0].x + Math.cos(angle + Math.PI/2 + jib_awa*0.65 /180*Math.PI) * jib_boom_length*0.25 +  Math.cos(angle + jib_awa*0.65 /180*Math.PI)*-jib_fat1*Math.sign(jib_awa);
  jib[1].y = jib[0].y  +Math.sin(angle + Math.PI/2 + jib_awa*0.65 /180*Math.PI) * jib_boom_length*0.25 +  Math.sin(angle + jib_awa*0.65 /180*Math.PI)*-jib_fat1*Math.sign(jib_awa);
  
  let jib_fat2 = jib_fat1;
  jib[2] = {};
  jib[2].x = jib[0].x + Math.cos(angle + Math.PI/2 + jib_awa*0.65 /180*Math.PI) * jib_boom_length*0.5 +  Math.cos(angle + jib_awa*0.65 /180*Math.PI)*-jib_fat2*Math.sign(jib_awa);
  jib[2].y = jib[0].y  +Math.sin(angle + Math.PI/2 + jib_awa*0.65 /180*Math.PI) * jib_boom_length*0.5 +  Math.sin(angle + jib_awa*0.65 /180*Math.PI)*-jib_fat2*Math.sign(jib_awa);

  jib[3] = {};
  jib[3].x = jib[0].x + Math.cos(angle + Math.PI/2 + jib_awa*0.65 /180*Math.PI) * jib_boom_length;
  jib[3].y = jib[0].y  +Math.sin(angle + Math.PI/2 + jib_awa*0.65 /180*Math.PI) * jib_boom_length;

  sails.push(jib) 

},
() => {



}


) // start rendering world



import * as THREE from '../node_modules/three/build/three.module.js';

let camera, scene, renderer2;
let geometry2, material, mesh;
let uniforms = {};
let line;

init();

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
    varying vec3 vUv;
 

    void main() {

      float windangle = 60.0; 

      float angle = (windangle/180.0)*3.141592;
    
      float distance =  sqrt(vUv.x*vUv.x + vUv.y*vUv.y);
    
      float alpha = atan(vUv.y, vUv.x);
    
      float phase = cos((angle - alpha))*distance;
    
      float d = 0.25*sin((phase/1.0+time/1.0));


      gl_FragColor = vec4(0.5+d, 0.5+d, 0.5+d, 1);


    }
    `
}


let frame = 0;

function init() {

	camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 85 );
	camera.position.z = 40;
	camera.position.y = 20;
	scene = new THREE.Scene();

	geometry2 = new THREE.BoxGeometry( 4, 4, 4 );


  uniforms = {
    colorB: {type: 'vec3', value: new THREE.Color(0x665555)},
    colorA: {type: 'vec3', value: new THREE.Color(0x555566)},
    'time': {value: 1.0},
  }

  material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    fragmentShader: fragmentShader(),
    vertexShader: vertexShader(),
  });

	//material = new THREE.MeshNormalMaterial();

  //mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material);
	//mesh = new THREE.Mesh( geometry2, material );
	// scene.add( mesh );



	renderer2 = new THREE.WebGLRenderer( { antialias: true } );
	renderer2.setSize( window.innerWidth, window.innerHeight );
	renderer2.setAnimationLoop( animation );
	document.body.appendChild( renderer2.domElement );

}

let isFirstFrame = true;


function animation( time ) {

 

  // pixel position
  let x1 = 130;
  let y1 = 130;



  //console.log(angle, d)


  for (const c of circles){
    scene.remove(c)
  }

  for (const p of polygons){
    scene.remove(p)
  }

  for (const e of edges){
    scene.remove(e)
  }

  for (const a of arrows){
    scene.remove(a)
  }  
  
  for (const r of rudders){
    scene.remove(r)
  }  

  for (const s of sails){
    scene.remove(s)
  }

  impulses= [];

  polygons = [];
  edges= [];
  circles= [];
  
  arrows= [];

  for (let body = world.getBodyList(); body; body = body.getNext()) {
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

        if (isFirstFrame){

          console.log(body, shape)
          console.log(pos, radius)

          

        }



        let points = []

        for (let i = 0; i<360; i+=10){

          let angle = i/180*Math.PI

          let x = radius*Math.cos(angle) + pos.x 
          let y = radius*Math.sin(angle) + pos.y


          points.push( new THREE.Vector3(x, y, 0) );


        }
        points.push(points[0])

        const geometry = new THREE.BufferGeometry().setFromPoints( points );
        const material2 = new THREE.LineBasicMaterial( { color: 0x00ff00 } );
        circles.push(new THREE.Line( geometry, material2 ))
        scene.add( circles[circles.length -1]);

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
        const material2 = new THREE.LineBasicMaterial( { color: 0xff0000 } );
        edges.push(new THREE.Line( geometry, material2 ))
        scene.add( edges[edges.length -1]);

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
        const material2 = new THREE.LineBasicMaterial( { color: 0x0000ff } );
        polygons.push(new THREE.Line( geometry, material2 ))
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

  for (const f of forces){


    var arrow = new THREE.ArrowHelper(
      // first argument is the direction
      new THREE.Vector3(f.vector.x, f.vector.y, 0).normalize(),
      // second argument is the origin
      new THREE.Vector3(f.point.x, f.point.y, 0),
      // length
      Math.sqrt(f.vector.x*f.vector.x + f.vector.y*f.vector.y)/5,
      // color
      0x00ff00);

    scene.add(arrow);
  
    arrows.push(arrow)

  }

  for (const r of rudders){

    let points = []
    
    points.push( new THREE.Vector3(r.x1, r.y1, 0) );
    points.push( new THREE.Vector3(r.x2, r.y2, 0) );


    const geometry = new THREE.BufferGeometry().setFromPoints( points );
    const material2 = new THREE.LineBasicMaterial( { color: 0xff0000 } );
    edges.push(new THREE.Line( geometry, material2 ))
    scene.add( edges[edges.length -1]);

  }

  for (const s of sails){

    let points = []
    
    for (let i = 0; i<s.length; i++){

      points.push( new THREE.Vector3(s[i].x, s[i].y, 0) );

    }

    const geometry = new THREE.BufferGeometry().setFromPoints( points );
    const material2 = new THREE.LineBasicMaterial( { color: 0x00ffff } );
    edges.push(new THREE.Line( geometry, material2 ))
    scene.add( edges[edges.length -1]);

  }



  frame++;
  uniforms.time.value+=0.1;

  isFirstFrame = false;

	renderer2.render( scene, camera );

}