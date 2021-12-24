import { World, Edge, Vec2, Circle } from 'planck-js'
import planck from 'planck-js/dist/planck-with-testbed';
import Renderer, { Runner } from "planck-renderer";
import './field.js';


planck.testbed('Apply Force', function(testbed) {
    testbed.y = -20;
  
    var pl = planck, Vec2 = pl.Vec2;
  
    var world = pl.World();
  
    var ground = world.createBody(Vec2(0.0, 20.0));
  
    var wallFD = {
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
  
    var xf1 = pl.Transform();
    xf1.q.set(0.3524 * Math.PI);
    xf1.p.set(xf1.q.getXAxis());
  
    var poly1 = pl.Polygon([Vec2(-1.0, 0.0), Vec2(1.0, 0.0), Vec2(0.0, 0.5)].map(pl.Transform.mulFn(xf1)));
  
    var xf2 = pl.Transform();
    xf2.q.set(-0.3524 * Math.PI);
    xf2.p.set(Vec2.neg(xf2.q.getXAxis()));
  
    var poly2 = pl.Polygon([Vec2(-1.0, 0.0), Vec2(1.0, 0.0), Vec2(0.0, 0.5)].map(pl.Transform.mulFn(xf2)));
  
    var jet = world.createBody({
      type : 'dynamic',
      angularDamping : 2.0,
      linearDamping : 0.5,
      position : Vec2(0.0, 2.0),
      angle : Math.PI,
      allowSleep : false
    });


    jet.createFixture(poly1, 2.0);
    jet.createFixture(poly2, 2.0);
  
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
  
    testbed.step = function() {
      if (testbed.activeKeys.right && !testbed.activeKeys.left) {
        //jet.applyAngularImpulse(-0.2, true);
  
      } else if (testbed.activeKeys.left && !testbed.activeKeys.right) {
        //jet.applyAngularImpulse(+0.2, true);
      }
  
      if (testbed.activeKeys.up) {
        var f = jet.getWorldVector(Vec2(0.0, -0.3));
        var p = jet.getWorldPoint(Vec2(0.0, 2.0));

        jet.applyLinearImpulse(f, p, true);
      }


      var angle = jet.getAngle()*180/Math.PI - 90;
      var d_vector = jet.m_linearVelocity;
      var direction = Math.atan2(d_vector.y, d_vector.x)*180/Math.PI;
      
      while (angle < -180){
          angle+=360
      }

      while (angle > 180){
          angle-=360;
      }

      var d = jet.m_linearVelocity.x*Math.cos(angle*Math.PI/180) + jet.m_linearVelocity.y*Math.sin(angle*Math.PI/180) 
      var q = jet.m_linearVelocity.x*Math.cos((angle+90)*Math.PI/180) + jet.m_linearVelocity.y*Math.sin((angle+90)*Math.PI/180) 

      // console.log(angle, d, q);

      var f = jet.getWorldVector(Vec2(-q/2, 0));
      var p = jet.getWorldPoint(Vec2(0.0, 1));


      jet.applyLinearImpulse(f, p, true);   


 

      if (testbed.activeKeys.right && !testbed.activeKeys.left) {
        var f = jet.getWorldVector(Vec2(-d/5, 0));
        var p = jet.getWorldPoint(Vec2(0.0, -2));
        jet.applyForce(f, p, true); 
  
      } else if (testbed.activeKeys.left && !testbed.activeKeys.right) {
        var f = jet.getWorldVector(Vec2(d/5, 0));
        var p = jet.getWorldPoint(Vec2(0.0, -2));
        jet.applyForce(f, p, true); 
      }




    };

    
  
    return world;
  });


const canvas = document.querySelector('#test')
const ctx = canvas.getContext('2d')

const world = new World(Vec2(0, -10));
const renderer = new Renderer(world, ctx)

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
	renderer.renderWorld()
}) // start rendering world


