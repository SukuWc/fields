import { World, Edge, Vec2, Circle } from 'planck-js'
import planck from 'planck-js/dist/planck-with-testbed';
import Renderer, { Runner } from "planck-renderer";
import './field.js';

let keyboard_up = false;
let keyboard_down = false;
let keyboard_left = false;
let keyboard_right = false;

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

  /*

  var boxFD = {
    density: 1.0,
    friction: 0.3,
  };

  for (var i = 0; i < 10; ++i) {
    var box = world.createDynamicBody(Vec2(0.0, 5.0 + 1.54 * i));

    box.createFixture(pl.Box(0.5, 0.5), boxFD);

    var gravity = 10.0;
    var I = box.getInertia();
    var mass = box.getMass();

    // For a circle: I = 0.5 * m * r * r ==> r = sqrt(2 * I / m)
    var radius = Math.sqrt(2.0 * I / mass);

    world.createJoint(pl.FrictionJoint({
      collideConnected : true,
      maxForce : mass * gravity,
      maxTorque : mass * radius * gravity
    }, ground, box));
  }
  */

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
    angularDamping : 2.0,
    linearDamping : 0.5,
    position : Vec2(0.0, 2.0),
    angle : Math.PI,
    allowSleep : false
  });


  boat.createFixture(poly1, 2.0);
  boat.createFixture(poly2, 2.0);

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
world.createBody().createFixture(Edge(Vec2(-40.0, 0.0), Vec2(40.0, 0.0)));
world.createDynamicBody(Vec2(0.0, 4.5)).createFixture(Circle(0.5), 10.0);
world.createDynamicBody(Vec2(0.0, 10.0)).createFixture(Circle(5.0), 10.0);


runner.start(() => {

  // render loop
  
  
  var angle = boat.getAngle()*180/Math.PI - 90;
  var d_vector = boat.m_linearVelocity;
  var direction = Math.atan2(d_vector.y, d_vector.x)*180/Math.PI;
  
  while (angle < -180){
      angle+=360
  }

  while (angle > 180){
      angle-=360;
  }

  var d = boat.m_linearVelocity.x*Math.cos(angle*Math.PI/180) + boat.m_linearVelocity.y*Math.sin(angle*Math.PI/180) 
  var q = boat.m_linearVelocity.x*Math.cos((angle+90)*Math.PI/180) + boat.m_linearVelocity.y*Math.sin((angle+90)*Math.PI/180) 

  // console.log(angle, d, q);

  var f = boat.getWorldVector(Vec2(-q/2, 0));
  var p = boat.getWorldPoint(Vec2(0.0, 1));


  boat.applyLinearImpulse(f, p, true);   


  if (keyboard_up) {
    var f = boat.getWorldVector(Vec2(0.0, -0.3));
    var p = boat.getWorldPoint(Vec2(0.0, 2.0));
    boat.applyLinearImpulse(f, p, true);
  }

  if (keyboard_right && !keyboard_left) {
    var f = boat.getWorldVector(Vec2(-d/5, 0));
    var p = boat.getWorldPoint(Vec2(0.0, -2));
    boat.applyForce(f, p, true); 

  } else if (keyboard_left && !keyboard_right) {
    var f = boat.getWorldVector(Vec2(d/5, 0));
    var p = boat.getWorldPoint(Vec2(0.0, -2));
    boat.applyForce(f, p, true); 
  }
  ctx.clearRect(-canvas.width, - canvas.height, canvas.width, canvas.height);
	renderer.renderWorld()
},
() => {
  //ctx.clearRect(0, 0, canvas.width, canvas.height);
	//renderer.renderWorld()





}


) // start rendering world



import * as THREE from '../node_modules/three/build/three.module.js';

let camera, scene, renderer2;
let geometry, material, mesh;

init();

function init() {

	camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 10 );
	camera.position.z = 1;

	scene = new THREE.Scene();

	geometry = new THREE.BoxGeometry( 0.2, 0.2, 0.2 );
	material = new THREE.MeshNormalMaterial();

	mesh = new THREE.Mesh( geometry, material );
	scene.add( mesh );

	renderer2 = new THREE.WebGLRenderer( { antialias: true } );
	renderer2.setSize( window.innerWidth, window.innerHeight );
	renderer2.setAnimationLoop( animation );
	document.body.appendChild( renderer2.domElement );

}

function animation( time ) {


  if (keyboard_up){
    mesh.rotation.x += 0.1;
  }
  if (keyboard_down){
    mesh.rotation.x -= 0.1;
  }
  if (keyboard_left){
    mesh.rotation.y += 0.1;
  }
  if (keyboard_right){
    mesh.rotation.y -= 0.1;
  }


	renderer2.render( scene, camera );

}