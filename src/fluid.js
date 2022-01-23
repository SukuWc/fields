/*

Dean's 2D fluid sim.

http://neuroid.co.uk
dean@neuroid.co.uk

*/


// 0 means no mixing at all


let resolution = 1// simulated cells per meter

let mixfactor
mixfactor = 0.3 * resolution
let advection_factor = 4 

advection_factor = 4



export let fluid = {
	
	vectorField:undefined,

	objCanvas:undefined,
	ctx:undefined,

	enableFrameDragging:true,
	enableEmitter:true,

	loopTimer:undefined,
	loopTicker:0,

	emitterX:0,
	emitterY:0,

	init:function(map_w, map_h){
		

		// init vars
		this.initVectorField(map_w, map_h);

		//this.start();
	},
	
	initVectorField:function(map_w, map_h){
		
		//this.vectorField = new vectorField( 800,800, 80,80 );
		this.vectorField = new vectorField( map_w, map_h, map_w*resolution, map_h*resolution );
		
	},

	start:function(){
		window.requestAnimationFrame = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || window.msRequestAnimationFrame;
		window.animateFrame = function( time ){
			fluid.loop();
			window.animateTimestamp = time;
			window.requestAnimationFrame( animateFrame );
		}
		window.animateFrame();
	},
	get_field_velocity:function(x, y){


		var aw = this.vectorField.areaWidth;
		var ah = this.vectorField.areaHeight;


		x+=this.vectorField.width/2
		y+=this.vectorField.height/2

		x*=resolution
		y*=resolution


		// distribute the applied energy into the nearest 4 field elements.

		let x0, x1, x2, x3
		let y0, y1, y2, y3
		let s0, s1, s2, s3
		
		x0 = Math.floor(x)
		y0 = Math.floor(y)

		x1 = x0 + 1
		y1 = y0

		x2 = x0
		y2 = y0 + 1

		x3 = x0 + 1
		y3 = y0 + 1


		let hf = x-x0
		let vf = y-y0

		//console.log(hf, vf)

		s0 = (1-hf)*(1-vf)
		s1 = (hf)*(1-vf)
		s2 = (1-hf)*(vf)
		s3 = (hf)*(vf)

		let ax = ((x+0.5)>>0)
		let ay = ((y-0.5)>>0)


		let vx = 0;
		let vy = 0;

		if (ax<aw-1 && ax>0+1 && ay<ah-1 && ay>0+1){

			var field = this.vectorField.field;

			vx = field[x0][y0].vx * s0 + field[x1][y1].vx * s1 + field[x2][y2].vx * s2 + field[x3][y3].vx * s3;
			vy = field[x0][y0].vy * s0 + field[x1][y1].vy * s1 + field[x2][y2].vy * s2 + field[x3][y3].vy * s3;

		}

		return {x: -vx, y: vy}
	},
	apply_energy:function(x, y, direction, strength){


		var aw = this.vectorField.areaWidth;
		var ah = this.vectorField.areaHeight;

		x+=this.vectorField.width/2
		y+=this.vectorField.height/2

		x*=resolution
		y*=resolution

		// distribute the applied energy into the nearest 4 field elements.

		let x0, x1, x2, x3
		let y0, y1, y2, y3
		let s0, s1, s2, s3
		
		x0 = Math.floor(x)
		y0 = Math.floor(y)

		x1 = x0 + 1
		y1 = y0

		x2 = x0
		y2 = y0 + 1

		x3 = x0 + 1
		y3 = y0 + 1


		let hf = x-x0
		let vf = y-y0

		//console.log(hf, vf)

		s0 = (1-hf)*(1-vf)
		s1 = (hf)*(1-vf)
		s2 = (1-hf)*(vf)
		s3 = (hf)*(vf)

		let ax = ((x+0.5)>>0)
		let ay = ((y+0.5)>>0)

		if (ax<aw-1 && ax>0+1 && ay<ah-1 && ay>0+1){

			var field = this.vectorField.field;

			let xeffect = 0;
			let yeffect = 0;
	
			xeffect += -Math.cos(direction/180*Math.PI)*strength
			yeffect += -Math.sin(direction/180*Math.PI)*strength
	  
			field[x0][y0].vx += s0*xeffect
			field[x0][y0].vy += s0*yeffect

			field[x1][y1].vx += s1*xeffect
			field[x1][y1].vy += s1*yeffect 

			field[x2][y2].vx += s2*xeffect
			field[x2][y2].vy += s2*yeffect
	  
			field[x3][y3].vx += s3*xeffect
			field[x3][y3].vy += s3*yeffect
	  
		}
		else{

		}

	},

	// ================================================== Loop ==================================================

	loop:function(){

		this.updateVectorField();

	},


	updateVectorField:function(){
		//
		var field = this.vectorField.field;

		var aw = this.vectorField.areaWidth;
		var ah = this.vectorField.areaHeight;
		var ax,ay;

		var vx,vy,vx_,vy_;

		// get new vx,vy
		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){

				// blend this areas velocity with surrounding areas

				if (ax<aw-1 && ax>0+1 && ay<ah-1 && ay>0+1){

					vx = (field[ax-1][ay].vx + field[ax+1][ay].vx + field[ax][ay-1].vx + field[ax][ay+1].vx)/4
					vy = (field[ax-1][ay].vy + field[ax+1][ay].vy + field[ax][ay-1].vy + field[ax][ay+1].vy)/4
				


					vx_ = field[ax][ay].vx*(1-mixfactor) + vx*mixfactor
					vy_ = field[ax][ay].vy*(1-mixfactor) + vy*mixfactor



				}
				else{
					vx_ = field[ax][ay].vx
					vy_ = field[ax][ay].vy
				}

				field[ax][ay].vx_ = vx_;
				field[ax][ay].vy_ = vy_;
				

			}
		}

		// clear vx and vy values
		
		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){
				//field[ax][ay].vx__ = 0
				//field[ax][ay].vy__ = 0
			}
		}
		

		// copy across velocities

		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){

				let vx_next = field[ax][ay].vx_
				let vy_next = field[ax][ay].vy_


				let grid_size = 1

				let hf = Math.abs(vx_next)/60*advection_factor
				let vf = Math.abs(vy_next)/60*advection_factor

				if (ax<aw-1 && ax>0+1 && ay<ah-1 && ay>0+1 ){
						

					let x0, x1, x2, x3
					let y0, y1, y2, y3

					x0 = field[ax][ay].vx_;
					x1 = field[ax-Math.sign(vx_next)][ay].vx_;
					x2 = field[ax][ay-Math.sign(vy_next)].vx_;
					x3 = field[ax-Math.sign(vx_next)][ay-Math.sign(vy_next)].vx_;

					y0 = field[ax][ay].vy_;
					y1 = field[ax-Math.sign(vx_next)][ay].vy_;
					y2 = field[ax][ay-Math.sign(vy_next)].vy_;
					y3 = field[ax-Math.sign(vx_next)][ay-Math.sign(vy_next)].vy_;

					field[ax][ay].vx__ = (1-hf)*(1-vf)*x0 + (hf)*(1-vf)*x1 + (1-hf)*(vf)*x2 + (hf)*(vf)*x3
					field[ax][ay].vy__ = (1-hf)*(1-vf)*y0 + (hf)*(1-vf)*y1 + (1-hf)*(vf)*y2 + (hf)*(vf)*y3

					if ( field[ax][ay].vx__ === undefined || field[ax][ay].vy__ === undefined){
						console.log("TRAP")
						field=undefined;

					}

				

				}
				else{
					field[ax][ay].vx__ = field[ax][ay].vx_
					field[ax][ay].vy__ = field[ax][ay].vy_
				}

				


				// map boundary condition
				if (ay == ah-2 || ay == 1 || ax == aw-2 || ax == 1){
					field[ax][ay].vx__ = 0
					field[ax][ay].vy__ = -2.5
				}

			}
		}

		ax = aw;
		while( ax-- ){
			ay = ah;
			while( ay-- ){
				field[ax][ay].vx = field[ax][ay].vx__
				field[ax][ay].vy = field[ax][ay].vy__

				field[ax][ay].velocity = Math.sqrt(field[ax][ay].vx*field[ax][ay].vx + field[ax][ay].vy*field[ax][ay].vy)

			}
		}
	},



}



let vectorField = function( w, h, aw, ah ){
	this.field = [];

	this.width = w;
	this.height = h;

	this.areaWidth = aw;
	this.areaHeight = ah;

	// init array
	var x,y;
	x = aw;
	while( x-- ){
		this.field[x] = [];

		y = ah;
		while( y-- ){

			this.field[x][y] = new fieldArea();
		}
	}


}

let fieldArea = function(){
	// area within field. each area has velocity.


	this.velocity = 0;

	this.vx = 0;
	this.vy = -2;

	this.vx_ = 0;
	this.vy_ = -2;

	this.vx__ = 0;
	this.vy__ = -2;
}
