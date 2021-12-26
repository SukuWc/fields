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
world.createDynamicBody(Vec2(0.0, 4.5)).createFixture(Circle(0.5), 10.0);
world.createDynamicBody(Vec2(0.0, 10.0)).createFixture(Circle(5.0), 10.0);

console.log(boat)

runner.start(() => {

  // render loop
  
  
  var angle = boat.getAngle()*180/Math.PI - 90;
  var d_vector = boat.m_linearVelocity;
  var direction = Math.atan2(d_vector.y, d_vector.x)*180/Math.PI;
  

  let x = boat.c_position.c.x;
  let y = boat.c_position.c.y;

  x=0
  y=0



  //console.log(boat.c_position.c)

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
let geometry2, material, mesh;

let line;

init();

function init() {

	camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 55 );
	camera.position.z = 50;

	scene = new THREE.Scene();

	geometry2 = new THREE.BoxGeometry( 0.2, 0.2, 0.2 );
	material = new THREE.MeshNormalMaterial();

	mesh = new THREE.Mesh( geometry2, material );
	scene.add( mesh );



	renderer2 = new THREE.WebGLRenderer( { antialias: true } );
	renderer2.setSize( window.innerWidth, window.innerHeight );
	renderer2.setAnimationLoop( animation );
	document.body.appendChild( renderer2.domElement );

}

let isFirstFrame = true;


function animation( time ) {

  
  for (const p of polygons){
    scene.remove(p)
  }

  for (const e of edges){
    scene.remove(e)
  }

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
        
      }
      if (type === "edge") {

        
        let points = []
        const v1 = shape.m_vertex1;
        const v2 = shape.m_vertex2;
        
        let x1 = v1.x + body.m_xf.p.x
        let y1 = v1.y - body.m_xf.p.y       
        
        let x2 = v2.x + body.m_xf.p.x
        let y2 = v2.y - body.m_xf.p.y  



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
          let angle = -body.getAngle() + Math.PI;
          let com  = body.getLocalCenter()


         // o.x = v.x + com.x
         // o.y = v.y + com.y

          let x = (v.x-com.x)*Math.cos(angle) - (v.y-com.y)*Math.sin(angle);
          let y = (v.x-com.x)*Math.sin(angle) + (v.y-com.y)*Math.cos(angle);
          let z = 0;


          x += fixture.m_body.c_position.c.x
          y -= fixture.m_body.c_position.c.y
          
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

  isFirstFrame = false;

	renderer2.render( scene, camera );

}