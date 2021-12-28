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
  
  var xf1 = pl.Transform();
  xf1.q.set(0.3524 * Math.PI);
  xf1.p.set(xf1.q.getXAxis());

  var poly1 = pl.Polygon([Vec2(-1.0, 0.0), Vec2(1.0, 0.0), Vec2(0.0, 0.5)].map(pl.Transform.mulFn(xf1)));

  var xf2 = pl.Transform();
  xf2.q.set(-0.3524 * Math.PI);
  xf2.p.set(Vec2.neg(xf2.q.getXAxis()));

  var poly2 = pl.Polygon([Vec2(-1.0, 0.0), Vec2(1.0, 0.0), Vec2(0.0, 0.5)].map(pl.Transform.mulFn(xf2)));

  var boat = world.createBody({
    type : 'dynamic',
    angularDamping : 0.25,
    linearDamping : 0.5,
    position : Vec2(0.0, 2.0),
    angle : Math.PI,
    allowSleep : false
  });


  let polya = pl.Polygon([Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25),  Vec2(-0.75, 0.5),  Vec2(-0.5, 1.75),  Vec2(0, 1.75) ])
  let polyb = pl.Polygon([Vec2(0, -2.25), Vec2(0.5, -1.25), Vec2(0.75, -0.25),  Vec2(0.75, 0.5),  Vec2(0.5, 1.75),  Vec2(0, 1.75) ])

  //boat.createFixture(poly1, 2.0);
  //boat.createFixture(poly2, 2.0);
  boat.createFixture(polya, 2.0);
  boat.createFixture(polyb, 2.0);

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

  let force = -centerboard_AoA_degrees/4 * Math.abs(d)*Math.abs(d);

  if (force>75){
    force = 75
  }
  else if (force<-75){
    force = -75
  }

  if (Math.abs(d)<0.5){
    //force = 0;
  }


  // console.log(angle, d, q);

  document.getElementById("info").innerHTML = "q/d: "+ centerboard_AoA_degrees + "°<br>"; 
  document.getElementById("info").innerHTML += "speed: "+ d + "<br>"; 
  document.getElementById("info").innerHTML += "angular_velocity: "+ boat.m_angularVelocity + "<br>"; 

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

    if (rudder_angle<45){
      rudder_angle +=1
      pumpfactor = 0.75
    }

  } else if (keyboard_left && !keyboard_right) {
    
    if (rudder_angle>-45){
      rudder_angle -=1
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

    rudder_angle = rudder_angle*(0.98-dmod/20)
    pumpfactor = rudder_angle*-dmod/10

  }


  
  let p2 = boat.getWorldPoint(Vec2(0.0, 1.8))
  let f2 = {}

  let angular_velocity = boat.m_angularVelocity;

  let q_rot = angular_velocity*1.8;


  let water_angle = Math.atan2(q+q_rot, Math.abs(d)) /Math.PI*180

  document.getElementById("info").innerHTML += "angle: "+water_angle + "<br>";

  let rudderforce = 0;
  if (d>0){
    rudderforce = d*(rudder_angle+water_angle)/10;
  }
  else{
    rudderforce = d*(rudder_angle-water_angle)/10; 
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

  rudders = [];
  rudders.push(r)

  ctx.clearRect(-canvas.width, - canvas.height, canvas.width, canvas.height);
	//renderer.renderWorld()

},
() => {
  //ctx.clearRect(0, 0, canvas.width, canvas.height);
	//renderer.renderWorld()





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

  mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material);
	//mesh = new THREE.Mesh( geometry2, material );
	scene.add( mesh );



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

  let windangle = 60;  
  // windangle
  let angle = (windangle/-180)*Math.PI;

  let distance =  Math.sqrt(x1*x1 + y1*y1);

  let alpha = Math.atan2(y1,x1)

  let phase = Math.cos((angle - alpha))*distance;

  let d = 30*Math.sin((phase/100+time/50.0));

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

  let impulses= [];


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



  frame++;
  uniforms.time.value+=0.1;

  isFirstFrame = false;

	renderer2.render( scene, camera );

}